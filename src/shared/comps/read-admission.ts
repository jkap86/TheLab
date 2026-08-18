/**
 * How many of this process's database reads the comps corpus may hold at once
 * — which is now a *share of one budget* rather than a bound of its own.
 *
 * **The caches next door coalesce a key; that budget bounds how many keys are
 * cold at the same time.** A cold comps request is not one read, it is a read
 * per dataset per season: the corpus is every stored season, each season's
 * build opens its stat lines, its profiles and whichever datasets the board
 * weighs, and `collectSeasonPools` deliberately builds several seasons at once
 * so a cold archive doesn't fill in one season at a time. Multiply those
 * together and a single reader arriving on a cold process asks for more
 * concurrent statements than the pool has connections — which is not a slow
 * page, it is every other route on the dyno queueing on `pool.connect()` behind
 * a tool nobody else is using. `shared/db/budget` describes that failure from
 * the other end; `shared/db/heavy-admission` is the bound that keeps comps out
 * of it, and this module is the comps name for that bound.
 *
 * **It is deliberately the *same object* as `adpComputeAdmission`**, not a
 * second limiter sized like it. Two independent caps of a third of the pool are
 * two thirds of the pool for one reader: a custom board weighing KTC, ADP and
 * draft capital used to hold three comps reads *and* start three ADP
 * computations, both caps intact and the pool empty. See that module for the
 * hierarchy, and for why a slot must still never be held across a call that
 * admits again.
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
 * not wrapped at all: it admits to this same budget itself, so wrapping it
 * would be one limiter acquired twice on one read.
 */

import { dbHeavyReadAdmission, dbHeavyReadConcurrency } from "../db/heavy-admission.ts";

import type { Limiter } from "../sleeper/limiter.ts";

/**
 * Comps reads one process may run at once — the shared heavy-read budget.
 *
 * Kept under this name because it is what the comps modules and their tests
 * ask by, and because the question it answers is still a comps question; what
 * changed is that ADP is now spending the same allowance rather than an equal
 * one beside it. `COMPS_READ_LIMIT` still configures it (as an alias for
 * `DB_HEAVY_READ_LIMIT`), so a deployment that had given comps its own headroom
 * keeps the number it set.
 */
export function compsReadConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  return dbHeavyReadConcurrency(env);
}

/**
 * The process's comps read admission: the shared budget, under the comps name.
 *
 * One object, so `compsReadAdmission === adpComputeAdmission` and comps work
 * plus the ADP work comps starts can never exceed the budget between them.
 */
export const compsReadAdmission: Limiter = dbHeavyReadAdmission;
