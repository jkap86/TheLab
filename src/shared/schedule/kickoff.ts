import { getNflSchedule } from "@/shared/sleeper";

import { openingKickoff, weekGames } from "./parse";
import type { TeamGame } from "./parse";

/**
 * A published schedule's opener moves essentially never, so half a day of
 * staleness costs nothing. A season with *no* scheduled instant yet retries
 * sooner — that is the answer that changes, the day each spring Sleeper
 * publishes the schedule.
 */
const FRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_NULL_MS = 60 * 60 * 1000;

type CacheEntry = { at: number; kickoff: number | null };

const cache = new Map<string, CacheEntry>();

/**
 * The instant of a season's opening kickoff, per Sleeper's schedule call —
 * null when Sleeper hasn't scheduled it (or schedules it only to the day).
 *
 * A read-through in-memory cache rather than a synced table, deliberately:
 * this is one small request per process per half-day for a value that barely
 * moves, which is too light to earn a table, a migration or an advisory lock
 * — the locks exist to keep instances from multiplying *heavy* load. What the
 * cache must still do is keep a page view from fanning out to Sleeper, and it
 * follows the projection gate's lesson in miniature: the timestamp records
 * the *attempt*, so a season answering null waits out its own TTL instead of
 * refetching per request, while a failed fetch stores nothing, serves the
 * stale answer if one exists, and stays eager.
 */
export async function getFirstKickoff(season: string): Promise<number | null> {
  const hit = cache.get(season);
  if (hit) {
    const ttl = hit.kickoff === null ? RETRY_NULL_MS : FRESH_MS;
    if (Date.now() - hit.at < ttl) return hit.kickoff;
  }

  try {
    const games = await getNflSchedule(season);
    const kickoff = openingKickoff(games);
    cache.set(season, { at: Date.now(), kickoff });
    return kickoff;
  } catch {
    // Decide per read whether a failure is fatal: a countdown is decoration
    // on the header, so a stale instant — or none — beats a failed page.
    return hit?.kickoff ?? null;
  }
}

type WeekCacheEntry = { at: number; games: Map<string, TeamGame> };

const weekCache = new Map<string, WeekCacheEntry>();

/**
 * Team → its game for one week of a season, per Sleeper's schedule call —
 * empty when Sleeper hasn't scheduled it.
 *
 * The same read-through cache as {@link getFirstKickoff}, one entry per
 * `(season, week)`, and the same three rules: the timestamp records the
 * *attempt*, so a week answering empty waits out its shorter TTL instead of
 * refetching per request; a failed fetch stores nothing and serves the stale
 * answer if one exists; and a failure never throws — everything read off this
 * sits on top of a week's lineups rather than under them, so the degraded
 * answer is "no schedule", which each reader spells for itself (no ordering,
 * no opponent named) rather than as a claim it can't support.
 *
 * **One entry serves both readers**, which is why the cache holds the games
 * and not the instants: the week panel names each player's opponent and
 * kickoff off the same fetch the lineup ordering reads its instants from.
 */
export async function getWeekGames(
  season: string,
  week: number,
): Promise<Map<string, TeamGame>> {
  const key = `${season}:${week}`;
  const hit = weekCache.get(key);
  if (hit) {
    const ttl = hit.games.size === 0 ? RETRY_NULL_MS : FRESH_MS;
    if (Date.now() - hit.at < ttl) return hit.games;
  }

  try {
    const schedule = await getNflSchedule(season);
    const games = weekGames(schedule, week);
    weekCache.set(key, { at: Date.now(), games });
    return games;
  } catch {
    return hit?.games ?? new Map();
  }
}

/**
 * Team → kickoff instant for one week of a season, epoch ms — empty when
 * Sleeper hasn't scheduled it, or schedules it only to the day.
 *
 * {@link getWeekGames} narrowed to the dated games, so the two reads share one
 * fetch and one cache entry and cannot disagree about which listing of a team
 * won — see `weekKickoffs`, whose rule this is.
 */
export async function getWeekKickoffs(
  season: string,
  week: number,
): Promise<Map<string, number>> {
  const kickoffs = new Map<string, number>();

  for (const [team, game] of await getWeekGames(season, week)) {
    if (game.kickoff !== null) kickoffs.set(team, game.kickoff);
  }

  return kickoffs;
}
