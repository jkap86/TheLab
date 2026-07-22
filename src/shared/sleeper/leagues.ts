import http from "@thelab/http";

import { SLEEPER_API_BASE } from "./client";
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
export async function getUserLeagues(
  userId: string,
  season: string = DEFAULT_SEASON,
): Promise<SleeperLeague[]> {
  const { data } = await http.get<SleeperLeague[] | null>(
    `${SLEEPER_API_BASE}/user/${encodeURIComponent(userId)}/leagues/nfl/${season}`,
  );
  return data ?? [];
}

/** All rosters (teams) in a league. */
export async function getLeagueRosters(
  leagueId: string,
): Promise<SleeperRoster[]> {
  const { data } = await http.get<SleeperRoster[] | null>(
    `${SLEEPER_API_BASE}/league/${leagueId}/rosters`,
  );
  return data ?? [];
}

/** All members of a league. */
export async function getLeagueUsers(
  leagueId: string,
): Promise<SleeperLeagueUser[]> {
  const { data } = await http.get<SleeperLeagueUser[] | null>(
    `${SLEEPER_API_BASE}/league/${leagueId}/users`,
  );
  return data ?? [];
}

/** Traded future draft-pick assets in a league. */
export async function getLeagueTradedPicks(
  leagueId: string,
): Promise<SleeperTradedPick[]> {
  const { data } = await http.get<SleeperTradedPick[] | null>(
    `${SLEEPER_API_BASE}/league/${leagueId}/traded_picks`,
  );
  return data ?? [];
}

/** Drafts belonging to a league (usually one). */
export async function getLeagueDrafts(
  leagueId: string,
): Promise<SleeperDraft[]> {
  const { data } = await http.get<SleeperDraft[] | null>(
    `${SLEEPER_API_BASE}/league/${leagueId}/drafts`,
  );
  return data ?? [];
}

/** Every pick made in a draft. */
export async function getDraftPicks(
  draftId: string,
): Promise<SleeperDraftPick[]> {
  const { data } = await http.get<SleeperDraftPick[] | null>(
    `${SLEEPER_API_BASE}/draft/${draftId}/picks`,
  );
  return data ?? [];
}

/**
 * Roster moves (waivers, free agents, trades, commissioner) for a single week.
 * Sleeper has no "all transactions" endpoint — they are keyed by week, so a full
 * league history is the union of each week. Offseason activity lives at week 1.
 */
export async function getLeagueTransactions(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[]> {
  const { data } = await http.get<SleeperTransaction[] | null>(
    `${SLEEPER_API_BASE}/league/${leagueId}/transactions/${week}`,
  );
  return data ?? [];
}
