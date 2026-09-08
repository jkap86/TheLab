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
  /**
   * Picks across every draft whose board was fetched this sync, flattened. A
   * draft already stored `complete` with its picks is skipped — see
   * {@link fetchLeagueGraph}'s `completeDraftIds` — so its picks are absent
   * here, and persistence must read that absence as "unchanged", never "none".
   */
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

/** The default for a caller that has not asked what is stored: skip nothing. */
const EMPTY_DRAFT_IDS: ReadonlySet<string> = new Set();

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
 *
 * `completeDraftIds` names the drafts whose picks are **not** fetched: the ones
 * already stored `complete` with a board behind them (`getStoredCompleteDraftIds`).
 * A completed draft is immutable — a pick is never un-picked and a finished
 * board never grows — so re-reading it is one Sleeper request per draft per
 * sync, and a dynasty league carries a startup plus a rookie draft per season,
 * spent to delete and re-insert rows that cannot have changed. The draft *rows*
 * are still fetched and upserted: `status` only ever moves forward, and `drafts`
 * are never deleted. The skip applies to the `fresh` press too — immutable is
 * immutable, whoever asked.
 */
export async function fetchLeagueGraph(
  league: SleeperLeague,
  weeks: GraphWeeks,
  {
    fresh,
    completeDraftIds = EMPTY_DRAFT_IDS,
  }: { fresh?: string; completeDraftIds?: ReadonlySet<string> } = {},
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
  //
  // Filtered on the *stored* state rather than on the fetched `status`: what
  // makes a board safe to skip is that its picks are already in Postgres whole,
  // which the fetched row cannot say. `writeLeagueGraph` scopes its pick delete
  // to the drafts present in the payload, so a skipped draft's stored picks are
  // left exactly as they are.
  const draftPicks = (
    await collectWithConcurrency(
      drafts.filter((d) => !completeDraftIds.has(d.draft_id)),
      CHILD_FETCH_CONCURRENCY,
      (d) => getDraftPicks(d.draft_id, fresh),
    )
  ).flat();

  return {
    league, rosters, users, tradedPicks, drafts, draftPicks,
    transactions, txWeeks, matchups, matchupWeeks,
  };
}
