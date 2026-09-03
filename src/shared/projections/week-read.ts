import { sleeperDataUrl, sleeperGet } from "@/shared/sleeper";
import type { SleeperProjection } from "@/shared/sleeper";

import { assembleWeekProjections } from "./week";
import type { WeekProjections } from "./week";
import { clampWeek } from "./weeks";

/**
 * One week's projections board, fetched from Sleeper and cached in process.
 *
 * The wired half of `./week`, split from it the way `./ros-read` is split from
 * `./ros`: this file reaches the network and the aliases, so the pure fold
 * stays importable under Node's test runner.
 *
 * It sits beside `./ros-read` rather than inside it because the two answer
 * different questions and — more to the point — **cache differently**. See
 * both notes below; each divergence is a bug the shared version would have.
 */

/**
 * How long a folded week answers for.
 *
 * **Five minutes, where the rest-of-season board holds for thirty**, and the
 * difference is the whole point of the tool this feeds. A season board moves on
 * injury news over days, so half an hour keeps a browsing session on one board.
 * A week board is read by somebody deciding a lineup an hour before kickoff,
 * and the update they are there for — the Sunday-morning inactive — is exactly
 * what thirty minutes of staleness would hide.
 */
export const WEEK_PROJECTIONS_TTL_MS = 5 * 60 * 1000;

/**
 * How many weeks are kept at once.
 *
 * **A keyed map rather than `./ros-read`'s single slot**, and it has to be: that
 * file justifies one entry with "the app asks for one season from one week at a
 * time", which is true of a rest-of-season span and false the moment a week
 * stepper exists. Eighteen presses against one slot is eighteen full refetches
 * of a ~2,000-player response.
 *
 * Bounded anyway, because the other direction is a browsing session pinning all
 * eighteen. Four is a stepper's working set — the week on screen and the few
 * either side of it — and the eviction is oldest-first by insertion, which is
 * what `Map` iteration already gives.
 */
const MAX_CACHED_WEEKS = 4;

type WeekCacheEntry = { at: number; board: Promise<WeekProjections> };

/**
 * Cached on `globalThis` for the reason the Sleeper limiter is — a per-bundle
 * copy would refetch the week per route.
 */
const CACHE_KEY = Symbol.for("thelab.projections.week");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Map<string, WeekCacheEntry>;
};
const cache = (globalScope[CACHE_KEY] ??= new Map<string, WeekCacheEntry>());

/**
 * The projections board for one week of one season.
 *
 * The **promise** is cached, not the answer, so concurrent callers for one week
 * share a single fetch. A rejection is **evicted rather than remembered** — the
 * `user/memoize-manager-lookup` rule, where a 502 held for the TTL is an outage
 * extended by exactly the mechanism meant to absorb one — and only our own
 * entry is dropped, since a newer fetch for that week may already be underway.
 *
 * It rejects rather than degrading, and the caller decides what that means: the
 * lineup-check route reports it as a failed read rather than as a page of
 * confident zeroes.
 */
export function getWeekProjections(
  season: string,
  week: number,
): Promise<WeekProjections> {
  const key = `${season}:${clampWeek(week)}`;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < WEEK_PROJECTIONS_TTL_MS) {
    // Re-inserted so the bound below evicts by *use* rather than by first
    // fetch: a stepper walking back to a week it already has should not have
    // that week fall out from under it.
    cache.delete(key);
    cache.set(key, cached);
    return cached.board;
  }

  const entry: WeekCacheEntry = {
    at: Date.now(),
    board: fetchWeek(season, clampWeek(week)),
  };
  cache.set(key, entry);

  entry.board.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });

  while (cache.size > MAX_CACHED_WEEKS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  return entry.board;
}

async function fetchWeek(
  season: string,
  week: number,
): Promise<WeekProjections> {
  // The same URL `./ros-read` builds for each week of its span — one week of
  // it. A week with no data is a null body, folded to an empty board rather
  // than thrown.
  const rows = await sleeperGet<SleeperProjection[]>(
    `${sleeperDataUrl("projections", "nfl", season, week)}?season_type=regular`,
    [],
  );
  return assembleWeekProjections(rows);
}
