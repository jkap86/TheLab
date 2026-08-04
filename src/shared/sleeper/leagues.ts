import type { AxiosError } from "@thelab/http";

import { sleeperGet, sleeperUrl } from "./client";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperRoster,
  SleeperTradedPick,
  SleeperTransaction,
} from "./types";

/** NFL season this app pulls league data for. */
export const DEFAULT_SEASON = "2026";

/** Leagues a user belongs to in a given season. */
export function getUserLeagues(
  userId: string,
  season: string = DEFAULT_SEASON,
): Promise<SleeperLeague[]> {
  return sleeperGet(sleeperUrl("user", userId, "leagues", "nfl", season), []);
}

/**
 * A single league by id, or null when Sleeper has no such league (deleted, or
 * never existed).
 *
 * Usually that is 200 with a null body — Sleeper's convention — but this
 * endpoint does also answer 404 for some ids, so both are folded into the same
 * null, the way `getSleeperUser` folds them. The distinction is one
 * callers cannot act on and the crawler must not: it tombstones on this answer,
 * and a 404 that threw instead left the league due forever, burning a claim slot
 * and a Sleeper request on every rotation.
 */
export async function getLeague(
  leagueId: string,
): Promise<SleeperLeague | null> {
  try {
    return await sleeperGet<SleeperLeague | null>(
      sleeperUrl("league", leagueId),
      null,
    );
  } catch (error) {
    if ((error as AxiosError).response?.status === 404) return null;
    throw error;
  }
}

/** All rosters (teams) in a league. */
export function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return sleeperGet(sleeperUrl("league", leagueId, "rosters"), []);
}

/** All members of a league. */
export function getLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
  return sleeperGet(sleeperUrl("league", leagueId, "users"), []);
}

/** Traded future draft-pick assets in a league. */
export function getLeagueTradedPicks(
  leagueId: string,
): Promise<SleeperTradedPick[]> {
  return sleeperGet(sleeperUrl("league", leagueId, "traded_picks"), []);
}

/** Drafts belonging to a league (usually one). */
export function getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  return sleeperGet(sleeperUrl("league", leagueId, "drafts"), []);
}

/** Every pick made in a draft. */
export function getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  return sleeperGet(sleeperUrl("draft", draftId, "picks"), []);
}

/**
 * Roster moves (waivers, free agents, trades, commissioner) for a single week.
 * Sleeper has no "all transactions" endpoint — they are keyed by week, so a full
 * league history is the union of each week. Offseason activity lives at week 1.
 */
export function getLeagueTransactions(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[]> {
  return sleeperGet(sleeperUrl("league", leagueId, "transactions", week), []);
}
