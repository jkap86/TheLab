/**
 * How many *cold* ADP computations one process will run at once — which is now
 * a *share of one budget* rather than a bound of its own.
 *
 * **The cache next door coalesces one key; the budget bounds the number of
 * keys.** {@link TtlPromiseCache} made ten readers of the default board one
 * query, which is the whole of the problem when everyone is looking at the same
 * thing and none of it when they aren't: a season here, a rookie-draft window
 * there, a league-rule set that resolved to a different id list, and the
 * drawer's own board beside a card's — every one of those is a legitimately
 * distinct key, so every one of them is a cold computation the cache has no
 * reason to fold into any other. Each is ~500-600ms of aggregate over ~1.5M
 * picks holding a pool connection for its duration, and there is no arithmetic
 * that stops a handful of readers on differently-narrowed boards from starting
 * all of them at once.
 *
 * **The pool is not that bound, which is the mistake this exists to prevent.**
 * Left to it, the first thing that runs out is connections, and it runs out for
 * *everyone* — by the time the ADP reads are queueing on `pool.connect()` the
 * league panel, the trades board and the manager tabs are queueing behind them
 * for connections they would each have held for a millisecond. A bound makes
 * the eleventh cold board wait for the third one to finish instead, which costs
 * that reader latency and costs nobody else anything.
 *
 * **And it is the *same* bound the comps corpus spends**, not an equal one
 * beside it — `shared/db/heavy-admission` is the object, this is the ADP name
 * for it. Two independent caps of a third of the pool are two thirds of the
 * pool for one reader, which is what a cold custom comps board weighing ADP
 * used to take: three comps reads and three ADP computations, both caps intact
 * and the pool empty. Player Comps calls `getDraftAdpForPlayers` *outside* its
 * own slots precisely so that this admission is the only one that read takes;
 * see that module for the hierarchy and for why nesting the two would now be
 * one limiter acquired twice.
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

import { dbHeavyReadAdmission, dbHeavyReadConcurrency } from "../db/heavy-admission.ts";

import type { Limiter } from "../sleeper/limiter.ts";

/**
 * Cold ADP computations one process may run at once, at the default pool size.
 *
 * Three, and the number is a claim about the *pool* rather than about the CPU:
 * a computation is two sequential statements, so three of them hold three of the
 * pool's ten connections at their peak and leave seven for every other route on
 * the dyno — the same third-of-the-pool share `databaseBudget().fanout` resolves
 * to at the default size. It is a *ceiling*: on an idle process the limiter is a
 * counter increment and nothing else, so the common case — one reader, or many
 * readers of one board — is unchanged.
 *
 * It is now *derived* rather than typed, which is the one thing that changed
 * here: the budget moves with `DATABASE_POOL_MAX`, so a deployment with more
 * connections gets more analytical throughput without a second variable to set.
 * This constant remains what that derivation answers on the default pool, and
 * is what the tests pin the arithmetic against.
 */
export const DEFAULT_ADP_COMPUTE_CONCURRENCY = 3;

/**
 * The configured limit, or the default for anything unreadable.
 *
 * `ADP_COMPUTE_LIMIT` still configures it, as an alias for
 * `DB_HEAVY_READ_LIMIT` — a deployment that had tightened the ADP knob was
 * asking for less heavy work at once, which is what the shared budget is.
 */
export function adpComputeConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  return dbHeavyReadConcurrency(env);
}

/**
 * The process's ADP admission: the shared heavy-read budget, under the ADP name.
 *
 * One object, so `adpComputeAdmission === compsReadAdmission`. ADP is still
 * perfectly usable on its own — a route that only draws a board takes slots
 * from a budget nothing else is spending — and a comps board that weighs ADP
 * now competes with its own season reads for the same allowance instead of
 * doubling it.
 */
export const adpComputeAdmission: Limiter = dbHeavyReadAdmission;
