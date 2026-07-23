import {
  getDraftPicks,
  getLeagueDrafts,
  getLeagueRosters,
  getLeagueTradedPicks,
  getLeagueTransactions,
  getLeagueUsers,
} from "@/shared/sleeper";
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperRoster,
  SleeperTradedPick,
  SleeperTransaction,
} from "@/shared/sleeper";

/** Inclusive week range of transactions fetched for a league this sync. */
export type WeekRange = { from: number; to: number };

/** A league plus every child collection fetched from Sleeper for one sync. */
export type LeagueGraph = {
  league: SleeperLeague;
  rosters: SleeperRoster[];
  users: SleeperLeagueUser[];
  tradedPicks: SleeperTradedPick[];
  drafts: SleeperDraft[];
  /** Picks across every draft, flattened. */
  draftPicks: SleeperDraftPick[];
  /** Roster moves across every fetched week, flattened. */
  transactions: SleeperTransaction[];
  /** Which weeks {@link transactions} covers, so persistence replaces only those. */
  txWeeks: WeekRange;
};

/**
 * Fetch a league and all of its child collections from Sleeper. Transactions are
 * fetched only for `txWeeks.from..txWeeks.to` (Sleeper keys them by week and has
 * no all-at-once endpoint) and flattened. Callers pass the full range on a first
 * sync and a short tail window on refreshes — see {@link syncManagerLeagues}.
 */
export async function fetchLeagueGraph(
  league: SleeperLeague,
  txWeeks: WeekRange,
): Promise<LeagueGraph> {
  const weeks: number[] = [];
  for (let w = txWeeks.from; w <= txWeeks.to; w++) weeks.push(w);

  const [rosters, users, tradedPicks, drafts, transactions] = await Promise.all([
    getLeagueRosters(league.league_id),
    getLeagueUsers(league.league_id),
    getLeagueTradedPicks(league.league_id),
    getLeagueDrafts(league.league_id),
    Promise.all(
      weeks.map((week) => getLeagueTransactions(league.league_id, week)),
    ).then((byWeek) => byWeek.flat()),
  ]);

  const draftPicks = (
    await Promise.all(drafts.map((d) => getDraftPicks(d.draft_id)))
  ).flat();

  return {
    league, rosters, users, tradedPicks, drafts, draftPicks, transactions, txWeeks,
  };
}
