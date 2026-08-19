/**
 * One process-wide bound on the *expensive analytical reads* — the comps corpus
 * and the ADP boards — so the two cannot spend the pool between them.
 *
 * **Why one budget rather than two.** Comps and ADP each grew a limiter of
 * their own, each sized at a third of the pool and each defensible on its own,
 * and neither knew about the other. That is the `sleeper/limiter` lesson
 * repeated against Postgres: *local bounds do not add up*. A cold custom comps
 * board weighing KTC, ADP and draft capital held up to three comps reads **and**
 * started up to three ADP computations, which on the default pool of ten is six
 * connections spent by one reader before league details, trades, a crawl tick or
 * anybody else's request is considered. Both caps held; the pool still emptied.
 *
 * So the cap moves to the one thing both paths have in common — being a slow,
 * connection-holding read on this dyno — and each subsystem's own name is now a
 * view onto it:
 *
 * ```
 *   dbHeavyReadAdmission          process-wide, this module — the budget
 *     ├── compsReadAdmission      the comps name for it (same object)
 *     └── adpComputeAdmission     the ADP name for it (same object)
 *
 *   COMPS_SEASON_BUILD_CONCURRENCY   per *walk*, one request's cold corpus
 *   collectWithConcurrency(fanout)   per *request*, a route's own fan-out
 * ```
 *
 * The lower two are unchanged and still local: they say how much of the budget
 * one unit of work may *ask* for. This is the one that holds when two readers
 * arrive on a cold process at the same time, which is a number no per-request
 * constant can bound.
 *
 * **Why ADP is still not wrapped in the comps limiter.** Now that both names
 * are one limiter, wrapping `getDraftAdpForPlayers` inside a comps slot would
 * not be "two limiters stacked" — it would be the *same* limiter acquired
 * twice, which with every slot taken is a queue waiting on itself: a deadlock
 * rather than a slow page, and one that only appears under the load it is
 * supposed to protect against. The rule from `comps/read-admission` therefore
 * hardens rather than relaxes: **a slot wraps one `pool.query`-shaped call and
 * nothing else**, and a loader resolves whatever it depends on *before* it
 * admits.
 *
 * **And the rule is enforced rather than merely written down.** {@link run}
 * carries a *token* for the held slot in an `AsyncLocalStorage`, so work
 * reached from inside a live slot that admits again is passed straight through
 * on the slot its caller already holds. A future caller that nests — the
 * mistake this file exists to make survivable — gets the reads it asked for at
 * the concurrency its outer slot bought, never a wedged process. It is a
 * backstop, not a licence: nesting still spends a slot for longer than the work
 * needs, and the tests pin the production call sites flat.
 *
 * A token rather than a flag because the context outlives the callback: an
 * async resource created inside a slot inherits the store and can run after the
 * permit has gone back, where "already admitted" would be a bypass with nothing
 * behind it. The token is deactivated as the slot is given up, so such a
 * descendant queues like any other caller.
 *
 * Pure and dependency-free beyond the two primitives it composes, so the
 * arithmetic and the semantics are testable with no pool behind them.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { createLimiter, type Limiter } from "../sleeper/limiter.ts";
import { databaseBudget } from "./budget.ts";

/**
 * The knob, and the two names it replaces.
 *
 * `DB_HEAVY_READ_LIMIT` is the one to set. The other two are the per-subsystem
 * variables this budget absorbed; a deployment that had tightened either of
 * them meant "let less heavy work run at once", which is what this now is, so
 * they are still honoured rather than silently ignored on the next deploy.
 */
export const DB_HEAVY_READ_LIMIT_VAR = "DB_HEAVY_READ_LIMIT";

/** Accepted as aliases for {@link DB_HEAVY_READ_LIMIT_VAR}, tightest wins. */
export const DB_HEAVY_READ_LEGACY_VARS = [
  "COMPS_READ_LIMIT",
  "ADP_COMPUTE_LIMIT",
] as const;

/**
 * Heavy database reads one process may run at once.
 *
 * `databaseBudget().fanout` — a *share of the pool* rather than a number of its
 * own, the derivation `MANAGER_SYNC_LIMIT` already takes for the other
 * expensive thing a web process does, and three at the default pool of ten. It
 * moves with `DATABASE_POOL_MAX`, which is the point of deriving it: a
 * deployment that gives the role more connections gets more analytical
 * throughput without a second variable to remember.
 *
 * It is a *ceiling*, not a target: on an idle process the limiter is a counter
 * increment and nothing else, so one reader — or many readers of one cached
 * board — is unchanged. What it costs is the fourth *distinct cold* heavy read,
 * which waits for the first to finish rather than taking a connection every
 * other route on the dyno then queues behind.
 *
 * **Precedence, and the clamp.** {@link DB_HEAVY_READ_LIMIT_VAR} wins over the
 * legacy names; where more than one of *those* is set the **tightest** wins,
 * since each was somebody asking for less heavy work at once and a budget is a
 * ceiling. Whatever comes out of that is a *request*, not a grant: it is
 * clamped to {@link dbHeavyReadCeiling}, because a number typed into a
 * dashboard cannot be allowed to undo the thing this module exists for.
 * `DB_HEAVY_READ_LIMIT=10` against a pool of 10 is not a wider budget, it is no
 * budget — the arrangement this replaced, arrived at through the variable meant
 * to prevent it, and with nothing failing to say so.
 *
 * The derivation is not clamped, because it *is* the reserved share. A ceiling
 * below it would mean the app refusing the number it chose for itself.
 */
export function dbHeavyReadConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  const requested = requestedHeavyReadLimit(env);
  // Junk falls back rather than failing the boot, the budget module's own rule:
  // a typo in a dashboard should not be why the comps tool stops answering —
  // and a 0 or a negative would be a limiter that admits nobody.
  if (requested === null) return databaseBudget(env).fanout;
  return Math.min(requested, dbHeavyReadCeiling(env));
}

/** What the environment asked for, before the clamp — null if nothing readable. */
function requestedHeavyReadLimit(
  env: Record<string, string | undefined>,
): number | null {
  const explicit = positiveInt(env[DB_HEAVY_READ_LIMIT_VAR]);
  if (explicit !== null) return explicit;

  const legacy = DB_HEAVY_READ_LEGACY_VARS.map((name) =>
    positiveInt(env[name]),
  ).filter((value): value is number => value !== null);

  return legacy.length > 0 ? Math.min(...legacy) : null;
}

/**
 * The most heavy reads this process will run at once however it is configured.
 *
 * **The pool minus one ordinary request's fan-out share.** `databaseBudget`
 * already names what a single *foreground* request may hold —
 * {@link DatabaseBudget.fanout}, a third of the pool — so reserving exactly
 * that leaves room for one normal request to run at full width while the
 * analytical budget is saturated. On the default pool of ten: heavy reads may
 * reach 7, and 3 connections are never theirs to take. That is the existing
 * invariant reused rather than a second calculation competing with it.
 *
 * The floor is the derived default itself, which only matters on a pool small
 * enough for the two to cross (three connections, where the fan-out share is
 * already two): a ceiling under the number the app picks for itself would be a
 * clamp arguing with its own default. It stays at or below `poolMax - 1` in
 * every case, since `fanout` is at least 1 and at most `poolMax - 1`, so the
 * hard promise — heavy reads can never be the whole pool — holds either way.
 */
export function dbHeavyReadCeiling(
  env: Record<string, string | undefined> = process.env,
): number {
  const { poolMax, fanout } = databaseBudget(env);
  return Math.max(fanout, poolMax - fanout);
}

/** A positive integer, or null for anything unreadable. */
function positiveInt(value: string | undefined): number | null {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * A limiter that admits at most `limit` heavy reads at once, and treats work
 * reached from inside a slot as already admitted.
 *
 * Exported as a factory so the tests can drive the composition at a width they
 * can assert — a shared budget's whole claim is about what happens at the
 * *limit*, which is not a claim you can make against the production number.
 */
export function createHeavyReadAdmission(limit: number): Limiter {
  const limiter = createLimiter(limit);
  // The store is a *token*, not a flag, and the mutable field is the whole of
  // the difference. `AsyncLocalStorage` is what makes "already inside a slot" a
  // fact about the *call chain* rather than a module-level counter, which async
  // interleaving would make meaningless the moment two readers overlap — but
  // the context propagates to every async resource created under it, including
  // ones that outlive the callback that created them. A timer scheduled inside
  // a slot and fired after it (`setTimeout(() => admission.run(work))` from an
  // admitted callback that then returns) inherits the store, and against a bare
  // `true` would read as admitted while holding nothing: the one shape that can
  // put more heavy reads in flight than the limit, arrived at through the
  // mechanism meant to prevent a deadlock.
  //
  // So the token is invalidated when its slot goes back, and a descendant that
  // finds `active === false` acquires for itself. Nothing in this app detaches
  // work from an admitted callback today; this is what keeps a caller that
  // starts to from being a bound that silently isn't one.
  const held = new AsyncLocalStorage<{ active: boolean }>();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      // Re-entrant while the slot is *live*: the caller is already counted, so
      // taking a second slot would deadlock at the limit and double-count below
      // it. Neither is a shape any caller here has — this is what keeps a
      // future one from discovering it in production.
      if (held.getStore()?.active) return fn();
      return limiter.run(() => {
        const context = { active: true };
        return held.run(context, async () => {
          try {
            return await fn();
          } finally {
            // Before the slot is released (that is `limiter.run`'s own
            // `finally`, which runs after this one), so there is no instant in
            // which the token says admitted and the permit is already back.
            context.active = false;
          }
        });
      });
    },
    // Not re-entrancy aware, deliberately: `tryAcquire` hands back a release
    // the caller owns, so its slot is a thing rather than a context, and
    // nothing that sheds rather than queues can deadlock in the first place.
    tryAcquire: () => limiter.tryAcquire(),
    stats: () => limiter.stats(),
  };
}

/**
 * The process's heavy-read admission.
 *
 * Cached on `globalThis` under a registered symbol for the reason the pg pool
 * and the Sleeper limiter are: a route bundle carrying its own copy of this
 * module gets its own counter, and nothing in the process can tell — two copies
 * of a cap of three is a cap of six, which is most of the pool and is precisely
 * the failure the cap exists to prevent, arrived at by module duplication
 * rather than by traffic. Dev's module reloading is the other half of the same
 * argument.
 */
const ADMISSION_KEY = Symbol.for("thelab.db.heavyReadAdmission");
const globalScope = globalThis as typeof globalThis & {
  [ADMISSION_KEY]?: Limiter;
};
export const dbHeavyReadAdmission: Limiter = (globalScope[ADMISSION_KEY] ??=
  createHeavyReadAdmission(dbHeavyReadConcurrency()));
