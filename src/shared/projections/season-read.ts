/**
 * The season-to-date stat board, fetched from Sleeper and cached in process.
 *
 * `./ros-read`'s backward-looking twin, against that endpoint's own sibling:
 * `GET api.sleeper.com/stats/nfl/<season>/<week>?season_type=regular` answers
 * the identical envelope with `category: "stat"` — which is what
 * `./week-stats-read` already reads one week at a time, and what the
 * `SleeperProjection` type's doc has said since it was written. So the span is
 * that file's fetch over `./ros`'s fold: weeks 1 through the week being played,
 * summed once and scored by each league's own settings, which is the same
 * arithmetic the rest-of-season board gets and the reason the two produce
 * comparable numbers at all.
 *
 * **The two spans meet at the week being played and never overlap wastefully.**
 * `restOfSeasonStart` answers where the projections span starts and
 * `seasonToDateThrough` answers where this one ends, so a page in week 10 reads
 * weeks 1–10 of stats and weeks 10–18 of projections — nineteen requests
 * between them in any week of the season rather than nineteen in one and
 * eighteen in the other.
 *
 * **Fetched on request rather than synced to Postgres**, on `./ros-read`'s
 * exact terms and for its reason: the lineup routes are the only readers, the
 * whole span is one bounded burst through the Sleeper limiter, and what is kept
 * is the folded board, which is small. A failed span is **not cached** — the
 * promise is evicted on rejection so the next request retries, which is that
 * file's rule and `user/memoize-manager-lookup`'s before it.
 */

import {
  awaitShared,
  sleeperDataUrl,
  sleeperGet,
  withBackgroundSleeper,
} from "@/shared/sleeper";
import type { SleeperProjection } from "@/shared/sleeper";
import { collectWithConcurrency } from "@/shared/util";

import { createRosFold } from "./ros";
import type { SeasonStats } from "./ros";
import { clampWeek } from "./weeks";

/**
 * How long a folded season board answers for.
 *
 * **Fifteen minutes, where the rest-of-season board holds for thirty.** The two
 * are the same shape and the same cost, and they differ in one thing: every
 * week of the projections span is a forecast that moves on injury news over
 * days, where the *newest* week of this one is being written to while games are
 * played. Half the window is what keeps a Sunday-afternoon total from reading
 * as a Sunday-morning one without asking Sleeper twice as often for the
 * seventeen weeks that cannot change.
 *
 * It is deliberately not `WEEK_STATS_TTL_MS`' twenty seconds: that is a live
 * scoreboard's cadence and this is a season total on a page of a hundred
 * league cards. Gametime is the tool that reads a week by the play.
 */
export const SEASON_STATS_TTL_MS = 15 * 60 * 1000;

/**
 * Weeks in flight at once for one span — `./ros-read`'s `ROS_FETCH_CONCURRENCY`,
 * mirrored rather than imported the way `player-seasons/loader/sleeper-source`
 * mirrors it, because it is the same host bounded for the same reason: the
 * whole span at once would take most of the process's Sleeper limiter slots for
 * the length of a cold read and hold every response until the last one landed.
 */
const SEASON_FETCH_CONCURRENCY = 4;

type SeasonCacheEntry = {
  key: string;
  at: number;
  board: Promise<SeasonStats>;
};

/**
 * One entry, not a map, on `./ros-read`'s reasoning: the app asks for one
 * season through one week at a time, and yesterday's `through` is not worth a
 * slot once the week turns. Cached on `globalThis` because a per-bundle copy
 * would refetch the whole span per route.
 */
const CACHE_KEY = Symbol.for("thelab.projections.season");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: SeasonCacheEntry;
};

/**
 * Every stat line of a season through `through`, folded into one board.
 *
 * Every week is fetched even when one fails — {@link SEASON_FETCH_CONCURRENCY}
 * bounds the burst — and one failure fails the span, which is `./ros-read`'s
 * rule and the same argument: a board silently missing week 3 would report
 * every roster a game light, and a number that is wrong by an unknown amount is
 * worse than no number. Callers treat a rejection as "no season totals" and
 * degrade rather than rethrowing at the reader.
 */
export function getSeasonStats(
  season: string,
  through: number,
): Promise<SeasonStats> {
  const last = clampWeek(through);
  const key = `${season}:${last}`;

  const cached = globalScope[CACHE_KEY];
  if (cached && cached.key === key && Date.now() - cached.at < SEASON_STATS_TTL_MS) {
    return awaitShared(cached.board, { label: `the ${key} season stats` });
  }

  const entry: SeasonCacheEntry = {
    key,
    at: Date.now(),
    board: fetchSpan(season, last),
  };
  globalScope[CACHE_KEY] = entry;

  entry.board.catch(() => {
    // Evict only our own entry — a newer span may already be underway.
    if (globalScope[CACHE_KEY] === entry) globalScope[CACHE_KEY] = undefined;
  });

  return awaitShared(entry.board, { label: `the ${key} season stats` });
}

/**
 * The span, under a policy belonging to nobody — `shared-wait`'s producer half,
 * on `./ros-read`'s argument verbatim. A cold span is up to eighteen requests
 * behind a concurrency of four, held for a quarter of an hour and shared by
 * every route that prices a roster: run under the budget of whichever reader
 * arrived first it would be abandoned twelve seconds in, having already spent
 * most of the traffic, and a reader's disconnect would reject a board several
 * other requests are awaiting. Callers bound their own wait instead.
 */
function fetchSpan(season: string, last: number): Promise<SeasonStats> {
  return withBackgroundSleeper(() => readSpan(season, last));
}

async function readSpan(season: string, last: number): Promise<SeasonStats> {
  const weeks: number[] = [];
  for (let week = 1; week <= last; week++) weeks.push(week);

  // Folded as each week lands rather than collected and folded at the end, so a
  // raw response is dropped the moment it has been read — `createRosFold`'s own
  // reason, and why the result does not depend on the order the weeks arrive
  // in. The callback returns nothing on purpose.
  const fold = createRosFold();
  await collectWithConcurrency(weeks, SEASON_FETCH_CONCURRENCY, async (week) => {
    // A week nobody has played answers an empty array — or a null body, which
    // the data host uses for "no data" and `sleeperGet` folds to the fallback.
    // Either way it contributes nothing, which is what lets a span reach past
    // the present without saying anything untrue. See `seasonToDateThrough`,
    // whose two widest arms depend on exactly that.
    const rows = await sleeperGet<SleeperProjection[]>(
      `${sleeperDataUrl("stats", "nfl", season, week)}?season_type=regular`,
      [],
    );
    fold.add({ week, rows });
  });

  return fold.finish();
}
