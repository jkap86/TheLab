/**
 * Ranking a manager's roster against the rest of their league.
 *
 * Pure, on the same terms as `./ros-lineups`: the caller supplies the league's
 * stored rosters, the projections board and the ADP map, and the ranking tests
 * without a database or a fetch. Runtime imports are relative with `.ts` for
 * the usual reason.
 *
 * **One solve per roster is the whole design.** `solveLeagueLineup` already
 * prices every player's points, draft capital *and* KeepTradeCut value onto the
 * lineup it returns, so eight of the nine metrics fall out of the solves the
 * rank needs anyway — there is no second valuation pass to drift from the
 * first. The ninth, `ktc_picks`, is the one thing not on a player, and it
 * arrives priced for the same reason. Every solve is returned,
 * totals attached: the expanded card lets the reader open any team in the
 * league, so the payload carries all of them, not just the manager's.
 * (It used to discard the others; the team picker is what reversed that.)
 *
 * **A forced KeepTradeCut board is four more ranks, not a second solve.** KTC
 * never enters the seating, so a column that has named its own market or QB
 * board changes what a roster is worth and nothing about who is in it:
 * {@link ktcMetricTotals} re-totals the lineups already in hand against a second
 * price table and the four ranks are filed under that variant's key, beside the
 * nine. A caller that has forced nothing passes no variants and gets exactly
 * what it always got — the timeline among them, which asks the league's own
 * board and nothing else.
 *
 * **A metric ranks null when every roster in the league totals zero on it.**
 * That one rule covers every degenerate case — no projections read (both ROS
 * metrics zero everywhere), no synced drafts (all three capital metrics), an
 * unreadable KTC board (all four KTC metrics), and a league read on the redraft
 * market, which carries no rookie-pick rows so `ktc_picks` is zero for
 * everyone. "1st of 12" among all-zero totals is a claim, not an answer. Ties
 * on a real total share the better rank and the next distinct total skips
 * ("1, 2, 2, 4"), so tied managers read the same honest number.
 */

import type {
  ColumnRanks,
  LeagueLineup,
  LineupMetricId,
  LineupPlayer,
  LineupRanks,
  MetricRank,
} from "@/shared/contract";

import { round } from "../projections/optimal.ts";
import type { RosProjections } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";
import { solveLeagueLineup } from "./ros-lineups.ts";
import type { RosLineupLeague } from "./ros-lineups.ts";

/** One stored roster, as `getManagerLeagueRosters` returns it. */
export type LeagueRosterRow = {
  roster_id: number;
  /** Null on orphan teams — commissioner-held, or an owner who left. */
  owner_id: string | null;
  players: readonly string[];
};

/** What one league contributes to the ranking — a row of `getManagerLeagueRosters`. */
export type RankLeague = {
  league_id: string;
  total_rosters: number;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  /** Every stored roster in the league, the manager's among them. */
  rosters: readonly LeagueRosterRow[];
};

/**
 * All nine metric totals off one solved lineup and the roster's pick portfolio.
 * Exported for the tests: the sums here are what the ranks compare, so their
 * edge rules — an unpriced player counts zero on every scale, the ROS bench
 * re-rounds the way the starters total already is — are pinned where they live.
 *
 * **`starters` and `bench` are a partition of the roster**, by construction:
 * `solveLeagueLineup` builds both out of one deduplicated player list, so the
 * two sums cannot double-count anyone or exceed the whole. That is why this
 * takes a lineup rather than walking the roster the way TheLabX's
 * `rosterKtcValue` has to (see `ktc/roster` for the version of this that does).
 *
 * **`ktc_total` is the only metric that includes the picks, and it includes all
 * three parts**: `ktc_starters + ktc_bench + ktc_picks`, so the four
 * reconcile exactly and a reader can see where a roster's worth sits. Capital
 * is deliberately not arranged that way — `capital_total` is the players alone,
 * because ADP prices a *player* and there is no pick ladder here to add.
 *
 * `pickValue` is what KTC prices this roster's future picks at, already summed
 * by the caller (`./league-teams`, which resolves each pick's tier against the
 * league's own draft order). Zero where the roster owns no priced pick —
 * including every roster in a league read on the redraft market — which the
 * all-zero rule above then reads correctly as "nothing to rank".
 */
export function lineupMetricTotals(
  lineup: LeagueLineup,
  pickValue = 0,
): Record<LineupMetricId, number> {
  const starterCapital = lineup.starters.reduce(
    (sum, seat) => sum + (seat.player?.adp_value ?? 0),
    0,
  );
  const benchCapital = lineup.bench.reduce(
    (sum, player) => sum + (player.adp_value ?? 0),
    0,
  );
  return {
    ros_starters: lineup.projected_points,
    ros_bench: round(
      lineup.bench.reduce((sum, player) => sum + (player.points ?? 0), 0),
    ),
    capital_total: starterCapital + benchCapital,
    capital_bench: benchCapital,
    capital_starters: starterCapital,
    ...ktcMetricTotals(lineup, (player) => player.ktc_value, pickValue),
  };
}

/** The four metrics a KeepTradeCut board answers. Extracted from the union so
 * the quartet cannot drift from the ids the contract names. */
export type KtcMetricId = Extract<LineupMetricId, `ktc_${string}`>;

/**
 * A roster's four KeepTradeCut totals, off one solved lineup and one price
 * table.
 *
 * Split out of {@link lineupMetricTotals} because the same four are summed from
 * two different sources and must be summed the same way. The card's own totals
 * read the price already hung on each seated player by the solve; a column that
 * has forced a market or a QB board reads a second table instead, over the
 * *same* lineup — KTC never enters the seating, so a forced board changes what
 * the roster is worth and not who is in it. One summation, two `price`
 * arguments, and the reconciliation `ktc_total = starters + bench + picks`
 * holds on both by construction rather than by two spellings agreeing.
 */
export function ktcMetricTotals(
  lineup: LeagueLineup,
  price: (player: LineupPlayer) => number | null,
  pickValue = 0,
): Record<KtcMetricId, number> {
  const starters = lineup.starters.reduce(
    (sum, seat) => sum + (seat.player ? (price(seat.player) ?? 0) : 0),
    0,
  );
  const bench = lineup.bench.reduce(
    (sum, player) => sum + (price(player) ?? 0),
    0,
  );
  return {
    ktc_total: starters + bench + pickValue,
    ktc_starters: starters,
    ktc_bench: bench,
    ktc_picks: pickValue,
  };
}

/** One roster's solve with its metric totals — what the teams pane renders from. */
export type RankedRoster = {
  roster: LeagueRosterRow;
  lineup: LeagueLineup;
  totals: Record<LineupMetricId, number>;
};

/**
 * Solve every roster in the league and rank the manager's on each metric.
 *
 * The manager is found by `owner_id` (first by the caller's roster order, in
 * the unlikely case Sleeper hands back two — co-ownership lives in `metadata`,
 * not here). A league holding no roster of theirs returns a null lineup and
 * all-null ranks; the query already filters those out, so hitting it means the
 * store moved between reads, and the route omits the league the way it always
 * has. `rosters` comes back in the caller's roster order either way — the
 * ranks and the teams pane must be read off the same set of solves.
 */
export function rankLeagueLineups(
  league: RankLeague,
  managerUserId: string,
  projections: RosProjections,
  adp: ReadonlyMap<string, AdpEntry>,
  ktc: ReadonlyMap<string, number> = new Map(),
  /**
   * Roster id → what KTC prices that roster's future picks at. Handed in rather
   * than derived, because the pick portfolios are reconstructed from the same
   * league row one layer up (`./league-teams`) and rebuilding them here would be
   * a second reconstruction to drift from the one the card renders.
   */
  pickValues: ReadonlyMap<number, number> = new Map(),
  /**
   * Extra KeepTradeCut pricings to rank the same rosters on, one per column
   * that has forced a market or a QB board. Empty for every caller that has not
   * — the timeline among them, which asks the league's own board and nothing
   * else. See {@link RankVariant}.
   */
  variants: readonly RankVariant[] = [],
): {
  lineup: LeagueLineup | null;
  ranks: ColumnRanks;
  rosters: RankedRoster[];
} {
  const solved = league.rosters.map((roster) => {
    const one: RosLineupLeague = {
      league_id: league.league_id,
      total_rosters: league.total_rosters,
      roster_positions: league.roster_positions,
      scoring_settings: league.scoring_settings,
      players: roster.players,
    };
    const lineup = solveLeagueLineup(one, projections, adp, ktc);
    const totals = lineupMetricTotals(
      lineup,
      pickValues.get(roster.roster_id) ?? 0,
    );
    return { roster, lineup, totals };
  });

  const managerIndex = solved.findIndex(
    ({ roster }) => roster.owner_id === managerUserId,
  );
  if (managerIndex < 0) {
    return { lineup: null, ranks: NO_RANKS, rosters: solved };
  }
  const manager = solved[managerIndex];

  const rankOn = (metric: LineupMetricId) =>
    rankAmong(solved.map(({ totals }) => totals[metric]), managerIndex);

  const base: LineupRanks = {
    ros_starters: rankOn("ros_starters"),
    ros_bench: rankOn("ros_bench"),
    capital_total: rankOn("capital_total"),
    capital_bench: rankOn("capital_bench"),
    capital_starters: rankOn("capital_starters"),
    ktc_total: rankOn("ktc_total"),
    ktc_starters: rankOn("ktc_starters"),
    ktc_bench: rankOn("ktc_bench"),
    ktc_picks: rankOn("ktc_picks"),
  };

  // A forced board is the same nine rosters re-totalled on a second price
  // table, so it is four more ranks rather than a second solve: `ktcMetricTotals`
  // reads the lineups already in hand. The keys are suffixed with the variant,
  // which is exactly what `lineupColumnKey` spells on the other side.
  const forced: Record<string, MetricRank | null> = {};
  for (const variant of variants) {
    const totals = solved.map(({ roster, lineup }) =>
      ktcMetricTotals(
        lineup,
        (player) => variant.values.get(player.player_id) ?? null,
        variant.pickValues.get(roster.roster_id) ?? 0,
      ),
    );
    for (const metric of KTC_METRIC_IDS) {
      forced[`${metric}:${variant.key}`] = rankAmong(
        totals.map((one) => one[metric]),
        managerIndex,
      );
    }
  }

  return {
    lineup: manager.lineup,
    ranks: { ...forced, ...base },
    rosters: solved,
  };
}

/**
 * One extra KeepTradeCut pricing to rank on: the prices, the roster pick
 * totals they imply, and the key its four ranks are filed under.
 *
 * The caller resolves the variant's `auto` halves against the league before it
 * gets here — this module knows nothing about markets, only about a second
 * table of numbers over the same rosters.
 */
export type RankVariant = {
  /** `dynasty:sf` — see `ktcVariantKey`, which is what writes it. */
  key: string;
  /** Sleeper player id → price on this variant's board; unpriced ids absent. */
  values: ReadonlyMap<string, number>;
  /** Roster id → what this variant's board prices that roster's picks at. */
  pickValues: ReadonlyMap<number, number>;
};

/** The four KTC metrics, in canonical order — the ids a variant re-ranks. */
const KTC_METRIC_IDS: readonly KtcMetricId[] = [
  "ktc_total",
  "ktc_starters",
  "ktc_bench",
  "ktc_picks",
];

/**
 * Standard competition rank of one figure among the league's, or null where
 * every figure is zero.
 *
 * By index rather than by value, because two rosters can legitimately total the
 * same and the manager's own row has to be the one read — and one function
 * rather than two, so the base ranks and a forced board's cannot come to
 * disagree about what a tie or an all-zero column means.
 */
function rankAmong(totals: readonly number[], mine: number): MetricRank | null {
  const value = totals[mine];
  let ahead = 0;
  let anyNonZero = false;
  for (const total of totals) {
    if (total !== 0) anyNonZero = true;
    if (total > value) ahead += 1;
  }
  // Every roster at zero is the metric having nothing to say, not a tie for
  // first — see the module note.
  if (!anyNonZero) return null;
  return { rank: ahead + 1, of: totals.length };
}

/** A league the manager holds no roster in: every metric unanswerable. */
const NO_RANKS: LineupRanks = {
  ros_starters: null,
  ros_bench: null,
  capital_total: null,
  capital_bench: null,
  capital_starters: null,
  ktc_total: null,
  ktc_starters: null,
  ktc_bench: null,
  ktc_picks: null,
};
