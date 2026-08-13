/**
 * How many *cold* ADP computations one process will run at once.
 *
 * **The cache next door coalesces one key; this bounds the number of keys.**
 * {@link TtlPromiseCache} made ten readers of the default board one query, which
 * is the whole of the problem when everyone is looking at the same thing and
 * none of it when they aren't: a season here, a rookie-draft window there, a
 * league-rule set that resolved to a different id list, and the drawer's own
 * board beside a card's — every one of those is a legitimately distinct key, so
 * every one of them is a cold computation the cache has no reason to fold into
 * any other. Each is ~500-600ms of aggregate over ~1.5M picks holding a pool
 * connection for its duration, and there is no arithmetic that stops a handful
 * of readers on differently-narrowed boards from starting all of them at once.
 *
 * **The pool is not that bound, which is the mistake this exists to prevent.**
 * Left to it, the first thing that runs out is connections, and it runs out for
 * *everyone* — by the time the ADP reads are queueing on `pool.connect()` the
 * league panel, the trades board and the manager tabs are queueing behind them
 * for connections they would each have held for a millisecond. A bound here
 * makes the eleventh cold board wait for the third one to finish instead, which
 * costs that reader latency and costs nobody else anything. It is the argument
 * `shared/manager/sync-admission` makes one grain up, applied to the other
 * expensive read on the same dyno.
 *
 * Four properties come from {@link createLimiter} rather than being restated
 * here, and each is why this reuses that primitive instead of adding a second
 * semaphore to audit: the slot is released in a `finally`, so a computation that
 * throws admits the next one rather than tightening the cap by one per database
 * blip; the queue is FIFO, so a busy page cannot indefinitely defer a board that
 * has been waiting since before it started; the queue is an array that drains as
 * it is served, so nothing accumulates; and a waiter is handed a slot that is
 * already counted, so the bound holds across the microtask where it wakes.
 *
 * **What the slot must never be held across is a connection**, which is what
 * decides where this wraps — see {@link Limiter.run}'s own note. Both callers
 * acquire *outside* `pool.query`: the compute functions in `./adp.ts` open
 * nothing until they are running, so a queued caller is holding a promise and
 * nothing else. Wrapping a whole route, or anything that had already taken a
 * connection, would turn a bounded queue into the pool exhaustion it is here to
 * prevent.
 */

import { createLimiter, type Limiter } from "../sleeper/limiter.ts";

/**
 * Cold ADP computations one process may run at once.
 *
 * Three, and the number is a claim about the *pool* rather than about the CPU:
 * a computation is two sequential statements, so three of them hold three of the
 * pool's ten connections at their peak and leave seven for every other route on
 * the dyno — the same third-of-the-pool share `databaseBudget().fanout` resolves
 * to at the default size, and the share `MANAGER_SYNC_LIMIT` already takes for
 * the other expensive thing this process does. It is a *ceiling*: on an idle
 * process the limiter is a counter increment and nothing else, so the common
 * case — one reader, or many readers of one board — is unchanged.
 *
 * Deliberately not `databaseBudget().fanout` itself, though it is the same
 * number today. That budget answers "how much of the pool may **one request**
 * fan out across", and `/api/user/[username]/adp-value` already spends it on
 * exactly that (its `collectWithConcurrency` over the boards a manager's leagues
 * price against). This answers a different question — how much of the pool
 * every request's ADP work may hold *between them* — and stacking one on the
 * other under one name is how a shared cap silently becomes a per-caller one.
 *
 * `ADP_COMPUTE_LIMIT` overrides it, the knob to reach for on a larger pool.
 */
export const DEFAULT_ADP_COMPUTE_CONCURRENCY = 3;

/** The configured limit, or the default for anything unreadable. */
export function adpComputeConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.ADP_COMPUTE_LIMIT?.trim());
  // Junk falls back rather than failing the boot, the budget module's own rule:
  // a typo in a dashboard should not be why the ADP board stops answering.
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ADP_COMPUTE_CONCURRENCY;
}

/**
 * The process's ADP admission.
 *
 * Cached on `globalThis` under a registered symbol for the reason the pg pool
 * and {@link sleeperLimiter} are: a route bundle carrying its own copy of this
 * module gets its own counter, and nothing in the process can tell — two copies
 * of a cap of three is a cap of six, which is most of the pool and is precisely
 * the failure the cap exists to prevent, arrived at by module duplication rather
 * than by traffic. Dev's module reloading is the other half of the same
 * argument.
 */
const ADMISSION_KEY = Symbol.for("thelab.adp.admission");
const globalScope = globalThis as typeof globalThis & {
  [ADMISSION_KEY]?: Limiter;
};
export const adpComputeAdmission: Limiter = (globalScope[ADMISSION_KEY] ??=
  createLimiter(adpComputeConcurrency()));
