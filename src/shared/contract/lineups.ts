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
   * Sleeper's `team` — his NFL team's code. Null for a free agent, and for an
   * id the feed doesn't know. Read off the projections feed, the same rows
   * `name` and `positions` come from, and only off a row that is a real
   * projection: a no-game row leaves it null. **Null is null, not `"FA"`** —
   * the app's three-way grammar, a figure or a dash and never a stand-in — and
   * the card renders nothing for it rather than an em dash, since it sits
   * between a name and a figure where a dash reads as a missing number.
   */
  team: string | null;
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
  | "ros_total"
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
 * which is what no projections (all three ROS metrics), no synced drafts (all
 * three capital metrics) and an unreadable or empty KTC board (all four KTC metrics)
 * look like. "1st of 12" among all-zero totals would be a claim; the card
 * renders an em dash instead.
 *
 * `ktc_picks` reaches that state on its own in a league read on the **redraft**
 * market, which carries no rookie-pick rows at all — correctly, since a redraft
 * pick is not an asset anybody holds into next year.
 */
export type LineupRanks = Record<LineupMetricId, MetricRank | null>;

/**
 * A fantasy position a column can be narrowed to.
 *
 * A type-only union on the same terms as {@link LineupMetricId}: the runtime
 * list is derived from the solver's own `SLOT_POSITIONS` in
 * `shared/projections/positions`, and `positions.test.ts` pins that the two
 * name the same nine — so a position the solver learns breaks a test rather
 * than being silently unofferable, and one named here that no slot admits
 * breaks it the other way.
 *
 * The nine are the four skill positions, the kicker and the team defence, and
 * the three individual-defender families. **`DL`/`LB`/`DB` rather than one
 * `IDP`**, because those are the groups a league actually starts: a single key
 * would name a bucket rather than a board.
 */
export type LineupPosition =
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "K"
  | "DEF"
  | "DL"
  | "LB"
  | "DB";

/**
 * A starting slot a column can be narrowed to.
 *
 * A type-only union on {@link LineupPosition}'s exact terms: the runtime list
 * is `STARTING_SLOTS` in `shared/projections/starting-slots`, and
 * `starting-slots.test.ts` pins that it, this union and the solver's own
 * `SLOT_POSITIONS` name the same fourteen — so a slot the solver learns breaks
 * a test rather than being silently unofferable, and one named here that no
 * lineup can seat breaks it the other way.
 *
 * **A slot is a seat, where a position is a player**, and that is the whole
 * reason this is a second axis rather than more values on the first: the two
 * compose. A column narrowed to `FLEX` and to `WR` counts the wide receivers
 * *occupying flex seats*, which is a question neither axis can ask alone.
 */
export type LineupSlot =
  | "QB"
  | "RB"
  | "WR"
  | "TE"
  | "FLEX"
  | "WRRB_FLEX"
  | "REC_FLEX"
  | "SUPER_FLEX"
  | "K"
  | "DEF"
  | "DL"
  | "LB"
  | "DB"
  | "IDP_FLEX";

/**
 * One column a card carries: a metric, and — for the metrics that read one —
 * which market and which QB board it is priced on.
 *
 * **A column is a triple rather than a metric id**, which is what lets the same
 * metric sit in two bays: "KTC total on the dynasty board at superflex prices"
 * and "KTC total on the dynasty board at 1QB prices" are two readings of one
 * roster, and a reader comparing them is doing the thing the second axis exists
 * for. {@link lineupColumnKey} is what folds an axis a metric does not read
 * back into one identity, so a column that cannot answer an axis can never
 * duplicate itself on it.
 *
 * **The two axes are read by different metrics, and that is the point rather
 * than an inconsistency.** A *market* is KeepTradeCut's own — dynasty and
 * redraft are two boards that repo publishes — so only the four KTC metrics
 * carry `format`. A *QB board* is a fact about how a league starts
 * quarterbacks, and both valuations split on it: KTC prices every player twice
 * and the ADP fold aggregates superflex drafts apart from standard ones. So the
 * three capital metrics carry `lineup` too, and a reader can price a roster's
 * draft capital on the superflex board while sitting in a 1QB league — the same
 * comparison the KTC bays already make one market over. Only the three
 * projection metrics read neither: points are scored under the league's own
 * scoring settings and no board enters them.
 *
 * Both axes default to `auto`, which is a rule rather than a value: the league
 * decides. See {@link KtcBoardChoice} and {@link KtcLineupChoice}.
 *
 * **The third axis narrows what is counted rather than how it is priced.** A
 * column carrying `["QB", "TE"]` totals only the quarterbacks and tight ends of
 * whatever its scope names, and ranks the manager among the league's rosters on
 * that narrower sum. It composes with the other two rather than replacing
 * either: `KTC starters, dynasty, SF, QB only` is a real question a dynasty
 * reader asks.
 */
export type LineupColumn = {
  metric: LineupMetricId;
  format: KtcBoardChoice;
  lineup: KtcLineupChoice;
  /**
   * Which positions the total counts, or **empty for every position**.
   *
   * Empty is the absence of a narrowing and not a tenth value — which is what
   * lets a stored selection written before this axis existed read correctly
   * (positions did not exist, and "all of them" is what the page was doing),
   * and what keeps {@link LineupColumn}'s key unchanged for every column that
   * has not narrowed. Always in the axis's own canonical order, never in press
   * order: the bay's second line and the card's tile both print it, and press
   * order would make one column read two ways.
   */
  positions: readonly LineupPosition[];
  /**
   * Which starting seats the total counts, or **empty for the whole lineup**.
   *
   * Empty is the absence of a narrowing on {@link positions}' exact terms, and
   * for the same two reasons: a stored selection written before this axis
   * existed reads correctly (slots did not exist, and "every seat" is what the
   * page was doing), and an un-narrowed column keys exactly as it always did —
   * which is what keeps the ten base ranks the route always ships readable.
   *
   * **Only a starters column can carry one**, because a seat is a thing only a
   * starting lineup has: a bench player occupies none, a whole-roster total
   * spans both halves, and a draft pick is not a player. `column()` forces this
   * empty off the `starters` scope, so a press and a stored value cannot
   * disagree about it.
   *
   * Always in the axis's own canonical order, never in press order — the bay's
   * second line and the card's tile both print it, and press order would make
   * one column read two ways.
   */
  slots: readonly LineupSlot[];
};

/**
 * The ranks one league's entry carries, keyed by **column identity** rather
 * than by metric id.
 *
 * The ten metric ids are always present, ranked on the pricing a league reads
 * for itself — `auto` on both axes — which is what the timeline, and any reader
 * that has not asked for a forced board, gets for free. A column that *has*
 * forced one carries an extra key beside them (`ktc_total:dynasty:sf`, or
 * `capital_total:sf` where the metric reads a QB board and no market), and only
 * the pricings the request named are computed: the four KTC metrics of a market
 * nobody asked for are rows nothing would read.
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
 * Every team's total, keyed by **column identity** rather than by metric id —
 * {@link ColumnRanks}' shape one reading over, and for its reason.
 *
 * The ten metric ids are always present, totalled on the pricing a league reads
 * for itself over its whole roster, which is what every reader that has forced
 * nothing gets for free. A column that *has* forced a market or a QB board, or
 * narrowed itself to a set of seats or positions, carries an extra key beside
 * them (`ktc_total:dynasty:sf`, `ros_starters:@flex:wr`) — and only the columns
 * the request named, which is the whole reason this is keyed rather than
 * exhaustive: the cross product of four bays' axes against a dozen rosters is
 * hundreds of numbers a league, where what any one pane reads is one.
 *
 * The exhaustive half is the compiler seam it always was — a new
 * {@link LineupMetricId} breaks the totals literal until it is placed — and the
 * index signature is what a column key reads through. It answers `undefined`
 * for a key the payload never carried, which is a real state and not a zero: a
 * client holding a column whose narrowing the server was not asked for.
 */
export type TeamTotals = Record<LineupMetricId, number> & {
  readonly [column: string]: number | undefined;
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
 *
 * **It is keyed by column now, and this file used to argue it could not be.**
 * The argument was that a narrowed total would be a field on every team of
 * every league that nothing could name — the expanded browser sorted and
 * printed by a bare {@link LineupMetricId} — and both narrowing axes were
 * landed with a note saying the field "arrives with a browser that can ask the
 * question". The teams pane's column picker is that browser: it reads one
 * column on the same six axes the card's bays do, so the pane needs a total per
 * roster on a pricing and a narrowing only the server can compute. What keeps
 * the widening honest is that it ships **what was asked for and nothing else**
 * — see {@link TeamTotals}.
 */
export type LeagueTeam = {
  roster_id: number;
  /** The team's own name, its owner's display name, or "Roster N". */
  name: string;
  /** True on the page's manager — the card's default selection, at most one. */
  is_manager: boolean;
  lineup: LeagueLineup;
  totals: TeamTotals;
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

/**
 * `GET /api/league/[leagueId]/lineup` — **one** league solved, by league id.
 *
 * The per-league sibling of {@link ManagerLineupsPayload}, and the reason it
 * exists is the reason `/api/league/[leagueId]/timeline` exists beside
 * `/api/user/[username]/lineups`: the trades board's leagues are whatever its
 * loaded pages happen to mention, so there is no manager whose account they can
 * be batched off. A trade card asks for the one league it names, when a reader
 * opens it.
 *
 * **`entry` is nullable and that is an answer rather than a failure.** A league
 * this database has no stored rosters for — never crawled, or tombstoned — has
 * nothing to solve, and the card draws its own empty state. A read that
 * genuinely could not be made is a 500, which is a different sentence.
 *
 * `from_week` and `ktc` carry the same two provenance facts the batched payload
 * does, for the same reason: a card printing somebody else's numbers should be
 * able to say which lens answered and how old the market is.
 */
export type LeagueLineupPayload = {
  season: string;
  /** As {@link ManagerLineupsPayload.from_week} — null orders on capital alone. */
  from_week: number | null;
  /** As {@link ManagerLineupsPayload.ktc}; at most one market, this league's. */
  ktc: readonly KtcBoardStamp[];
  /** Null where the league has no stored rosters to solve — see above. */
  entry: LeagueLineupEntry | null;
};
