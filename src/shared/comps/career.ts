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
 * The pools with `career_ppg` and `prev3_ppg` written onto every row's
 * `values`. Pure and non-mutating — the inputs are the frozen cached pools, so
 * every enriched row is a fresh object.
 */
export function withCareerValues(
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
