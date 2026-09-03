import { getNflWeekScores } from "@/shared/sleeper";

import { weekGames } from "./parse";
import type { TeamGame } from "./parse";

/**
 * A published schedule barely moves, so half a day of staleness costs nothing.
 * A week Sleeper has *not* scheduled retries sooner — that is the answer that
 * changes, the day the schedule is published.
 */
const FRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_EMPTY_MS = 60 * 60 * 1000;

type WeekCacheEntry = { at: number; games: Map<string, TeamGame> };

/**
 * One entry per `(season, week)`, on `globalThis` for the reason the Sleeper
 * limiter and the projections board are: Next builds a module instance per
 * route bundle, and a per-bundle copy would refetch the schedule for every
 * route that asked — with nothing able to tell you it was happening.
 *
 * Unbounded is fine here where it would not be for a projections board: an
 * entry is ~32 teams of three small fields, so a whole season of them is
 * smaller than one week of players.
 */
const CACHE_KEY = Symbol.for("thelab.schedule.weeks");
const globalScope = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Map<string, WeekCacheEntry>;
};
const cache = (globalScope[CACHE_KEY] ??= new Map<string, WeekCacheEntry>());

/**
 * Team → its game for one week: the opponent, which end of it they are, and
 * the kickoff instant. Empty when Sleeper has not scheduled the week.
 *
 * A read-through in-memory cache rather than a synced table, deliberately:
 * one small request per process per half-day for a value that barely moves is
 * too light to earn a table, a migration and an advisory lock — those exist to
 * keep instances from multiplying *heavy* load. What the cache must still do is
 * keep a page view from fanning out to Sleeper.
 *
 * Three rules, and each is the projections gate's lesson in miniature:
 *
 * - **The timestamp records the *attempt*, not the answer**, so a week that
 *   answers empty waits out its own (shorter) TTL rather than refetching on
 *   every request.
 * - **A failed fetch stores nothing**, serves the stale answer if there is one,
 *   and stays eager — the `memoize-manager-lookup` rule, where remembering a
 *   failure for the TTL is an outage extended by the mechanism meant to absorb
 *   one.
 * - **It never throws.** Everything read off this sits on *top* of a week's
 *   lineups rather than under them, so the degraded answer is "no schedule",
 *   which each reader spells for itself — no ordering, no lock refinement —
 *   rather than as a claim it cannot support.
 *
 * **One entry serves both readers**, which is why the cache holds the games and
 * not the instants: a caller naming a player's opponent and a caller ordering
 * his seat read the same fetch.
 */
export async function getWeekGames(
  season: string,
  week: number,
): Promise<Map<string, TeamGame>> {
  const key = `${season}:${week}`;
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.games.size === 0 ? RETRY_EMPTY_MS : FRESH_MS;
    if (Date.now() - hit.at < ttl) return hit.games;
  }

  try {
    const games = weekGames(await getNflWeekScores(season, week));
    cache.set(key, { at: Date.now(), games });
    return games;
  } catch {
    return hit?.games ?? new Map();
  }
}

/**
 * Team → kickoff instant for one week, epoch ms — what a kickoff-ordered lineup
 * (`projections/kickoff-order`) reads a player's game time from, through the
 * NFL team on his projection row.
 *
 * **Derived from {@link getWeekGames} rather than fetched for itself**, so the
 * two share one request and one cache entry and cannot disagree about which
 * listing of a team won. Undated games drop out: an absent team is "not known",
 * which the ordering answers by holding the seat rather than by guessing.
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
