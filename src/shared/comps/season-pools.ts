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
 * misses its cache fans out into six expensive reads (season stats, profiles,
 * a KTC snapshot, KTC history, ADP and the draft crosswalk). On a cold process
 * that is every season starting at once — queued pool connections, a latency
 * spike on whichever request happened to arrive first, and a burst upstream —
 * for a corpus that is then cached for its whole TTL.
 */

/**
 * Season builds in flight at once.
 *
 * Four: enough that a cold corpus still fills in parallel rather than
 * season-by-season, and small enough that the burst is a handful of reads
 * rather than the whole archive. It is deliberately below
 * `databaseBudget().fanout`'s cousins in spirit but not derived from them —
 * these builds are mostly *upstream* and CPU work with a connection held
 * across each read, so the number that matters is how many such builds a
 * single dyno should be doing at once, not how much of the pool one request
 * may hold.
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
  load: (season: string) => Promise<readonly CompsPoolRow[]>,
  limit: number = COMPS_SEASON_BUILD_CONCURRENCY,
): Promise<CompsSeasonPool[]> {
  return collectWithConcurrency(seasons, limit, async (season) => ({
    season,
    rows: await load(season),
  }));
}
