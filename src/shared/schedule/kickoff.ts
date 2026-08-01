import { getNflSchedule } from "@/shared/sleeper";

import { openingKickoff } from "./parse";

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
