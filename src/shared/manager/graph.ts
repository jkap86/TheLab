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
import { collectWithConcurrency, mapWithConcurrency } from "@/shared/util";

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
 * Per-league cap on child requests in flight, for the two fan-outs whose width
 * is *data* rather than a constant: the weeks of both week-keyed collections,
 * and the league's drafts.
 *
 * Both weekly collections are fetched here, so an unbounded fan-out would put
 * two requests per week of the horizon on the wire at once — ~36 for a league
 * being backfilled mid-season, times the batch's own league concurrency. The
 * bound keeps the burst roughly where the transaction fetch alone used to leave
 * it; the cost is a couple of extra round-trip waves on a first sync.
 *
 * The draft-pick fetch takes the same budget rather than one of its own, and it
 * can: the two fan-outs run one after the other, so nothing here doubles the
 * per-league burst. A league's draft list grows with its history — a long-running
 * dynasty carries a startup and a rookie draft per season — so
 * `Promise.all(drafts.map(…))` was the shape this repo already names as the trap
 * (see `collectWithConcurrency`): harmless-looking, and unbounded in a number
 * nobody chose.
 */
const CHILD_FETCH_CONCURRENCY = 8;

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
 *
 * `fresh` is the cache-busting token, threaded through **every** request this
 * makes and minted once per press by `refreshLeague` — the one caller that
 * presses a single league and is asking precisely because something changed a
 * moment ago (see `sleeper/fresh`). One token for the whole graph rather than
 * one per request, so the ~11 collections are read from a single instant rather
 * than from eleven. Every other caller is the manager sync or the crawler,
 * which want the CDN copy and pass nothing.
 */
export async function fetchLeagueGraph(
  league: SleeperLeague,
  weeks: GraphWeeks,
  { fresh }: { fresh?: string } = {},
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
    getLeagueRosters(league.league_id, fresh),
    getLeagueUsers(league.league_id, fresh),
    getLeagueTradedPicks(league.league_id, fresh),
    getLeagueDrafts(league.league_id, fresh),
    mapWithConcurrency(jobs, CHILD_FETCH_CONCURRENCY, async (job) => {
      if (job.kind === "tx") {
        transactions.push(
          ...(await getLeagueTransactions(league.league_id, job.week, fresh)),
        );
        return;
      }
      // Tagged on arrival: a matchup row names its roster but not its week, and
      // the request is the only place the week is known.
      const week = await getLeagueMatchups(league.league_id, job.week, fresh);
      matchups.push(...week.map((m) => ({ ...m, week: job.week })));
    }),
  ]);

  // `collectWithConcurrency` rather than `mapWithConcurrency`, because the order
  // of the flattened result is the drafts' own order and a caller zipping picks
  // back against the drafts they came from is exactly what it keeps. A single
  // draft's failure still rejects the whole graph, as before: a partial pick set
  // would be persisted as if it were the draft's whole board.
  const draftPicks = (
    await collectWithConcurrency(drafts, CHILD_FETCH_CONCURRENCY, (d) =>
      getDraftPicks(d.draft_id, fresh),
    )
  ).flat();

  return {
    league, rosters, users, tradedPicks, drafts, draftPicks,
    transactions, txWeeks, matchups, matchupWeeks,
  };
}
