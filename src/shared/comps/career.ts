// Relative with the extension, the pure→pure spelling: this module is tested
// under Node's runner, and `@/shared/util` would drag the whole barrel in.
import { deepFreeze } from "../util/deep-freeze.ts";

import type { CompsPoolRow } from "./knn.ts";

/**
 * The cross-season fields — career and recent form entering each season —
 * derived from the pool corpus itself rather than fetched: every season row
 * already carries games and the PPR total, so "career PPR/g entering 2024" is
 * arithmetic over the 2023-and-earlier rows of the same player.
 *
 * Derived at read time rather than stored on the cached per-season pools,
 * because the values are a property of the *corpus*: backfilling one more
 * archive season changes every later season's career numbers without any of
 * those seasons' own data moving, and a cached copy would hold the old answer
 * for a TTL it never earned. The per-season caches stay the unit of storage;
 * this is one O(corpus) pass on top of what they return.
 *
 * Strictly prior seasons only — the market anchor's own semantics. A season
 * compared on points it hadn't scored yet would leak its own outcome into the
 * criteria that are supposed to have predicted it.
 *
 * "Career" is corpus-relative and says so in the catalogue: it reaches as far
 * as the stats archive has backfilled, so mid-backfill the number deepens as
 * older seasons land. A player's first stored season answers null on both
 * fields — no prior form is a fact about a rookie, not a zero.
 */

export type CompsSeasonPool = {
  season: string;
  rows: readonly CompsPoolRow[];
};

/** How many prior calendar seasons the recent-form window spans. */
export const PREV_SEASONS_WINDOW = 3;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The last corpus enriched, and what it came out as.
 *
 * **Keyed on the identity of the season pools, which is exactly the corpus's
 * own lifecycle and nothing else.** `getCompsPool` hands every caller the same
 * frozen array for the length of its TTL, so while nothing has been rebuilt the
 * identities are stable and this hits; the moment one season is rebuilt — a new
 * archive season lands, a TTL expires — that season's `rows` is a new array,
 * the check fails and the pass runs again. There is no second TTL to keep in
 * step with the first and no key to get wrong, which is what makes a cache over
 * a *derived* value safe here: the invalidation is the underlying cache's.
 *
 * One entry, so memory is bounded by the corpus itself rather than by how many
 * distinct requests have been served — this pass depends on nothing a request
 * carries, which is what the single slot is asserting.
 */
let lastEnriched: {
  pools: readonly CompsSeasonPool[];
  enriched: CompsSeasonPool[];
} | null = null;

/** Whether two corpora are the same objects, season for season. */
function sameCorpus(
  a: readonly CompsSeasonPool[],
  b: readonly CompsSeasonPool[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (pool, i) => pool.season === b[i].season && pool.rows === b[i].rows,
  );
}

/**
 * The pools with `career_ppg` and `prev3_ppg` written onto every row's
 * `values`. Pure and non-mutating — the inputs are the frozen cached pools, so
 * every enriched row is a fresh object.
 *
 * **The answer is memoized against the corpus it was derived from, because it
 * is a fact about that corpus and not about the request.** It is one O(corpus)
 * pass — a map per player, then a fresh row and a fresh `values` object for
 * every player-season on file — and it used to run on *every* `/api/comps`
 * request, so a reader nudging a weight notch paid for the whole historical
 * archive to be rebuilt in JavaScript while the expensive season pools
 * underneath it sat cached and untouched. The result is frozen for the reason
 * every shared answer here is: within one corpus every caller now holds the
 * same objects, and an in-place edit by one would be editing what every later
 * reader gets. Freezing is cheap because the pools it is derived from are
 * already frozen, and `deepFreeze` skips a frozen node — so what is actually
 * walked is the new rows and their new `values`, which are the only mutable
 * surfaces this creates.
 */
export function withCareerValues(
  pools: readonly CompsSeasonPool[],
): CompsSeasonPool[] {
  if (lastEnriched !== null && sameCorpus(lastEnriched.pools, pools)) {
    return lastEnriched.enriched;
  }
  const enriched = deriveCareerValues(pools);
  lastEnriched = { pools, enriched: deepFreeze(enriched) };
  return lastEnriched.enriched;
}

/** The pass itself, with no memo in front of it — what the tests drive. */
export function deriveCareerValues(
  pools: readonly CompsSeasonPool[],
): CompsSeasonPool[] {
  // Per player, every stored season's games and PPR total, keyed by year.
  const seasonsByPlayer = new Map<
    string,
    { year: number; games: number; ppr: number }[]
  >();
  for (const pool of pools) {
    const year = Number(pool.season);
    if (!Number.isInteger(year)) continue;
    for (const row of pool.rows) {
      let list = seasonsByPlayer.get(row.player_id);
      if (!list) {
        list = [];
        seasonsByPlayer.set(row.player_id, list);
      }
      list.push({ year, games: row.games, ppr: row.points.ppr });
    }
  }

  const ppg = (games: number, ppr: number): number | null =>
    games > 0 ? round2(ppr / games) : null;

  return pools.map((pool) => {
    const year = Number(pool.season);
    return {
      season: pool.season,
      rows: pool.rows.map((row) => {
        let careerGames = 0;
        let careerPpr = 0;
        let prevGames = 0;
        let prevPpr = 0;
        if (Number.isInteger(year)) {
          for (const prior of seasonsByPlayer.get(row.player_id) ?? []) {
            if (prior.year >= year) continue;
            careerGames += prior.games;
            careerPpr += prior.ppr;
            if (prior.year >= year - PREV_SEASONS_WINDOW) {
              prevGames += prior.games;
              prevPpr += prior.ppr;
            }
          }
        }
        return {
          ...row,
          values: {
            ...row.values,
            career_ppg: ppg(careerGames, careerPpr),
            prev3_ppg: ppg(prevGames, prevPpr),
          },
        };
      }),
    };
  });
}
