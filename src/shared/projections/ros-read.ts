/**
 * The rest-of-season projections board, fetched from Sleeper and cached in
 * process.
 *
 * The wired half of `./ros`, split from it the way `season/index` is split from
 * `season/resolve`: this file reaches the network and the aliases, so the pure
 * assembly stays importable under Node's test runner.
 *
 * **Fetched on request rather than synced to Postgres, deliberately.** TheLabX
 * stores projections because its background loops read them every tick; here the
 * lineups route is the only reader, and a table would be a cache with a schema.
 * The whole span — every remaining week, every player — is one bounded burst
 * through the Sleeper limiter, and what is kept is the folded board, which is
 * small. The port to stored projections arrives with the loops that need it.
 *
 * A failed span is **not cached**: the promise is evicted on rejection so the
 * next request retries, the same rule `user/memoize-manager-lookup` documents —
 * a 502 remembered for the TTL would be an outage extended by exactly the
 * mechanism meant to absorb one.
 */

import { LAST_REGULAR_WEEK } from "@/shared/manager";
import { sleeperDataUrl, sleeperGet } from "@/shared/sleeper";
import type { SleeperProjection } from "@/shared/sleeper";

import { assembleRosProjections } from "./ros";
import type { RosProjections, RosWeek } from "./ros";

/**
 * How long a folded board answers for. Projections move on injury news, not by
 * the minute; half an hour keeps a browsing session on one board without
 * serving game-day numbers from the morning.
 */
export const ROS_PROJECTIONS_TTL_MS = 30 * 60 * 1000;

type RosCacheEntry = {
  key: string;
  at: number;
  board: Promise<RosProjections>;
};

/**
 * One entry, not a map: the app asks for one season from one week at a time,
 * and yesterday's `fromWeek` is not worth a slot once the week turns. Cached on
 * `globalThis` for the reason the Sleeper limiter is — a per-bundle copy would
 * refetch the whole span per route.
 */
const CACHE_KEY = Symbol.for("thelab.projections.ros");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: RosCacheEntry;
};

/**
 * The rest-of-season board for a season, from `fromWeek` through week 18.
 *
 * Every week is fetched even when one fails — the shared limiter bounds the
 * burst — and one failure fails the span: a board silently missing week 12
 * would price every roster a game short, which is the same class of lie the
 * graph guards refuse. Callers treat a rejection as "no projections" and fall
 * back rather than rethrowing at the reader.
 */
export function getRosProjections(
  season: string,
  fromWeek: number,
): Promise<RosProjections> {
  const first = Math.min(Math.max(Math.trunc(fromWeek), 1), LAST_REGULAR_WEEK);
  const key = `${season}:${first}`;

  const cached = globalScope[CACHE_KEY];
  if (cached && cached.key === key && Date.now() - cached.at < ROS_PROJECTIONS_TTL_MS) {
    return cached.board;
  }

  const entry: RosCacheEntry = {
    key,
    at: Date.now(),
    board: fetchSpan(season, first),
  };
  globalScope[CACHE_KEY] = entry;

  entry.board.catch(() => {
    // Evict only our own entry — a newer span may already be underway.
    if (globalScope[CACHE_KEY] === entry) globalScope[CACHE_KEY] = undefined;
  });

  return entry.board;
}

async function fetchSpan(season: string, first: number): Promise<RosProjections> {
  const weeks: number[] = [];
  for (let week = first; week <= LAST_REGULAR_WEEK; week++) weeks.push(week);

  const fetched: RosWeek[] = await Promise.all(
    weeks.map(async (week) => ({
      week,
      // The data host's convention matches the v1 API's: a span with no data is
      // a null body, folded to an empty week rather than thrown.
      rows: await sleeperGet<SleeperProjection[]>(
        `${sleeperDataUrl("projections", "nfl", season, week)}?season_type=regular`,
        [],
      ),
    })),
  );

  return assembleRosProjections(fetched);
}
