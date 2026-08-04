import {
  getDraftPicks,
  getLeagueDrafts,
  getLeagueMatchups,
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
  SleeperMatchup,
  SleeperRoster,
  SleeperTradedPick,
  SleeperTransaction,
} from "@/shared/sleeper";
import { mapWithConcurrency } from "@/shared/util";

/** Inclusive week range of transactions fetched for a league this sync. */
export type WeekRange = { from: number; to: number };

/** A roster's week, tagged with the week it belongs to (Sleeper's row is not). */
export type WeekMatchup = SleeperMatchup & { week: number };

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
  /** Every roster's scoring across every fetched week, flattened. */
  matchups: WeekMatchup[];
  /** Which weeks {@link matchups} covers, so persistence replaces only those. */
  matchupWeeks: WeekRange;
};

/** Which weeks of which collection one sync fetches for a league. */
export type GraphWeeks = { transactions: WeekRange; matchups: WeekRange };

/**
 * Per-league cap on week requests in flight.
 *
 * Both weekly collections are fetched here, so an unbounded fan-out would put
 * two requests per week of the horizon on the wire at once — ~36 for a league
 * being backfilled mid-season, times the batch's own league concurrency. The
 * bound keeps the burst roughly where the transaction fetch alone used to leave
 * it; the cost is a couple of extra round-trip waves on a first sync.
 */
const WEEK_FETCH_CONCURRENCY = 8;

const weeksIn = ({ from, to }: WeekRange): number[] => {
  const weeks: number[] = [];
  for (let w = from; w <= to; w++) weeks.push(w);
  return weeks;
};

/**
 * Fetch a league and all of its child collections from Sleeper.
 *
 * The two weekly collections — transactions and matchups — are fetched only for
 * the weeks `weeks` names (Sleeper keys both by week and has no all-at-once
 * endpoint for either) and flattened. They carry *separate* ranges because they
 * fill up independently: a league synced before matchups were stored has
 * transactions to the current week and no matchups at all, so a shared range
 * would skip its whole season. Callers pass the full range on a first sync and a
 * short tail window on refreshes — see {@link syncManagerLeagues}.
 */
export async function fetchLeagueGraph(
  league: SleeperLeague,
  weeks: GraphWeeks,
): Promise<LeagueGraph> {
  const txWeeks = weeks.transactions;
  const matchupWeeks = weeks.matchups;

  // One bounded pool over both collections' weeks, so the two ranges share the
  // per-league budget rather than each claiming it.
  const jobs: Array<
    { kind: "tx"; week: number } | { kind: "matchup"; week: number }
  > = [
    ...weeksIn(txWeeks).map((week) => ({ kind: "tx" as const, week })),
    ...weeksIn(matchupWeeks).map((week) => ({ kind: "matchup" as const, week })),
  ];

  const transactions: SleeperTransaction[] = [];
  const matchups: WeekMatchup[] = [];

  const [rosters, users, tradedPicks, drafts] = await Promise.all([
    getLeagueRosters(league.league_id),
    getLeagueUsers(league.league_id),
    getLeagueTradedPicks(league.league_id),
    getLeagueDrafts(league.league_id),
    mapWithConcurrency(jobs, WEEK_FETCH_CONCURRENCY, async (job) => {
      if (job.kind === "tx") {
        transactions.push(
          ...(await getLeagueTransactions(league.league_id, job.week)),
        );
        return;
      }
      // Tagged on arrival: a matchup row names its roster but not its week, and
      // the request is the only place the week is known.
      const week = await getLeagueMatchups(league.league_id, job.week);
      matchups.push(...week.map((m) => ({ ...m, week: job.week })));
    }),
  ]);

  const draftPicks = (
    await Promise.all(drafts.map((d) => getDraftPicks(d.draft_id)))
  ).flat();

  return {
    league, rosters, users, tradedPicks, drafts, draftPicks,
    transactions, txWeeks, matchups, matchupWeeks,
  };
}
