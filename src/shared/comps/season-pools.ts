// Relative with the extension, the pure→pure spelling: this module is tested
// under Node's runner, and `@/shared/util` would drag the whole barrel in.
import { collectWithConcurrency } from "../util/concurrency.ts";

import type { CompsSeasonPool } from "./career.ts";
import type { CompsPoolRow } from "./knn.ts";

/**
 * How the corpus is walked when it has to be built — the pure half of
 * {@link getCompsPools}, so the bound is a fact a test can pin rather than a
 * shape buried in an I/O module.
 *
 * `Promise.all(seasons.map(…))` is the shape that reads as harmless here and
 * isn't, the `collectWithConcurrency` rule applied to a list whose length is
 * *data*: the archive backfills toward a few dozen seasons, and each one that
 * misses its cache fans out into the season's own reads (its stat lines, the
 * profiles behind them, and one more per market dataset the board weighs). On a
 * cold process that is every season starting at once — queued pool connections,
 * a latency spike on whichever request happened to arrive first, and a burst
 * upstream — for a corpus that is then cached for its whole TTL.
 *
 * **This is the outer of two bounds and the softer one.** It says how many
 * season builds are in flight; `compsReadAdmission` says how many *database
 * reads* this process's comps work may hold at once, which is the number that
 * has to hold when two readers arrive on a cold process at the same time —
 * seasons × datasets × readers is not something a per-walk constant can bound.
 * Neither substitutes for the other: without this a cold corpus is one burst,
 * and without that one the burst is merely a per-request one.
 */

/**
 * Season builds in flight at once.
 *
 * Four: enough that a cold corpus still fills in parallel rather than
 * season-by-season, and small enough that the queue behind the read admission
 * is a handful of seasons rather than the whole archive. It is deliberately not
 * derived from `databaseBudget().fanout` — that budget is what
 * `compsReadAdmission` takes, and stacking one on the other under one name is
 * how a shared cap silently becomes a per-caller one. What this number
 * expresses is how much of that budget a single cold corpus may *ask* for.
 */
export const COMPS_SEASON_BUILD_CONCURRENCY = 4;

/**
 * Every season's pool, in the order the seasons were given.
 *
 * `load` is the per-season cache read, so a season already cached resolves at
 * once and costs a slot for no time at all — the coalescing and the per-season
 * TTL are entirely `load`'s, and this function calls it exactly once per
 * season. A failing season rejects the whole walk, which is what
 * `Promise.all` did and what every caller here already handles: a corpus
 * missing a season is not a corpus.
 */
export function collectSeasonPools(
  seasons: readonly string[],
  load: (season: string, index: number) => Promise<readonly CompsPoolRow[]>,
  limit: number = COMPS_SEASON_BUILD_CONCURRENCY,
): Promise<CompsSeasonPool[]> {
  return collectWithConcurrency(seasons, limit, async (season, index) => ({
    season,
    rows: await load(season, index),
  }));
}
