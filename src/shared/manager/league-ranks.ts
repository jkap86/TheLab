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
 * lineup it returns, so nine of the ten metrics fall out of the solves the
 * rank needs anyway — there is no second valuation pass to drift from the
 * first. The ninth, `ktc_picks`, is the one thing not on a player, and it
 * arrives priced for the same reason. Every solve is returned,
 * totals attached: the expanded card lets the reader open any team in the
 * league, so the payload carries all of them, not just the manager's.
 * (It used to discard the others; the team picker is what reversed that.)
 *
 * **A forced board is more ranks, not a second solve.** KTC never enters the
 * seating, so a column that has named its own market or QB board changes what a
 * roster is worth and nothing about who is in it: {@link ktcMetricTotals}
 * re-totals the lineups already in hand against a second price table and the
 * four ranks are filed under that variant's key, beside the ten. A forced *ADP*
 * board is the same move one valuation over — {@link capitalMetricTotals}
 * against a second draft aggregate, three ranks — and it is the one place the
 * rule had to be *held to* rather than merely observed: `adp_value` is a
 * tiebreak inside the solve, so a forced board could have re-seated the
 * unprojected. It does not. The lineup a card shows is the one the league's own
 * board seated, and every column on the card ranks the manager on that lineup.
 * A caller that has forced nothing passes no variants and gets exactly what it
 * always got — the timeline among them, which asks the league's own boards and
 * nothing else.
 *
 * **A position narrowing is a third way to total the same solves, and it must
 * never be a second seating.** A column narrowed to `QB` asks what the
 * quarterbacks on a roster are worth, not what the roster would look like if
 * only quarterbacks could be started — so `lineupMetricTotals` takes the set
 * and sums over fewer players, while the lineup underneath is the one the
 * manager actually fields. Re-solving would rank them on a lineup nobody has,
 * and the seats on the card beside the rank would be a different roster's. The
 * narrowed ranks are filed under the key {@link lineupColumnKey} writes, and
 * `positionSetKey` is imported rather than re-spelled for that reason: a key
 * spelled twice is a rank the card looks up and does not find.
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
  LineupPosition,
  LineupRanks,
  LineupSlot,
  MetricRank,
} from "@/shared/contract";

import { positionKeySuffix, slotKeySuffix } from "../ktc/columns.ts";
import { round } from "../projections/optimal.ts";
import { playsPosition } from "../projections/positions.ts";
import type { RosProjections } from "../projections/ros.ts";
import {
  adpEntryValue,
  DEFAULT_STEEPNESS,
  leagueAdpPool,
} from "./adp-value.ts";
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
 * All ten metric totals off one solved lineup and the roster's pick portfolio.
 * Exported for the tests: the sums here are what the ranks compare, so their
 * edge rules — an unpriced player counts zero on every scale, the ROS bench
 * re-rounds the way the starters total already is — are pinned where they live.
 *
 * **`starters` and `bench` are a partition of the roster**, by construction:
 * `solveLeagueLineup` builds both out of one deduplicated player list, so the
 * two sums cannot double-count anyone or exceed the whole. That is why this
 * takes a lineup rather than walking the roster the way TheLabX's
 * `rosterKtcValue` has to (see `ktc/roster` for the version of this that does).
 * A narrowing preserves that partition rather than replacing it — see
 * {@link countedRoster}.
 *
 * **`ktc_total` is the only metric that includes the picks, and it includes all
 * three parts**: `ktc_starters + ktc_bench + ktc_picks`, so the four
 * reconcile exactly and a reader can see where a roster's worth sits — under a
 * narrowing too, where the third part is zero for the reason
 * {@link countedPicks} gives. Capital is deliberately not arranged that way —
 * `capital_total` is the players alone, because ADP prices a *player* and there
 * is no pick ladder here to add.
 *
 * `pickValue` is what KTC prices this roster's future picks at, already summed
 * by the caller (`./league-teams`, which resolves each pick's tier against the
 * league's own draft order). Zero where the roster owns no priced pick —
 * including every roster in a league read on the redraft market — which the
 * all-zero rule above then reads correctly as "nothing to rank".
 *
 * `positions` and `slots` narrow **what is counted and nothing else**. An empty
 * set on either is the absence of a narrowing, and the answer two empty sets
 * give is byte-identical to the one this returned before either axis existed —
 * which is what keeps every column that has not narrowed on exactly the ranks
 * it always had, under exactly the keys it always had.
 *
 * **A slot narrowing empties the bench, and the three metrics that reads
 * through to are unanswerable rather than zero.** A bench player occupies no
 * seat, so `ros_bench`, `capital_bench` and `ktc_bench` come back zero on every
 * roster in the league under one — and the all-zero rule then reads that as
 * nothing to rank and the card draws an em dash, which is the honest state for a
 * question the bench cannot answer. It is exactly {@link countedPicks}' arm one
 * half over, and it is a belt to the braces `column()` already provides: that
 * constructor refuses to hang a slot set on anything but a starters metric, so
 * nothing a reader can press reaches this. What it genuinely guards is a stored
 * value hand-edited or written by a later build.
 */
export function lineupMetricTotals(
  lineup: LeagueLineup,
  pickValue = 0,
  positions: readonly LineupPosition[] = [],
  slots: readonly LineupSlot[] = [],
): Record<LineupMetricId, number> {
  const roster = countedRoster(lineup, positions, slots);
  // **The un-narrowed figure is read off the lineup, never re-summed here.**
  // `projected_points` is the number the card prints beside this rank and the
  // solver has already `round`ed it over these very seats, so a second
  // summation could only ever disagree with it — at the last decimal, with
  // nothing on screen saying which of the two was wrong. A narrowed figure has
  // no such field to read and takes the same `round`, which is the convention
  // `ros_bench` is on below and the one the solver used.
  const starters =
    positions.length === 0 && slots.length === 0
      ? lineup.projected_points
      : round(sumOf(roster.starters, (player) => player.points));
  const bench = round(sumOf(roster.bench, (player) => player.points));
  return {
    // **Summed from the two halves rather than from the roster**, so the three
    // reconcile exactly — `ros_total = ros_starters + ros_bench` — the way the
    // KeepTradeCut quartet does and for the same reason: a reader adding the
    // tiles up must not find the sum wrong. Re-summing the players instead
    // would round once where this rounds twice, which is a cent of disagreement
    // on a card that shows both. The outer `round` is float dust, not a third
    // rounding: both operands already carry two decimals.
    ros_total: round(starters + bench),
    ros_starters: starters,
    ros_bench: bench,
    ...capitalTotalsOf(roster, (player) => player.adp_value),
    ...ktcTotalsOf(
      roster,
      (player) => player.ktc_value,
      countedPicks(pickValue, positions, slots),
    ),
  };
}

/** The three metrics an ADP board answers. Extracted from the union so the trio
 * cannot drift from the ids the contract names. */
export type CapitalMetricId = Extract<LineupMetricId, `capital_${string}`>;

/**
 * A roster's three draft-capital totals, off one solved lineup and one price
 * function.
 *
 * Split out of {@link lineupMetricTotals} on {@link ktcMetricTotals}' exact
 * terms, and it arrived for the same reason one axis over: the ADP fold splits
 * superflex drafts from standard ones, so a column that has forced a QB board
 * is the same lineups priced against a second table. **The seating does not
 * move**, which is the one thing worth restating here rather than assuming:
 * `adp_value` is a tiebreak inside `solveLeagueLineup` and the lineup a card
 * shows is the one that league's own board seated, so a forced board changes
 * what a roster's capital is worth and not who is in it. That is the rule the
 * KeepTradeCut columns have always lived by, held to on an axis that *could*
 * have re-seated — a re-solve would rank the manager on a lineup nobody fields.
 */
export function capitalMetricTotals(
  lineup: LeagueLineup,
  price: (player: LineupPlayer) => number | null,
  positions: readonly LineupPosition[] = [],
  slots: readonly LineupSlot[] = [],
): Record<CapitalMetricId, number> {
  return capitalTotalsOf(countedRoster(lineup, positions, slots), price);
}

/**
 * The trio itself, over players already counted. One summation behind both
 * entry points, so `capital_total = capital_starters + capital_bench` holds on
 * the league's own board and on a forced one alike.
 *
 * Capital is deliberately not arranged the way the KTC quartet is —
 * `capital_total` is the players alone, because ADP prices a *player* and there
 * is no pick ladder here to add.
 */
function capitalTotalsOf(
  roster: CountedRoster,
  price: (player: LineupPlayer) => number | null,
): Record<CapitalMetricId, number> {
  const starters = sumOf(roster.starters, price);
  const bench = sumOf(roster.bench, price);
  return {
    capital_total: starters + bench,
    capital_bench: bench,
    capital_starters: starters,
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
 *
 * `positions` and `slots` narrow it on {@link lineupMetricTotals}' exact terms,
 * so a column forcing a board *and* narrowing both ways is still one re-total
 * of one solve rather than anything new.
 */
export function ktcMetricTotals(
  lineup: LeagueLineup,
  price: (player: LineupPlayer) => number | null,
  pickValue = 0,
  positions: readonly LineupPosition[] = [],
  slots: readonly LineupSlot[] = [],
): Record<KtcMetricId, number> {
  return ktcTotalsOf(
    countedRoster(lineup, positions, slots),
    price,
    countedPicks(pickValue, positions, slots),
  );
}

/**
 * The quartet itself, over players already counted and a pick figure already
 * decided. One summation behind both public entry points, so the reconciliation
 * cannot hold on one and not the other.
 */
function ktcTotalsOf(
  roster: CountedRoster,
  price: (player: LineupPlayer) => number | null,
  pickValue: number,
): Record<KtcMetricId, number> {
  const starters = sumOf(roster.starters, price);
  const bench = sumOf(roster.bench, price);
  return {
    ktc_total: starters + bench + pickValue,
    ktc_starters: starters,
    ktc_bench: bench,
    ktc_picks: pickValue,
  };
}

/** The two halves of a roster a total counts, once a narrowing has been applied. */
type CountedRoster = {
  readonly starters: readonly LineupPlayer[];
  readonly bench: readonly LineupPlayer[];
};

/**
 * Which players a total counts: the seated starters and the bench, either whole
 * or narrowed to a set of seats, a set of positions, or both.
 *
 * **The narrowing is applied to each half, never to a merged roster.** That is
 * what keeps `starters` and `bench` a partition under a narrowing exactly as
 * they are without one — a quarterback is counted by the starters metrics if
 * the solver seated him and by the bench metrics if it did not, and by neither
 * twice. Filtering the whole roster and re-splitting it would be a second
 * seating rule with nothing to keep it honest against the solver's.
 *
 * {@link playsPosition} is the test, and it is an intersection rather than an
 * equality: Sleeper lists more than one position for the players this matters
 * most for, so a tight end it also files at receiver belongs to a `TE` column
 * and to a `WR` one alike. He is still counted **once** in either, because a
 * set is asked as a whole — `["TE", "WR"]` is one question, not two.
 *
 * An empty set is the absence of a narrowing and takes both halves whole. The
 * check lives here rather than at each call site so there is exactly one answer
 * to what no narrowing means.
 */
function countedRoster(
  lineup: LeagueLineup,
  positions: readonly LineupPosition[],
  slots: readonly LineupSlot[] = [],
): CountedRoster {
  // **The seats are narrowed before the players are**, which is the order that
  // makes the two axes an intersection rather than a union: `FLEX` picks the
  // seats and `WR` picks who, in them, is counted, so a receiver on the bench
  // is in neither half of a `FLEX` + `WR` column. Filtering by position first
  // and by seat second would give the same answer here and stop giving it the
  // day a narrowing wanted to count an unseated player.
  const seats =
    slots.length === 0
      ? lineup.starters
      : lineup.starters.filter((seat) =>
          (slots as readonly string[]).includes(seat.slot),
        );
  const seated = seats
    .map((seat) => seat.player)
    .filter((player): player is LineupPlayer => player !== null);
  // **A slot narrowing empties the bench rather than leaving it whole**, and
  // that is the answer rather than an omission: a bench player occupies no
  // seat, so there is no share of a bench a `FLEX` column could honestly claim.
  // Leaving it whole would put every unseated player into `ros_total:@flex`,
  // which a reader adding the tiles up would find exceeds its own two halves —
  // the failure {@link countedPicks} exists to prevent one part over. Zero on
  // every roster in the league then reads through the all-zero rule as an em
  // dash, which is what a question the bench cannot answer should look like.
  const bench = slots.length === 0 ? lineup.bench : [];
  if (positions.length === 0) return { starters: seated, bench };
  const keep = (player: LineupPlayer) =>
    playsPosition(player.positions, positions);
  return { starters: seated.filter(keep), bench: bench.filter(keep) };
}

/**
 * What a narrowing counts of a roster's pick portfolio: all of it, or none.
 *
 * **A draft pick has neither a position nor a seat, so a narrowed column cannot
 * own one.** KTC
 * names a pick by a third of its round and nothing in that names a
 * quarterback — a pick is not a position until somebody spends it — so there is
 * no share of a portfolio a `QB` column could honestly claim.
 *
 * Both alternatives are worse and the second is the one that looks right.
 * Apportioning a portfolio across positions has no basis in anything stored:
 * nothing in the graph says what a 2027 first will be used on. And leaving the
 * **whole** portfolio in a narrowed `ktc_total` would credit a quarterback-only
 * column with thousands of points of value no quarterback carries — on a
 * dynasty roster the picks would dominate the figure — and it would break the
 * one reading the quartet is arranged to make possible: `ktc_total:qb` would
 * exceed `ktc_starters:qb + ktc_bench:qb` by an amount with nothing to do with
 * quarterbacks, and a reader adding the tiles up would find the sum wrong.
 *
 * The slot axis is the same argument said of seats: a pick is not sitting
 * anywhere, so no share of a portfolio belongs to the FLEX seat.
 *
 * So a narrowed `ktc_picks` is zero on every roster in the league, which the
 * all-zero rule then reads as *unanswerable* rather than as "1st of 12": the
 * card draws an em dash, which is the honest state for a question a pick cannot
 * answer. `column()` on the client already refuses to narrow that metric at
 * all, so this is a belt to its braces; what it genuinely guards is
 * `ktc_total`, which a reader *can* narrow.
 */
function countedPicks(
  pickValue: number,
  positions: readonly LineupPosition[],
  slots: readonly LineupSlot[] = [],
): number {
  return positions.length === 0 && slots.length === 0 ? pickValue : 0;
}

/**
 * Sum one field across the players a total counts, an absent value counting
 * zero.
 *
 * Null is not zero anywhere else on this wire — an unprojected stash and an
 * unpriced bench player are both real absences — but a *sum* has to put
 * something there, and zero is the only value that leaves the other rosters'
 * totals comparable. The all-zero rule is what catches the case where that
 * makes the whole metric meaningless.
 */
function sumOf(
  players: readonly LineupPlayer[],
  value: (player: LineupPlayer) => number | null,
): number {
  return players.reduce((sum, player) => sum + (value(player) ?? 0), 0);
}

/** One roster's solve with its metric totals — what the teams pane renders from. */
export type RankedRoster = {
  roster: LeagueRosterRow;
  lineup: LeagueLineup;
  totals: Record<LineupMetricId, number>;
  /**
   * The same roster's total under each *keyed* column the caller asked for —
   * a forced market, a forced draft board, a seat or position narrowing, or any
   * combination — and nothing else.
   *
   * **It is the ranks' own arithmetic, kept rather than discarded.** Every one
   * of these numbers is already computed below: a narrowing and a variant are
   * re-totals over every roster, of which only the manager's index is read to
   * make a rank. What the teams pane needs is the column, not the rank, so
   * `teamTotals` names the keys worth carrying out and the loops record them as
   * they pass — no second solve, no second price table, and no second spelling
   * of a key.
   *
   * **Only what was named**, which is why this is a record rather than the
   * whole cross product: four bays' axes crossed against a dozen rosters is
   * hundreds of sums a league, where a pane reads one. A key the caller did not
   * ask for is absent, and a key it asked for that this league could not
   * produce — a pricing the request never carried — is absent too, which reads
   * as an em dash rather than as a zero.
   *
   * An un-narrowed column on each league's own board is keyed by its bare
   * metric id, so it is answered by {@link RankedRoster.totals} above and never
   * appears here. That is {@link lineupColumnKey}'s `auto`-folding rule doing
   * the same work for a total that it already does for a rank.
   */
  columns: Record<string, number>;
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
 *
 * **Everything past the ten base ranks is a re-total, never a second solve.**
 * The cross product a request can ask for is: each position set on the league's
 * own boards (ten metrics), plus each forced KeepTradeCut pricing (four
 * metrics) and each forced ADP board (three) *at* each position set including
 * the un-narrowed one. A rack holds four bays, so that is bounded by four sets
 * against four pricings however a reader arranges them, and every one of those
 * totals is summed off the solves already in `solved`. The pricings and the
 * sets are crossed rather than paired per column deliberately: what crosses the
 * wire is the three *axes* rather than the columns themselves (see
 * `ktcVariantsOf`, `adpBoardsOf` and `positionSetsOf`), which is what keeps
 * adding a tile free of a round trip, and the cost of ranking a cell nobody
 * happens to be reading is one more sum over a dozen lineups.
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
  /**
   * Position sets to re-total under, one per distinct narrowing the reader's
   * columns carry. Empty for every caller that has not narrowed anything — the
   * timeline among them, which draws the un-narrowed card over rewound rosters.
   * The empty set is never in here: it *is* the base ranks, and ranking it
   * again would file the nine under a second name (`ros_starters:` with nothing
   * after the colon) that nothing looks up.
   */
  positionSets: readonly (readonly LineupPosition[])[] = [],
  /**
   * Extra ADP boards to re-price the same rosters on, one per capital column
   * that has forced a QB board. Empty for every caller that has not — the
   * timeline among them, which asks the league's own board and nothing else.
   * See {@link AdpVariant}.
   */
  adpVariants: readonly AdpVariant[] = [],
  /**
   * Slot sets to re-total under, one per distinct seat narrowing the reader's
   * columns carry. Empty for every caller that has not narrowed anything — the
   * timeline among them. The empty set is never in here for
   * {@link positionSets}' reason: it *is* the base ranks.
   *
   * **Crossed with the position sets rather than paired with them**, which is
   * the rule this function already follows for the pricings and it is the same
   * argument: what crosses the wire is the *axes* rather than the columns (see
   * `slotSetsOf` beside `positionSetsOf`), so a reader who has `@flex` in one
   * bay and `wr` in another gets `@flex:wr` for free when they narrow one of
   * them further. A rack holds four bays, so the cross is bounded by four sets
   * against four however a reader arranges them, and the cost of ranking a cell
   * nobody happens to be reading is one more sum over a dozen lineups.
   */
  slotSets: readonly (readonly LineupSlot[])[] = [],
  /**
   * Which column keys to carry a **per-roster** total out for, beside the ranks.
   *
   * Empty for every caller that only ranks — which is most of them, the
   * timeline included. What asks is a pane that reads a column across a whole
   * league rather than a rank: the standings' own column picker, one key.
   *
   * **Matched against the keys this function composes, never parsed.** The
   * loops below already spell every key they file a rank under; this set is
   * compared to those strings, so there is no second reading of a format whose
   * own note says it is never read back. A key naming a pricing this call was
   * not also given (a market with no variant, a board with no aggregate) simply
   * never comes up, and the total is absent — the honest answer, and the one
   * the pane draws a dash for.
   */
  teamTotals: ReadonlySet<string> = NO_TEAM_TOTALS,
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
    // Populated as the keyed loops below pass, and only for the keys the caller
    // named — see {@link RankedRoster.columns}.
    return { roster, lineup, totals, columns: {} as Record<string, number> };
  });

  /**
   * Keep one keyed column's totals if anybody asked for it.
   *
   * Called from inside each loop with the totals it has already summed, so a
   * carried number is the *same* number the rank beside it was made from —
   * which is the whole point of recording here rather than re-totalling
   * afterwards, since a second pass is a second chance to cross the two
   * narrowing axes differently.
   */
  const carry = (key: string, of: (index: number) => number) => {
    if (!teamTotals.has(key)) return;
    solved.forEach((one, i) => {
      one.columns[key] = of(i);
    });
  };

  const managerIndex = solved.findIndex(
    ({ roster }) => roster.owner_id === managerUserId,
  );
  /**
   * Whether there is anybody in this league to rank.
   *
   * **A flag rather than the early return this used to take**, and the
   * difference is the totals: a rank is a statement about the manager and a
   * *column total* is a statement about a roster, so a league the reader holds
   * no team in still has twelve rosters worth totalling. Returning above the
   * loops answered every keyed column with an absence on exactly the read that
   * has no manager by construction — the league-scoped one behind a trade card,
   * where the teams pane is the whole of what the reader opened.
   *
   * Unranked, every rank the loops would file is null, which is what a card
   * draws an em dash for — and `baseRanks` is what says so, where a second
   * all-null literal beside it (`NO_RANKS`, which this replaces) was a second
   * exhaustive `LineupRanks` for a new metric id to be forgotten in. The keys
   * are still named, because they were still asked.
   */
  const ranked = managerIndex >= 0;

  /** A rank among these totals, or null where there is nobody to rank. */
  const rankOn = (totals: readonly number[]): MetricRank | null =>
    ranked ? rankAmong(totals, managerIndex) : null;

  // The ten, on the league's own board over the whole roster — the totals
  // already hung on every solve, so this path is untouched by either axis.
  const base = baseRanks((metric) =>
    rankOn(solved.map(({ totals }) => totals[metric])),
  );

  const keyed: Record<string, MetricRank | null> = {};

  // Every narrowing the reader's bays ask for, the un-narrowed one first. One
  // list rather than two loops apiece below, so the three pricing paths cannot
  // come to cross the two axes differently.
  const narrowings = narrowingsOf(slotSets, positionSets);

  // A narrowing is the same rosters re-totalled over fewer players. The
  // key is the metric plus the two clauses, which is exactly what
  // `lineupColumnKey` writes on the other side of the seam.
  for (const { slots, positions, suffix } of narrowings) {
    // The un-narrowed pair *is* the base ranks below; ranking it again would
    // file the ten under a second name nothing looks up.
    if (!suffix) continue;
    const totals = solved.map(({ roster, lineup }) =>
      lineupMetricTotals(
        lineup,
        pickValues.get(roster.roster_id) ?? 0,
        positions,
        slots,
      ),
    );
    const narrowed = baseRanks((metric) =>
      rankOn(totals.map((one) => one[metric])),
    );
    // Off the literal rather than a list of the nine, so the exhaustive
    // `LineupRanks` stays the one seam a new metric id has to pass through.
    for (const [metric, rank] of Object.entries(narrowed)) {
      const key = `${metric}${suffix}`;
      keyed[key] = rank;
      carry(key, (i) => totals[i][metric as LineupMetricId]);
    }
  }

  // A forced board is the same rosters re-totalled on a second price
  // table, so it is four more ranks rather than a second solve: `ktcMetricTotals`
  // reads the lineups already in hand. Crossed with the narrowings, since a
  // column may force a board *and* narrow — the un-narrowed pair is first in
  // that list, so a variant that has narrowed nothing keeps the bare
  // `ktc_total:dynasty:sf` key it always had.
  for (const variant of variants) {
    for (const { slots, positions, suffix } of narrowings) {
      const totals = solved.map(({ roster, lineup }) =>
        ktcMetricTotals(
          lineup,
          (player) => variant.values.get(player.player_id) ?? null,
          variant.pickValues.get(roster.roster_id) ?? 0,
          positions,
          slots,
        ),
      );
      for (const metric of KTC_METRIC_IDS) {
        const key = `${metric}:${variant.key}${suffix}`;
        keyed[key] = rankOn(totals.map((one) => one[metric]));
        carry(key, (i) => totals[i][metric]);
      }
    }
  }

  // A forced ADP board is the same rosters re-priced off a second draft
  // aggregate: three more ranks, and — as above — no second seating. The pool
  // is the league's own on every board, because `leagueAdpPool` is teams times
  // starting slots and a QB board changes neither; anchoring a forced board to
  // a different pool would be a second curve rather than a second reading of
  // the same one.
  const pool = leagueAdpPool(league.total_rosters, league.roster_positions);
  for (const variant of adpVariants) {
    for (const { slots, positions, suffix } of narrowings) {
      const totals = solved.map(({ lineup }) =>
        capitalMetricTotals(
          lineup,
          (player) => {
            const entry = variant.adp.get(player.player_id);
            return entry === undefined
              ? null
              : adpEntryValue(entry, pool, DEFAULT_STEEPNESS);
          },
          positions,
          slots,
        ),
      );
      for (const metric of CAPITAL_METRIC_IDS) {
        const key = `${metric}${variant.key}${suffix}`;
        keyed[key] = rankOn(totals.map((one) => one[metric]));
        carry(key, (i) => totals[i][metric]);
      }
    }
  }

  return {
    lineup: ranked ? solved[managerIndex].lineup : null,
    ranks: { ...keyed, ...base },
    rosters: solved,
  };
}

/**
 * No column asked for a per-roster total — the state every caller that only
 * ranks is in.
 *
 * A shared empty rather than a literal default, so the identity is stable and a
 * caller that passes nothing costs no allocation per league on a page of a
 * hundred.
 */
const NO_TEAM_TOTALS: ReadonlySet<string> = new Set();

/** No narrowing at all — the scope the base ranks answer, named so the loops
 * can walk it beside the reader's sets rather than special-casing it. */
const EVERY_POSITION: readonly LineupPosition[] = [];
const EVERY_SEAT: readonly LineupSlot[] = [];

/** One narrowing to re-total under: a seat set, a position set, and the key
 * clause the pair adds. */
type Narrowing = {
  slots: readonly LineupSlot[];
  positions: readonly LineupPosition[];
  /** `:@flex+super_flex:wr`, or `""` for the un-narrowed pair. */
  suffix: string;
};

/**
 * The cross product of the two narrowing axes, the un-narrowed pair first.
 *
 * **One list, walked by all three pricing paths**, which is what stops the base
 * ranks, a forced market and a forced draft board from crossing the two axes
 * differently — a rank filed under a key the card composes the other way round
 * is a window that reads an em dash over a league that was ranked. The suffix
 * comes from `shared/ktc/columns` at both ends and in that order (seats, then
 * players), so not even the separator is spelled here.
 *
 * The un-narrowed pair leads because the loops below rely on its position: the
 * base-rank loop skips it, having already answered it, and the two variant
 * loops need it to keep the bare `ktc_total:dynasty:sf` key they always had.
 */
function narrowingsOf(
  slotSets: readonly (readonly LineupSlot[])[],
  positionSets: readonly (readonly LineupPosition[])[],
): Narrowing[] {
  const all: Narrowing[] = [];
  for (const slots of [EVERY_SEAT, ...slotSets]) {
    for (const positions of [EVERY_POSITION, ...positionSets]) {
      all.push({
        slots,
        positions,
        suffix: slotKeySuffix(slots) + positionKeySuffix(positions),
      });
    }
  }
  return all;
}

/**
 * The ten ranks as one literal, given something that ranks a metric.
 *
 * A function rather than a list of the ids because **the literal is the
 * compiler seam**: `LineupRanks` is exhaustive, so a metric added to the
 * contract breaks this until somebody places it — the same seam the client's
 * `METRIC_ORDER` and `LINEUP_METRIC_LABELS` are. A `readonly LineupMetricId[]`
 * to iterate would compile happily with one missing, and the symptom would be a
 * column whose rank is quietly absent from every league.
 */
function baseRanks(
  rankOn: (metric: LineupMetricId) => MetricRank | null,
): LineupRanks {
  return {
    ros_total: rankOn("ros_total"),
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
}

/**
 * What a position set adds to a rank's key — nothing at all for the un-narrowed
 * one.
 *
 * **An un-narrowed key is byte-identical to the one this route has always
 * shipped**, which is the whole reason the axis is a suffix rather than a
 * segment: append an `all` token to every key and every card on the page looks
 * up a rank the server filed under another name, and the page fills with em
 * dashes. It is the same argument `lineupColumnKey` already makes for folding
 * `auto:auto` away, one axis over.
 *
 * The whole suffix comes from `shared/ktc/columns` rather than being spelled
 * here — the separator, the ordering, the lower-casing and the `+` are all that
 * module's, and the client names the column it looks a rank up by through the
 * same one. Not even the separator is repeated: a rank is a base metric key
 * plus this, where a column is `lineupColumnKey` whole, and the two are two
 * entry points to one spelling rather than two spellings a test keeps in step.
 * `league-ranks.test.ts` still asserts the agreement by calling the client's
 * own function, which is what makes that a check rather than a restatement.
 */

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
 * One extra ADP board to rank on: the aggregate itself, and the key its three
 * ranks are filed under.
 *
 * **The entries rather than the values**, which is where this differs from
 * {@link RankVariant} and the difference is the league. A KeepTradeCut price is
 * a number that means the same thing everywhere, so the route can build one map
 * for the page; an ADP value is a *position on a board* run through a curve
 * anchored to this league's own startable pool, so the pricing has to happen
 * where the pool is known. Handing values in would mean either a map per league
 * per board or a second anchoring, and the second is the one that renders
 * perfectly while being wrong.
 *
 * The key is `qbBoardKeySuffix`'s — `:sf` — written by the caller through that
 * function rather than spelled here, so the rank a card looks up and the rank
 * this files are one spelling.
 */
export type AdpVariant = {
  /** `:sf` / `:oneqb` — see `qbBoardKeySuffix`, which is what writes it. */
  key: string;
  /** Sleeper player id → this board's entry; undrafted ids absent. */
  adp: ReadonlyMap<string, AdpEntry>;
};

/** The three capital metrics, in canonical order — the ids an ADP board re-ranks. */
const CAPITAL_METRIC_IDS: readonly CapitalMetricId[] = [
  "capital_total",
  "capital_bench",
  "capital_starters",
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

