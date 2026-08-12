import { getNflSchedule } from "@/shared/sleeper";

import { openingKickoff, weekKickoffs } from "./parse";

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

type WeekCacheEntry = { at: number; kickoffs: Map<string, number> };

const weekCache = new Map<string, WeekCacheEntry>();

/**
 * Team → kickoff instant for one week of a season, per Sleeper's schedule call
 * — empty when Sleeper hasn't scheduled it, or schedules it only to the day.
 *
 * The same read-through cache as {@link getFirstKickoff}, one entry per
 * `(season, week)`, and the same three rules: the timestamp records the
 * *attempt*, so a week answering empty waits out its shorter TTL instead of
 * refetching per request; a failed fetch stores nothing and serves the stale
 * answer if one exists; and a failure never throws — the kickoff-ordered
 * lineup this feeds is decoration on top of the week's lineups, so the
 * degraded answer is "no instants", which its reader spells as no answer
 * rather than as a lineup claimed to be already ordered.
 */
export async function getWeekKickoffs(
  season: string,
  week: number,
): Promise<Map<string, number>> {
  const key = `${season}:${week}`;
  const hit = weekCache.get(key);
  if (hit) {
    const ttl = hit.kickoffs.size === 0 ? RETRY_NULL_MS : FRESH_MS;
    if (Date.now() - hit.at < ttl) return hit.kickoffs;
  }

  try {
    const games = await getNflSchedule(season);
    const kickoffs = weekKickoffs(games, week);
    weekCache.set(key, { at: Date.now(), kickoffs });
    return kickoffs;
  } catch {
    return hit?.kickoffs ?? new Map();
  }
}
