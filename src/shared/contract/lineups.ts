/**
 * The lineups answer: each league's roster solved into starters and bench.
 *
 * Types only, like everything in `contract/` — the route builds this on the
 * server and the league cards render it, so it must be importable from a
 * `"use client"` module without dragging `pg` or the solver along.
 */

import type { KtcBoardChoice, KtcFormat, KtcLineupChoice } from "./ktc";

/** One rostered player, as the lineup solve priced him. */
export type LineupPlayer = {
  player_id: string;
  /** From the projections feed's inlined player; null when the feed doesn't know the id. */
  name: string | null;
  /** Sleeper `fantasy_positions`; empty when unknown, which seats the player nowhere. */
  positions: string[];
  /**
   * Rest-of-season projected points under the league's own scoring. **Null is
   * "no projection", not zero** — a bye-shortened total is a number, an
   * unprojected stash is not, and the fallback below exists for the second.
   */
  points: number | null;
  /**
   * The fallback key: draft capital from `adpValue` over the drafts already
   * synced for this manager's leagues, on the board matching the league's
   * superflex setting. Null when those drafts never priced the player.
   */
  adp_value: number | null;
  /**
   * KeepTradeCut's price for this player on the market the league reads — which
   * market being the reader's `ktc_board` choice resolved against the league's
   * type, and which of its two numbers being the league's superflex setting.
   *
   * **Null is "off the board", never zero**, the same distinction the two
   * fields above draw. KTC's boards are a churning top few hundred skill
   * players — no kickers, no defences, no IDP, and no deep bench — so an
   * unpriced player is the ordinary case rather than a fault, and zeroing him
   * would put a claim where there is no opinion.
   *
   * **It plays no part in the seating.** The lineup is solved on projections
   * first and draft capital second (see `manager/ros-lineups`); this is hung on
   * an already-seated player and read back for the totals. A market price
   * deciding who starts would be a different tool.
   */
  ktc_value: number | null;
};

/** One starting slot, filled or empty. */
export type LineupSeat = { slot: string; player: LineupPlayer | null };

export type LeagueLineup = {
  league_id: string;
  /** The optimal starters, in the league's own slot order. */
  starters: LineupSeat[];
  /** Everyone else, best first — same ordering the solver seated by. */
  bench: LineupPlayer[];
  /** Summed rest-of-season points of the seated starters. */
  projected_points: number;
  /**
   * Starting slots this build doesn't recognise, left out of the lineup.
   * Non-empty means the starters shown cover only part of the real lineup.
   */
  unknown_slots: string[];
};

/**
 * The rankable lenses on a solved roster. A type-only union on purpose: the
 * runtime lists live as exhaustive `Record<LineupMetricId, …>`s on each side of
 * the seam — the server's ranks literal, the client's column order — so adding
 * an id here breaks both compiles until it is placed. A value exported from
 * this folder would break the folder's own contract instead.
 */
export type LineupMetricId =
  | "ros_starters"
  | "ros_bench"
  | "capital_total"
  | "capital_bench"
  | "capital_starters"
  | "ktc_total"
  | "ktc_starters"
  | "ktc_bench"
  | "ktc_picks";

/**
 * Standard competition rank among the league's stored rosters: tied totals
 * share the better rank and the next distinct total skips ("1, 2, 2, 4").
 * `of` counts the rosters actually ranked — orphan and empty rosters included —
 * not the league's seat count.
 */
export type MetricRank = { rank: number; of: number };

/**
 * Null where the metric is degenerate league-wide — every roster totals zero,
 * which is what no projections (both ROS metrics), no synced drafts (all three
 * capital metrics) and an unreadable or empty KTC board (all four KTC metrics)
 * look like. "1st of 12" among all-zero totals would be a claim; the card
 * renders an em dash instead.
 *
 * `ktc_picks` reaches that state on its own in a league read on the **redraft**
 * market, which carries no rookie-pick rows at all — correctly, since a redraft
 * pick is not an asset anybody holds into next year.
 */
export type LineupRanks = Record<LineupMetricId, MetricRank | null>;

/**
 * One column a card carries: a metric, and — for the four KeepTradeCut
 * metrics — which market and which QB board it is priced on.
 *
 * **A column is a triple rather than a metric id**, which is what lets the same
 * metric sit in two bays: "KTC total on the dynasty board at superflex prices"
 * and "KTC total on the dynasty board at 1QB prices" are two readings of one
 * roster, and a reader comparing them is doing the thing the second axis exists
 * for. The two axes are ignored on the five non-KTC metrics — a projection and
 * an ADP curve have no market to read — and {@link lineupColumnKey} is what
 * folds that back into one identity, so those five can never duplicate.
 *
 * Both axes default to `auto`, which is a rule rather than a value: the league
 * decides. See {@link KtcBoardChoice} and {@link KtcLineupChoice}.
 */
export type LineupColumn = {
  metric: LineupMetricId;
  format: KtcBoardChoice;
  lineup: KtcLineupChoice;
};

/**
 * The ranks one league's entry carries, keyed by **column identity** rather
 * than by metric id.
 *
 * The nine metric ids are always present, ranked on the pricing a league reads
 * for itself — `auto` on both axes — which is what the timeline, and any reader
 * that has not asked for a forced board, gets for free. A column that *has*
 * forced one carries an extra key beside them (`ktc_total:dynasty:sf`), and
 * only the variants the request named are computed: the four KTC metrics of a
 * market nobody asked for are rows nothing would read.
 *
 * The exhaustive half is the compiler seam it always was — a new
 * {@link LineupMetricId} breaks the ranks literal until it is placed — and the
 * index signature is what a column key reads through. It answers `undefined`
 * for a key the payload never carried, which is a real state: a client holding
 * a column whose variant the server was not asked for.
 */
export type ColumnRanks = LineupRanks & {
  readonly [column: string]: MetricRank | null | undefined;
};

/**
 * One future draft pick a roster owns, named the way Sleeper names it. The
 * facts ship and the display rule lives in the card: a pick whose draft order
 * is set reads by its slot ("1.05"), an unordered one by its round ("2nd"),
 * with the origin shown only where the slot can't be.
 */
export type RosterPick = {
  season: string;
  round: number;
  /**
   * Pick-in-round once that season's draft order is set — the *original*
   * roster's slot, flipped on the rounds a snake draft reverses, which is
   * where the pick actually falls. Null before the order exists, always for
   * auctions (whose "order" is nomination order), and for a snake draft whose
   * board width is unknown — an unflipped number would be a guess.
   */
  slot: number | null;
  /**
   * The original owner's name, only when the pick was acquired in a trade —
   * a roster's own pick carries null, because naming its origin would repeat
   * the card. Falls back to "Roster N" where the origin roster has no owner.
   */
  from: string | null;
  /**
   * What KeepTradeCut prices this pick at, on the market and the QB board the
   * league reads — the same pair of choices {@link LineupPlayer.ktc_value}
   * carries, since the two are summed into one total.
   *
   * **KTC prices a pick by a third of the round and Sleeper holds one by a
   * roster**, so the lookup places it: a pick whose draft order is set takes
   * its own third (slot 3 of 12 is an early 1st), and one whose draft does not
   * exist yet — most of them — takes KTC's middle row, the stand-in every trade
   * calculator uses for an unplaced future pick.
   *
   * **Null is a genuine gap and not a zero.** KTC prices three seasons of four
   * rounds; a pick past that horizon has no row to read and no honest way to be
   * extrapolated onto one (see `ktc/picks` for why the discount machinery that
   * could is deliberately unported). It falls out of the total rather than
   * dragging it down.
   */
  value: number | null;
};

/**
 * One team in a league's expanded card: its solved lineup, its pick portfolio,
 * and its total under every rankable lens.
 *
 * `totals` ships rather than being re-summed on the client because the sums
 * carry edge rules (`lineupMetricTotals` — null points, capital and KTC values
 * all count zero, the ROS bench re-rounds, and `ktc_total` is the only metric
 * that includes the picks) and a second spelling of them is how the teams
 * column would drift from the ranks it sits beside. The `Record` is exhaustive
 * by construction, so a new metric id breaks this compile too until it ships.
 */
export type LeagueTeam = {
  roster_id: number;
  /** The team's own name, its owner's display name, or "Roster N". */
  name: string;
  /** True on the page's manager — the card's default selection, at most one. */
  is_manager: boolean;
  lineup: LeagueLineup;
  totals: Record<LineupMetricId, number>;
  /** The roster's future draft picks, sorted by season, round, own-first. */
  picks: RosterPick[];
};

/**
 * One league's answer: every stored roster's solve — the expanded card lets
 * the reader open any team, not just the manager's — plus the manager's ranks.
 * Teams arrive in roster-id order; the card sorts by whichever metric its
 * column is showing.
 */
export type LeagueLineupEntry = {
  teams: LeagueTeam[];
  ranks: ColumnRanks;
};

/** `GET /api/user/[username]/lineups` — every roster solved, batched. */
export type ManagerLineupsPayload = {
  season: string;
  /**
   * First week the rest-of-season window covers, or null when no projections
   * were read at all — a past season, or a feed that failed. Every league then
   * orders purely on draft capital, which is the fallback working as designed
   * rather than an error.
   */
  from_week: number | null;
  /**
   * Every KeepTradeCut market that answered this request, and when each was
   * scraped. Empty where nothing could be read at all — an unreadable board,
   * which the route degrades to rather than failing over, exactly as it does
   * for a failed projections span.
   *
   * **A list rather than one board, because a column names its own market
   * now.** The route used to resolve one `?ktc_board=` for the page and echo
   * what it came out as — `"mixed"` where an account held both kinds of league
   * — which was the honest name while every KTC column read one thing. With
   * the market moved into the bay there is no page-wide answer to give: two
   * columns can sit on two markets deliberately. So what ships is what was
   * *read*, per market, which is the question the picker's foot actually asks —
   * these are someone else's numbers on a fifteen-minute cache, and anything
   * showing them should be able to say how old they are.
   */
  ktc: readonly KtcBoardStamp[];
  leagues: Record<string, LeagueLineupEntry>;
};

/** One market that answered, and when it was last scraped. */
export type KtcBoardStamp = { format: KtcFormat; updated_at: string | null };
