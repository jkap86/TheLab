import { sleeperDataUrl, sleeperGet } from "@/shared/sleeper";
import type { SleeperProjection } from "@/shared/sleeper";

import { assembleWeekProjections } from "./week";
import type { WeekProjections } from "./week";
import { clampWeek } from "./weeks";

/**
 * One week's **actual** stat lines, fetched from Sleeper and cached in process
 * for seconds rather than minutes.
 *
 * `./week-read`'s sibling, against the projections endpoint's own sibling:
 * `GET api.sleeper.com/stats/nfl/<season>/<week>?season_type=regular` answers
 * the identical envelope with `category: "stat"` — the `SleeperProjection`
 * type's doc has said so since it was written, and thelab2026's playoff scoring
 * reads the same URL. So the fold is `assembleWeekProjections`, unchanged: a
 * row with a `game_id` and a `stats` map is a line, identity comes from any
 * row, and what comes back is a board keyed by player id whose `stats` are what
 * he has *done* rather than what he is projected to do. One fold for both feeds
 * is what keeps a league's own `scoring_settings` meaning the same thing
 * applied to either.
 *
 * **The feed is only ever players who have a line.** A player whose game has
 * not kicked off has no row, which the gametime solve reads as "nothing to
 * count yet" rather than as a zero — see `manager/gametime`. And during a game
 * the row moves every scoring play, which is what the TTL below is sized for.
 */

/**
 * How long a folded week of stats answers for.
 *
 * **Twenty seconds**, where a week's projections hold for five minutes and the
 * rest-of-season board for thirty. A touchdown is what a reader with this page
 * open is waiting to see, and a minute of staleness on it is the difference
 * between a live scoreboard and a delayed one. Twenty is also the gametime
 * room's own tick while a game runs, so the room and any reader of the plain
 * route share one fetch per tick rather than two.
 */
export const WEEK_STATS_TTL_MS = 20 * 1000;

/** How many weeks are kept — `./week-read`'s bound, for its reason. */
const MAX_CACHED_WEEKS = 4;

/**
 * A week's stat board, and a stamp that moves when the feed does.
 *
 * The stamp is the row count and the newest `last_modified` on the response,
 * which is the cheapest honest signal that any line changed: the fold drops
 * `last_modified`, so it is read here, off the rows, before they are folded.
 * A room compares stamps to decide whether anything is worth re-solving.
 */
export type WeekStatsRead = {
  board: WeekProjections;
  stamp: string;
};

type WeekCacheEntry = { at: number; read: Promise<WeekStatsRead> };

const CACHE_KEY = Symbol.for("thelab.projections.week-stats");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Map<string, WeekCacheEntry>;
};
const cache = (globalScope[CACHE_KEY] ??= new Map<string, WeekCacheEntry>());

/**
 * The stat board for one week of one season.
 *
 * `./week-read`'s cache to the line: the promise is cached so concurrent
 * callers share one fetch, a rejection is evicted rather than remembered, and
 * the bound evicts by use. It rejects rather than degrading, and the caller
 * decides what that means — the gametime route reports it as a failed feed
 * beside the projections, never as a page of players who have scored nothing.
 */
export function getWeekStats(season: string, week: number): Promise<WeekStatsRead> {
  const key = `${season}:${clampWeek(week)}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < WEEK_STATS_TTL_MS) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.read;
  }

  const entry: WeekCacheEntry = {
    at: Date.now(),
    read: fetchWeek(season, clampWeek(week)),
  };
  cache.set(key, entry);

  entry.read.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });

  while (cache.size > MAX_CACHED_WEEKS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  return entry.read;
}

async function fetchWeek(season: string, week: number): Promise<WeekStatsRead> {
  const rows = await sleeperGet<SleeperProjection[]>(
    `${sleeperDataUrl("stats", "nfl", season, week)}?season_type=regular`,
    [],
  );
  const lines = Array.isArray(rows) ? rows : [];
  return { board: assembleWeekProjections(lines), stamp: statsStamp(lines) };
}

/** The row count and the newest revision on the response — see {@link WeekStatsRead}. */
export function statsStamp(rows: readonly SleeperProjection[]): string {
  let newest = 0;
  for (const row of rows) {
    const at = row?.last_modified;
    if (typeof at === "number" && at > newest) newest = at;
  }
  return `${rows.length}:${newest}`;
}
