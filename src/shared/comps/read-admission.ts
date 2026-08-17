/**
 * How many of this process's database reads the comps corpus may hold at once.
 *
 * **The caches next door coalesce a key; this bounds how many keys are cold at
 * the same time.** A cold comps request is not one read, it is a read per
 * dataset per season: the corpus is every stored season, each season's build
 * opens its stat lines, its profiles and whichever datasets the board weighs,
 * and `collectSeasonPools` deliberately builds several seasons at once so a
 * cold archive doesn't fill in one season at a time. Multiply those together
 * and a single reader arriving on a cold process asks for more concurrent
 * statements than the pool has connections — which is not a slow page, it is
 * every other route on the dyno queueing on `pool.connect()` behind a tool
 * nobody else is using. `shared/db/budget` describes that failure from the
 * other end; this is the bound that keeps comps out of it.
 *
 * **The pool is not that bound.** Left to it, the first thing that runs out is
 * connections, and it runs out for everyone. A bound here makes the fourth
 * concurrent comps read wait for the first to finish, which costs that reader a
 * little latency and costs nobody else anything.
 *
 * The properties come from {@link createLimiter} rather than being restated:
 * the slot is released in a `finally`, so a read that throws admits the next
 * one instead of tightening the cap by one per database blip; the queue is
 * FIFO, so a season at the back of a cold corpus cannot be deferred
 * indefinitely; and a waiter is handed a slot that is already counted, so the
 * bound holds across the microtask where it wakes.
 *
 * **What a slot must never be held across is another slot.** Every use of this
 * wraps a single `pool.query`-shaped call and nothing else — `loadCompsAdp`
 * resolves the ids it needs *before* it admits, rather than admitting and then
 * awaiting the base pool from inside its slot, which with every slot taken
 * would be a queue waiting on itself. `getDraftAdpForPlayers` is deliberately
 * not wrapped at all: it carries `adpComputeAdmission` of its own, and nesting
 * one limiter inside another holds a comps slot across a wait for an ADP slot.
 */

import { databaseBudget } from "../db/budget.ts";
import { createLimiter, type Limiter } from "../sleeper/limiter.ts";

/**
 * Comps reads one process may run at once.
 *
 * `databaseBudget().fanout` — a *share of the pool* rather than a number of its
 * own, the same derivation `MANAGER_SYNC_LIMIT` takes for the other expensive
 * thing a web process does. What that budget answers is "how much of the pool
 * may one request's fan-out hold", and that is exactly the question here: a
 * comps request *is* a fan-out, over seasons and datasets rather than over
 * leagues, and the corpus it fans out across is shared, so bounding the process
 * and bounding the request come to the same thing. It moves with
 * `DATABASE_POOL_MAX`, which is the point of deriving it.
 *
 * `COMPS_READ_LIMIT` overrides it, the knob for a deployment that has given
 * comps its own headroom.
 */
export function compsReadConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env.COMPS_READ_LIMIT?.trim());
  // Junk falls back rather than failing the boot, the budget module's own rule:
  // a typo in a dashboard should not be why the comps tool stops answering.
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : databaseBudget(env).fanout;
}

/**
 * The process's comps read admission.
 *
 * Cached on `globalThis` under a registered symbol for the reason the pg pool
 * and the ADP admission are: a route bundle carrying its own copy of this
 * module gets its own counter, and nothing in the process can tell — two copies
 * of a cap of three is a cap of six, which is most of the pool and is precisely
 * the failure the cap exists to prevent, arrived at by module duplication
 * rather than by traffic. Dev's module reloading is the other half of the same
 * argument.
 */
const ADMISSION_KEY = Symbol.for("thelab.comps.readAdmission");
const globalScope = globalThis as typeof globalThis & {
  [ADMISSION_KEY]?: Limiter;
};
export const compsReadAdmission: Limiter = (globalScope[ADMISSION_KEY] ??=
  createLimiter(compsReadConcurrency()));
