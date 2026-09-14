/**
 * The Player Scores list's arithmetic: what a player's week is worth, how it
 * adds up, which rows a narrowing leaves, and what order they come in.
 *
 * Pure and under Node's own runner, for `seat-compare.ts`' and
 * `matchup-gauge.ts`' reason: a board sorted the wrong way, a rank that does
 * not renumber, a zero scored as a figure or a head whose group spans disagree
 * with its own cells all render a perfectly ordinary list and say something
 * untrue. The component beside this owns the surfaces and nothing else.
 *
 * **The board is account-wide, so it prices itself.** Every other figure on
 * this page is scored through one league's own `scoring_settings`; a board
 * that spans a reader's leagues has no single league to ask, and picking one
 * would be a claim none of the others could support. So it states its basis
 * (`PPR`, `Half PPR`, `Standard`) on the bar and prices every row on it —
 * `figured()`'s own argument one reading over, where the panes are labelled
 * `Live` so nobody has to infer which of three scales they are on.
 *
 * **The box score is back, and this note used to say the opposite.** It came
 * off in the redesign that narrowed this board to two questions, on the
 * argument that nineteen columns could not be read without travelling past
 * four answers to reach one — which was true of *nineteen*. What comes back is
 * thirteen, and the two things that make them readable are the two the old
 * board did not have: **Player and Pts are pinned** to the two edges, so the
 * one column that names a row and the one figure a reader is scanning for
 * never leave the screen while the splits scroll between them, and the splits
 * themselves are a **reader's choice** ({@link statColumns}) rather than all
 * of them all the time. The phone carries the same line with no sideways
 * travel at all — {@link statFamilies} folds it onto one wrapping strip.
 *
 * **And the four usage readings became a filter**, which is the other half of
 * that reversal: they were three counts a row printed and nothing could act
 * on, and they are now what narrows the reader's league grid. The vocabulary
 * is `WeekReading`'s own — see {@link StatBoardFilters.usage} for why the
 * caps AND at page scope where one player's own four keys cannot.
 */

import type { GametimeGame, GametimeStatLine, StatBoardPosition } from "@/shared/contract";

import {
  insideSpan,
  spanActive,
  toggleFacet,
  type Span,
} from "../../shared/facet-span.ts";
import { WEEK_READINGS, type WeekReading } from "../../shared/league-subjects.ts";
import { gameClockLabel } from "./live-record.ts";

/** Which of the three scales a board is priced on. */
export type StatBasis = "ppr" | "half" | "std";

/** What a reception is worth on each. The whole difference between them. */
const PER_RECEPTION: Record<StatBasis, number> = { ppr: 1, half: 0.5, std: 0 };

export const SCORING_LABEL: Record<StatBasis, string> = {
  ppr: "PPR",
  half: "Half PPR",
  std: "Standard",
};

/** The default, and what an unreadable basis reads as. */
export const DEFAULT_STAT_BASIS: StatBasis = "ppr";

export function parseStatBasis(value: unknown): StatBasis {
  return value === "half" || value === "std" ? value : DEFAULT_STAT_BASIS;
}

/**
 * One scoring term: a count, what each of them is worth, and how the pane
 * names both.
 *
 * **The whole of this board's scoring is this list**, which is the one thing
 * about the pane that had to be true rather than merely tidy: it answers
 * *where did this number come from*, and an answer restated beside the
 * function it is explaining is two spellings that agree until somebody edits
 * one. {@link statPoints} sums these and {@link statScoring} prints them, so
 * the column and its own explanation cannot disagree by construction.
 */
export type ScoringTerm = {
  /**
   * The figure it prices — the same key {@link STAT_COLUMNS} draws.
   *
   * **A key rather than a shared order**, which is what makes the two tables a
   * tie rather than a coincidence: the rate the pane prints beside a column is
   * looked up by name, so a term inserted here cannot silently price the
   * column after it. It is also what makes the exhaustive `Record`s below
   * break a compile when a tenth figure arrives rather than leaving one
   * unlabelled.
   */
  key: StatColumn["key"];
  /** Which split it belongs to — what groups it in the pane and on the phone. */
  family: StatFamilyKey;
  /** `8 receptions`, `1 fumble lost` — the count in words, singular where one. */
  label: string;
  /** How many of them. */
  count: number;
  /** What one is worth on this basis. */
  per: number;
  /**
   * The rate as the pane states it — `0.1 / yd`, `6.0 each`.
   *
   * A word rather than a bare multiplier, because the two kinds of term read
   * differently: a yardage rate is a figure *per unit* and a touchdown is a
   * flat price, and `× 0.1` beside `× 6` makes the reader supply the
   * distinction the design spells out.
   */
  unit: string;
};

/**
 * Standard fantasy scoring, spelled once: a passing yard is a twenty-fifth of
 * a point, a passing touchdown four, an interception minus one, a rushing or
 * receiving yard a tenth, those touchdowns six, a lost fumble minus two, and a
 * reception whatever the basis says.
 *
 * **The interception is `−1` and used to be `−2`**, which is the one figure on
 * this board a redesign moved. The handoff states the rate table it draws and
 * names `pass_int −1`; it is also Sleeper's own default, where `−2` is ESPN's,
 * and this board prices a whole account rather than any one league — so the
 * scale it picks should be the one the leagues under it mostly run. What it
 * costs is that every quarterback who threw one reads a point higher than he
 * did yesterday, which is a visible change to a live page and is why it is
 * written down here rather than left in the diff.
 *
 * **The volume figures carry no term at all**, which is the thing about them
 * that decides how the pane draws a family: a completion is not worth nothing,
 * it is not worth *anything*. So they are absent from this table, `statPoints`
 * cannot accidentally price them, and the pane's family rows print a count
 * with no rate beside it — see {@link statFamilies}.
 *
 * Every term is emitted, zero or not; the readers drop their own empties —
 * {@link statScoring} because a row reading `0 touchdowns × 6 = 0.0` is a line
 * spent saying nothing, and {@link statPoints} because adding noughts costs it
 * nothing.
 */
function scoringTerms(line: GametimeStatLine, basis: StatBasis): ScoringTerm[] {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  const each = (per: number) => `${signedFixed(per)} each`;
  const perYard = (per: number) => `${signed(per)} / yd`;
  return [
    { key: "pass_yd", family: "pass", label: plural(line.pass_yd, "passing yard", "passing yards"), count: line.pass_yd, per: 0.04, unit: perYard(0.04) },
    { key: "pass_td", family: "pass", label: plural(line.pass_td, "passing touchdown", "passing touchdowns"), count: line.pass_td, per: 4, unit: each(4) },
    { key: "pass_int", family: "pass", label: plural(line.pass_int, "interception", "interceptions"), count: line.pass_int, per: -1, unit: each(-1) },
    { key: "rush_yd", family: "rush", label: plural(line.rush_yd, "rushing yard", "rushing yards"), count: line.rush_yd, per: 0.1, unit: perYard(0.1) },
    { key: "rush_td", family: "rush", label: plural(line.rush_td, "rushing touchdown", "rushing touchdowns"), count: line.rush_td, per: 6, unit: each(6) },
    { key: "rec", family: "rec", label: plural(line.rec, "reception", "receptions"), count: line.rec, per: PER_RECEPTION[basis], unit: each(PER_RECEPTION[basis]) },
    { key: "rec_yd", family: "rec", label: plural(line.rec_yd, "receiving yard", "receiving yards"), count: line.rec_yd, per: 0.1, unit: perYard(0.1) },
    { key: "rec_td", family: "rec", label: plural(line.rec_td, "receiving touchdown", "receiving touchdowns"), count: line.rec_td, per: 6, unit: each(6) },
    { key: "fumbles_lost", family: "fum", label: plural(line.fumbles_lost, "fumble lost", "fumbles lost"), count: line.fumbles_lost, per: -2, unit: each(-2) },
  ];
}

/**
 * One player's week, priced.
 *
 * Rounded to the one decimal the column prints, so the figure a reader adds up
 * and the figure they are shown are the same number.
 *
 * **A passing yard is `0.04` here where it used to be `/ 25`**, because the
 * pane states the rate beside every term and `× 0.04` is a rate a reader can
 * multiply where `÷ 25` is one they have to invert.
 *
 * The two are not the same double — `x / 25` and `x * 0.04` differ by an ulp
 * on 129 of the first thousand integers — and they are the same **figure**,
 * which is the only thing that leaves this function: rounded to the decimal
 * the column prints, the two agree on every passing yardage from 0 to 1000
 * against every other term a line can carry. That is measured rather than
 * assumed, and `stat-board.test.ts` pins it, because the cheap reading of this
 * change is that it is a no-op and the honest one is that it is a no-op *after
 * the rounding*.
 */
export function statPoints(line: GametimeStatLine, basis: StatBasis): number {
  let points = 0;
  for (const term of scoringTerms(line, basis)) points += term.count * term.per;
  return Math.round(points * 10) / 10;
}

/**
 * How the week's lineups treated one player, as the list's join reads it.
 *
 * A structural four rather than `WeekTwoSidedShare` itself, which is what keeps
 * this module free of `features/shared`'s client half and therefore testable
 * under Node's own runner: the fold's own row satisfies it, and nothing here
 * needs the leagues behind the counts — the breakdown walks the entries for
 * those (`player-breakdown.ts`).
 */
export type StatShareCounts = {
  started: number;
  benched: number;
  oppStarted: number;
  oppBenched: number;
};

/** One row of the list: the wire's line, joined to his game and priced. */
export type StatRow = GametimeStatLine & {
  /**
   * The NFL opponent as the row prints him — `@NYJ` away, `CLE` home — or
   * null on a bye, an unnamed team, or a scoreboard nobody could read.
   */
  opponent: string | null;
  /** What the Game column reads, and whether his game is running. */
  clock: { text: string; live: boolean };
  /**
   * How far through his game is, as an index into {@link STAT_STAGES}, or
   * **null where the board has no game for him** — a bye, or a scoreboard
   * nobody could read.
   *
   * It is derived from the game rather than parsed back out of the clock's own
   * label, which is the difference between a fact and a guess: `gameClockLabel`
   * answers `Sun 1:00 PM` before kickoff and `Half` at the interval, and a
   * reading that took the first two characters of either would file a four
   * o'clock game under `Final`.
   */
  stage: number | null;
  points: number;
  /**
   * Whether anybody in the reader's leagues has him — what the `Your leagues`
   * cell says, and what the bar's `Yours` counts.
   *
   * It is the presence of a share row rather than a count above zero, because
   * the fold only ever produces a row for a player some roster names: a player
   * with four zeroes cannot exist, where a player with no entry is one the
   * reader's leagues have never heard of.
   */
  held: boolean;
  /**
   * The four counts the row carries, **null for a player nobody in the
   * reader's leagues holds, and never zero.**
   *
   * The distinction is the one thing about these four that is silent when it
   * is wrong. An absent tag says "not in your leagues" and a `0` says "in your
   * leagues, and this never happened" — which on these three is a real answer
   * rather than an absence, so it must not fall back to null. It is also what
   * {@link narrowStatRows}' usage narrowing reads, where a null is "not in the
   * question" and a nought is a real no. It is why
   * {@link compare} sorts a null last in either direction while sorting a zero
   * as a zero, and it is what floats a reader's own players to the top of a
   * four-hundred-row board the moment they press `Started`.
   */
  start: number | null;
  bench: number | null;
  /** The same two over the lineups facing them. */
  oppStart: number | null;
  oppBench: number | null;
  /**
   * **The two opposing readings summed**, which is the `Against` sort's own
   * figure and nothing else's.
   *
   * The cell draws all four apart now — the 300px `Your leagues` track has the
   * room the four-column board did not — so this is no longer what a reader
   * sees. It stays because the sort rail still offers `Against`, and ordering
   * a board by "how often somebody across from me had him" is one question
   * rather than two: a reader pressing it does not mean *started* by them.
   */
  against: number | null;
};

/** A row with its place **in the current view** — see {@link rankStatRows}. */
export type RankedStatRow = StatRow & { rank: number };

/**
 * Join the week's lines to the scoreboard and price them.
 *
 * The game is looked up by the row's own team, which is the payload's rule for
 * every other player on this page: one scoreboard beside the rows rather than
 * a copy of it on each. A team the board has no game for is a bye or a
 * scoreboard that could not be read, and both print as nothing rather than as
 * an em dash — in a column of clocks a dash reads as a game with no time on
 * it, which is `gameClockLabel`'s own call.
 */
export function statRows(
  lines: Readonly<Record<string, GametimeStatLine>>,
  board: Readonly<Record<string, GametimeGame>>,
  basis: StatBasis,
  /**
   * How the reader's own week treated each of them, keyed by player id — the
   * fold's `players`, indexed.
   *
   * **A join rather than a second list**: the board is every NFL player with a
   * line and the fold is every player the reader's leagues fielded, and the
   * two overlap on rather less than half of either. So every unmatched row
   * keeps three nulls and reads `Nobody in your leagues`, and a player the
   * reader holds who did nothing this week is simply not on the board at all —
   * he has no line to be a row of.
   *
   * Defaulted, because the fold is behind the page's own gate: before a reader
   * has any reason to pay for it the board is the NFL's week and nothing else.
   */
  shares: Readonly<Record<string, StatShareCounts>> = NO_SHARES,
): StatRow[] {
  return Object.values(lines).map((line) => {
    const game = line.team ? (board[line.team] ?? null) : null;
    const share = shares[line.player_id];
    return {
      ...line,
      opponent: game?.opponent ? (game.home ? game.opponent : `@${game.opponent}`) : null,
      clock: gameClockLabel(game),
      stage: gameStage(game),
      points: statPoints(line, basis),
      held: share !== undefined,
      start: share ? share.started : null,
      bench: share ? share.benched : null,
      oppStart: share ? share.oppStarted : null,
      oppBench: share ? share.oppBenched : null,
      against: share ? share.oppStarted + share.oppBenched : null,
    };
  });
}

/**
 * How far through a game is, as the `Clock` facet's own scale.
 *
 * **Six stops where the design draws five**, and the extra one is `Pre`. Its
 * five are `Q1 Q2 Q3 Q4 F`, which its fixture week could afford because every
 * game in it had kicked off; a real Sunday morning is mostly games that have
 * not, and a five-stop scale has nowhere to put one but `F`. A facet that
 * filed a four o'clock kickoff under `Final` is a filter that lies, which is
 * the class of fault this module is written against — and "yet to start" is a
 * question a reader actually asks on the morning this board is busiest.
 */
export const STAT_STAGES: readonly string[] = ["Pre", "Q1", "Q2", "Q3", "Q4", "F"];

/** The span's own ends, which the facet's two handles run between. */
export const STAT_STAGE_BOUNDS = { lo: 0, hi: STAT_STAGES.length - 1 } as const;

/**
 * A game's stop on that scale.
 *
 * **Overtime reads as `Q4`**, which is the one mapping that is a judgement.
 * It is past the fourth quarter and it is not over, and the distinction the
 * facet is actually asked about is *running against finished* — so the last
 * running stop is the honest one, where `F` would file a game still being
 * played with the ones that are done.
 *
 * **A live game whose quarter the scoreboard did not say is null**, not a
 * guess at the middle: `gameClockLabel` prints a bare `Live` for exactly that
 * row, and an unknown stop is outside every narrowing span on
 * `insideSpan`'s own rule rather than inside a fabricated one.
 */
function gameStage(game: GametimeGame | null): number | null {
  if (!game) return null;
  if (game.phase === "pre") return 0;
  if (game.phase === "final") return 5;
  if (game.overtime) return 4;
  if (game.quarter === null) return null;
  return Math.min(Math.max(game.quarter, 1), 4);
}

/** Nothing folded yet — a module-level identity, so a memo sees one object. */
export const NO_SHARES: Readonly<Record<string, StatShareCounts>> = {};

/** How many of the list's rows anybody in the reader's leagues has. */
export function heldStatRows(rows: readonly StatRow[]): number {
  let held = 0;
  for (const row of rows) if (row.held) held++;
  return held;
}

/* ------------------------------------------------------------------ */

/** Which split a column belongs to, and which strip a phone folds it onto. */
export type StatFamilyKey = "pass" | "rush" | "rec" | "fum";

/** The three the `Splits` rail offers. `fum` has no group of its own to hide. */
export type StatSplitKey = "pass" | "rush" | "rec";

export const STAT_SPLITS: readonly { key: StatSplitKey; label: string }[] = [
  { key: "pass", label: "Pass" },
  { key: "rush", label: "Rush" },
  { key: "rec", label: "Rec" },
];

/** Every family carried — the rail's own resting state. */
export const ALL_SPLITS: readonly StatSplitKey[] = ["pass", "rush", "rec"];

/**
 * Add or drop one family — **and never drop the last one**.
 *
 * This is where the splits rail parts company with every other multi-select on
 * the ledge, and a render is what said it had to. Those read an empty set as
 * *not asked*, which is right for a question about the rows: a `Pos` menu with
 * nothing picked is every position. Read the same way here, a rail whose three
 * caps are all lit answers a press on one of them by holding **only** that
 * one — the reader presses `Pass` to put the passing columns away and gets a
 * board with nothing else on it, which is the opposite of the gesture.
 *
 * So the rail holds the families it shows, explicitly, and starts full. The
 * floor is enforced by **disabling the last lit cap rather than correcting the
 * press**, which is this app's own rule for a bound (`lineup-columns-dialog`
 * greys the key that would empty a bay): a table with no split columns at all
 * is not a narrower table, it is the four-column board this replaced, and a
 * reader who wanted that wants the rail gone rather than empty.
 */
export function toggleSplit(
  held: readonly StatSplitKey[],
  key: StatSplitKey,
): readonly StatSplitKey[] {
  if (!held.includes(key)) return ALL_SPLITS.filter((k) => held.includes(k) || k === key);
  if (held.length === 1) return held;
  return held.filter((k) => k !== key);
}

/**
 * One split column: which figure it prints, what it is called, and how wide.
 *
 * **The width is here rather than in the component**, and that is the whole
 * reason this table exists: the head is two tiers, and the upper one's group
 * spans have to be the sum of the lower one's cells or the figures file
 * silently under the wrong family — `Rushing` sitting over a passing
 * touchdown, with every number on the board correct and every one of them
 * labelled wrong. {@link statGroupSpans} derives the spans from these same
 * numbers, so the two cannot drift.
 */
export type StatColumn = {
  key:
    | "pass_cmp"
    | "pass_att"
    | "pass_yd"
    | "pass_td"
    | "pass_int"
    | "rush_att"
    | "rush_yd"
    | "rush_td"
    | "targets"
    | "rec"
    | "rec_yd"
    | "rec_td"
    | "fumbles_lost";
  family: StatFamilyKey;
  /** The lower tier's own word — `Yd` three times, under three families. */
  label: string;
  /** What a screen reader hears instead — `Passing Yd`, since `Yd` is three. */
  hint: string;
  width: number;
};

/**
 * Every split column, in the order the board draws them.
 *
 * **Volume leads each family**, which is the one thing about the order that is
 * a decision rather than a habit: the yardage behind a line is *earned from*
 * the attempts in front of it, and 8 of 11 is a different week from 8 of 8
 * with the same three columns either side. A reader travelling left to right
 * meets the denominator before the numerator.
 */
export const STAT_COLUMNS: readonly StatColumn[] = [
  { key: "pass_cmp", family: "pass", label: "Cmp", hint: "Passing completions", width: 44 },
  { key: "pass_att", family: "pass", label: "Att", hint: "Passing attempts", width: 44 },
  { key: "pass_yd", family: "pass", label: "Yd", hint: "Passing yards", width: 56 },
  { key: "pass_td", family: "pass", label: "TD", hint: "Passing touchdowns", width: 44 },
  { key: "pass_int", family: "pass", label: "Int", hint: "Interceptions", width: 44 },
  { key: "rush_att", family: "rush", label: "Car", hint: "Carries", width: 44 },
  { key: "rush_yd", family: "rush", label: "Yd", hint: "Rushing yards", width: 56 },
  { key: "rush_td", family: "rush", label: "TD", hint: "Rushing touchdowns", width: 44 },
  { key: "targets", family: "rec", label: "Tgt", hint: "Targets", width: 44 },
  { key: "rec", family: "rec", label: "Rec", hint: "Receptions", width: 44 },
  { key: "rec_yd", family: "rec", label: "Yd", hint: "Receiving yards", width: 56 },
  { key: "rec_td", family: "rec", label: "TD", hint: "Receiving touchdowns", width: 44 },
  { key: "fumbles_lost", family: "fum", label: "FL", hint: "Fumbles lost", width: 36 },
];

/** What each family's upper-tier span is called. `fum` labels nothing. */
export const FAMILY_TITLE: Record<StatFamilyKey, string> = {
  pass: "Passing",
  rush: "Rushing",
  rec: "Receiving",
  fum: "",
};

/**
 * The two pinned tracks and the two that scroll between them and the splits.
 *
 * `count` is **one** of the four usage columns rather than the block: they are
 * four cells on the row and four heads over them, and the head's own family
 * span is `4 × count` — derived rather than written down, for the reason
 * {@link statGroupSpans} exists at all.
 *
 * The player track grew (228 → 258) and the game track with it (76 → 88),
 * because both carry a reading they did not: the player cell has a 22px badge
 * and his NFL team beside the position, and the game cell is two lines, the
 * wider of which is the clock.
 *
 * **`count` is 72 where the design draws 56, and that is a measurement.** The
 * four usage columns are the only ones whose *head* is wider than its figures:
 * a count is one or two digits and `Started` is seven characters, which at
 * this board's own `--fs-10` and `0.12em` measures **58.5px** — so a 56px
 * column with 12px of padding left it 44 and the head stretched its own track
 * by 14px, taking every column after it out from under its head. (That is the
 * failure rather than the fix: the head cell is `min-w-0` now, so it can never
 * stretch a column again whatever it carries.)
 *
 * The two ways out were a wider column and a shorter word, and the word is
 * what this board would usually spend — `Cmp`, `Tgt`, `Car` and `FL` are all
 * abbreviations with the full reading in their accessible names. It is not
 * spent here because the two that overflow are the *opposing* pair, and every
 * abbreviation short enough to fit (`Vs` beside `Opp`) stops saying which of
 * them is a start and which is a bench — which is the one distinction these
 * four columns exist to draw. 72px leaves 60 for a 58.5px word, and what it
 * costs is 64px on a track that is built to scroll.
 */
export const STAT_FIXED = {
  player: 258,
  /**
   * The `Game` column, at **100px where the design's own table says 88** —
   * and the 12 are a measurement rather than a preference.
   *
   * That column is drawn against a clock, and the design measures it against
   * one: `Q3 11:02` is 59.4px here. What it is not measured against is the
   * *kickoff*, which this app prints in the **reader's own locale** — so an
   * en-US afternoon game is `Sun 12:00 PM`, which measures **89px tracked and
   * 83.5 untracked** in this build's own IBM Plex Mono, against the 78 an
   * 88px cell leaves after its 10px of right padding. It overflowed to the
   * *left*, under the pinned `Player` cell, and a render is what caught it:
   * four pixels of the day simply were not there, with nothing on screen
   * saying so.
   *
   * Letter-spacing is the first thing to spend — the rule this repo already
   * keeps for the lineup checker's own `Kick` column, which made the identical
   * measurement against the identical string — and it buys 5.5px where 11 are
   * wanted, so the track takes the rest. 100 leaves 90 against an untracked
   * 83.5, which is margin for a locale whose day is longer than three
   * characters rather than slack.
   */
  game: 100,
  count: 72,
  points: 84,
} as const;

/** The four usage columns' block, which the head's own span is the width of. */
export const STAT_USAGE_WIDTH = STAT_FIXED.count * WEEK_READINGS.length;

/**
 * The split columns a selection carries — **empty is all of them**, which is
 * `StatBoardFilters`' own rule one control over: a rail nobody has touched is
 * not asked rather than nothing chosen.
 *
 * **Fumbles are never hidden.** The rail offers three keys and a lost fumble
 * belongs to no family that has one, so it rides every arrangement — which is
 * right rather than an omission: it is the only figure on the board that
 * *subtracts*, and a reader who has narrowed to receiving still wants to know
 * their receiver put the ball on the floor.
 */
export function statColumns(
  splits: readonly StatSplitKey[],
): readonly StatColumn[] {
  if (splits.length === 0) return STAT_COLUMNS;
  const held = new Set<string>(splits);
  return STAT_COLUMNS.filter((c) => c.family === "fum" || held.has(c.family));
}

/** The row's own track, which is what the scroller is that wide for. */
export function statTrackWidth(columns: readonly StatColumn[]): number {
  let width =
    STAT_FIXED.player + STAT_FIXED.game + STAT_USAGE_WIDTH + STAT_FIXED.points;
  for (const column of columns) width += column.width;
  return width;
}

/** One span of the head's upper tier — a run of columns under one word. */
export type StatGroupSpan = {
  key: StatFamilyKey | "player" | "game" | "leagues" | "points";
  label: string;
  width: number;
  /** Whether a milled hairline is cut down its left edge. The first is not. */
  cut: boolean;
  /**
   * Which edge it is pinned to, matching the row cell beneath it.
   *
   * **The head pins the same two widths the rows do**, which is the thing a
   * prototype can leave out and a real table cannot: pin only the rows and the
   * `Player` and `Pts` *labels* slide away while the cells under them hold the
   * edge — a head that stops naming its own columns, which is this board's own
   * recorded finding from the pass that first pinned anything here.
   *
   * It is why the upper tier's two end spans are four rather than the two the
   * design draws: `Player + Game` is one 304px block on an artboard and has to
   * be 228 pinned plus 76 scrolling here, or the head's pinned block would
   * overhang the rows' by exactly the width of the Game column.
   */
  pin: "left" | "right" | null;
};

/**
 * The upper tier, derived from the lower one.
 *
 * A run per family rather than a written table, so a column added, dropped or
 * resized moves its own group's span with it — which is the mismatch that is
 * silent when it happens: a span a column short files every figure after it
 * under the wrong family, with every number on the board correct and every one
 * of them labelled wrong.
 *
 * The four fixed tracks are spans too, because the tier is one flex row and a
 * span that did not account for them would put every family one column left.
 */
export function statGroupSpans(
  columns: readonly StatColumn[],
): StatGroupSpan[] {
  const spans: StatGroupSpan[] = [
    { key: "player", label: "", width: STAT_FIXED.player, cut: false, pin: "left" },
    { key: "game", label: "", width: STAT_FIXED.game, cut: false, pin: null },
  ];
  for (const column of columns) {
    const last = spans[spans.length - 1];
    if (last.key === column.family) last.width += column.width;
    else
      spans.push({
        key: column.family,
        label: FAMILY_TITLE[column.family],
        width: column.width,
        cut: true,
        pin: null,
      });
  }
  spans.push(
    /* The four usage columns under one word, which is the only span in the
       upper tier that *labels* anything the lower tier does not already say:
       `Started` / `Sat` / `Vs` / `Opp sat` are four readings of one question,
       and the question is whose leagues they are about. */
    { key: "leagues", label: "Your leagues", width: STAT_USAGE_WIDTH, cut: true, pin: null },
    { key: "points", label: "", width: STAT_FIXED.points, cut: false, pin: "right" },
  );
  return spans;
}

/* ------------------------------------------------------------------ */

/**
 * One family of a player's own line, as the phone strip and the pane read it.
 *
 * **A family with nothing in it is absent rather than drawn as noughts**,
 * which is `playerBreakdown`'s own rule about a header over nothing and is
 * what lets one wrapping line carry what the table spends nine columns on: a
 * receiver's strip is `REC 8 rec · 112 yd · 1 td` and not that under two rows
 * of dashes.
 */
export type StatFamily = {
  key: StatFamilyKey;
  /** `Receiving` — and `Fumbles`, which the column head has no room to say. */
  title: string;
  /** The phone's own one-line form: `8 rec · 112 yd · 1 td`. */
  text: string;
  /** The pane's own rows: a figure each, with what one is worth beside it. */
  rows: StatLineRow[];
};

/** One row of the pane's line: what it counts, the rate, and how many. */
export type StatLineRow = {
  label: string;
  /**
   * `0.1 / yd`, `6.0 each` — what one of them is worth, or **null where the
   * figure is not a scoring one at all**.
   *
   * The family groups carry null on every row and the sum group carries a rate
   * on all of them, and that split is the design's rather than an accident of
   * the volume columns arriving. A family says *what he did* and `How 25.2
   * adds up` says *what it was worth*, so a rate printed twice would be the
   * second group explaining a figure the first had already priced — and the
   * volume figures made it more than untidy: a completion has no price, so
   * `0 each` beside one is a claim.
   */
  rate: string | null;
  value: string;
  /** Whether the value is a nought, which the pane inks quietly. */
  zero: boolean;
};

/** The short word each figure takes on the phone's strip. */
const SHORT: Record<StatColumn["key"], string> = {
  pass_cmp: "cmp",
  pass_att: "att",
  rush_att: "car",
  targets: "tgt",
  pass_yd: "yd",
  pass_td: "td",
  pass_int: "int",
  rush_yd: "yd",
  rush_td: "td",
  rec: "rec",
  rec_yd: "yd",
  rec_td: "td",
  fumbles_lost: "lost",
};

const FAMILY_HEAD: Record<StatFamilyKey, string> = {
  pass: "Passing",
  rush: "Rushing",
  rec: "Receiving",
  fum: "Fumbles",
};

/**
 * A player's line, folded into the families he actually has one in.
 *
 * **It takes no basis**, which it did until the rates came off the family
 * rows: what a figure is worth is `How 25.2 adds up`'s business, and a fold of
 * *what he did* is the same fold on all three scales.
 *
 * **An empty family is dropped and a zero inside a live one is kept**, which
 * is the distinction that makes the strip readable: a quarterback who threw
 * for three touchdowns and no interceptions reads `PASS 288 yd · 3 td` — the
 * interception is a nought inside a family he is in, and it is omitted from
 * the *text* — while a receiver has no passing line at all and the group goes.
 * The pane's rows keep every figure of a family it draws, nought included,
 * because there the rate beside it is the point.
 */
export function statFamilies(line: GametimeStatLine): StatFamily[] {
  const families: StatFamily[] = [];
  for (const key of ["pass", "rush", "rec", "fum"] as const) {
    const columns = STAT_COLUMNS.filter((c) => c.family === key);
    const figures = columns.map((c) => ({ column: c, count: line[c.key] }));
    if (figures.every((f) => f.count === 0)) continue;
    families.push({
      key,
      title: FAMILY_HEAD[key],
      text: figures
        .filter((f) => f.count !== 0)
        .map((f) => `${f.count} ${SHORT[f.column.key]}`)
        .join(" · "),
      rows: figures.map((f) => ({
        label: COLUMN_NOUN[f.column.key],
        /* No rate: a family states the line and the sum below it states what
           the line was worth — see `StatLineRow.rate`. */
        rate: null,
        value: String(f.count),
        zero: f.count === 0,
      })),
    });
  }
  return families;
}

/** What the pane calls each figure, where the column head has two letters. */
const COLUMN_NOUN: Record<StatColumn["key"], string> = {
  pass_cmp: "Completions",
  pass_att: "Attempts",
  rush_att: "Carries",
  targets: "Targets",
  pass_yd: "Yards",
  pass_td: "Touchdowns",
  pass_int: "Interceptions",
  rush_yd: "Yards",
  rush_td: "Touchdowns",
  rec: "Receptions",
  rec_yd: "Yards",
  rec_td: "Touchdowns",
  fumbles_lost: "Lost",
};

/**
 * A figure as the pane prints it — **a minus sign, never a hyphen**.
 *
 * One spelling for the rate and the value, which a render is what caught: the
 * rate said `× −2` in U+2212 and the value beside it `-2.0` in U+002D, two
 * different glyphs for one idea on one row. A hyphen is a word-joiner and sets
 * shorter and higher than a minus; in a column of tabular figures it reads as
 * a typo rather than as a sign.
 */
function signed(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

/** The same, to the decimal the scoring rows print. */
function signedFixed(value: number): string {
  return value < 0 ? `−${Math.abs(value).toFixed(1)}` : value.toFixed(1);
}


/**
 * `How 25.2 adds up` — the same arithmetic the column printed, itemised.
 *
 * **Off {@link scoringTerms} rather than restated**, which is the one thing
 * this group had to be: it is the pane's answer to *where did this number come
 * from*, and an answer that recomputed it would be a second opinion about the
 * figure beside it rather than an explanation of it. The rows sum to the total
 * because they are the summands.
 *
 * A term nobody earned is dropped, on {@link statFamilies}' own rule — a line
 * reading `0 interceptions × −2 = 0.0` is a row spent saying nothing. **A term
 * worth nothing is not**: a reception on the standard basis is `8 receptions ×
 * 0 = 0.0`, which is exactly the reader's question answered, and dropping it
 * would leave a pane whose rows do not add up to their own total.
 */
export function statScoring(
  line: GametimeStatLine,
  basis: StatBasis,
): StatLineRow[] {
  return scoringTerms(line, basis)
    .filter((term) => term.count !== 0)
    .map((term) => ({
      label: term.label,
      rate: term.unit,
      value: signedFixed(term.count * term.per),
      zero: term.count * term.per === 0,
    }));
}

/**
 * Add or drop one value of a multi-select facet.
 *
 * **Re-exported rather than spelled again**: this was a second copy of
 * `toggleFacet` until the two trays became one grammar, and one menu that
 * stopped agreeing with the other about what a second press means is the drift
 * a shared rule exists to prevent. Every caller in this feature reaches it
 * under this name, which is what kept the move to one line.
 */
export { toggleFacet };

/** The four positions the Pos row offers, in the order it draws them. */
export const STAT_POSITIONS: readonly StatBoardPosition[] = ["QB", "RB", "WR", "TE"];

/**
 * A reading of how the week's lineups treated a player — `WeekReading`'s own
 * four, which is the vocabulary the rest of this app already narrows by.
 *
 * **Re-exported rather than restated**, so a reading renamed on either side
 * stops a compile rather than quietly lighting the wrong cap. It is the tie
 * `shares-columns.ts` already draws one panel over, and it is why this module
 * reaches `league-subjects.ts` relatively with `.ts` — that file has no
 * imports of its own, which is what lets a narrowing resolve under Node's
 * runner.
 */
export type UsageKey = WeekReading;

/** The four, in the order both rails draw them. */
export const USAGE_KEYS: readonly UsageKey[] = WEEK_READINGS;

/** What each is called on a cap, and on a row's own chip. */
export const USAGE_LABEL: Record<UsageKey, string> = {
  start: "Started",
  bench: "Sat",
  "opp-start": "They started",
  "opp-bench": "They sat",
};

/** The same four, short, for a row's chips — a 300px track holds all four. */
export const USAGE_CHIP: Record<UsageKey, string> = {
  start: "Started",
  bench: "Sat",
  "opp-start": "Vs",
  "opp-bench": "Opp sat",
};

/** Which count on a row answers each reading. */
export const USAGE_COUNT: Record<UsageKey, (row: StatRow) => number | null> = {
  start: (row) => row.start,
  bench: (row) => row.bench,
  "opp-start": (row) => row.oppStart,
  "opp-bench": (row) => row.oppBench,
};

/**
 * The four narrowings, which are one AND.
 *
 * **Every set is multi-select and an empty set is "not asked" rather than
 * "nothing chosen"** — the rule `player-filters.ts` states in full one panel
 * over, and it is the arm that is silent when reversed: read the other way, a
 * player carrying a value that appeared after the reader last touched the menu
 * would quietly drop off the list.
 */
export type StatBoardFilters = {
  query: string;
  positions: readonly StatBoardPosition[];
  teams: readonly string[];
  /**
   * How far through a player's game must be — null until a handle moves.
   *
   * A span rather than a set of stops, because what a reader asks of a clock
   * is a range: *still early*, *nearly over*. A full-width span is not a
   * filter at all ({@link spanActive}), which is what keeps an untouched
   * control from quietly excluding every row on a bye.
   */
  clock: Span;
  /**
   * Which readings a row must have **somewhere**, ANDed.
   *
   * **The AND is over the reader's leagues, not over one of them**, and that
   * is the whole difference between this rail and the four keys in the pane. A
   * player sits on one roster per league, so within a single league the four
   * readings are a partition and every intersection of two is empty by
   * construction — which is `Subject.readings`' own argument for unioning
   * there, and this board's for making the pane's keys single-select. Asked of
   * a *player across twelve leagues* the same conjunction is an ordinary
   * question with an ordinary answer: `Started` ∧ `They sat` is the players a
   * reader started somewhere and somebody across from them benched somewhere
   * else, which is exactly the shape of "who should I be trading for".
   *
   * **A null count fails every reading and a nought fails its own.** A player
   * nobody in the reader's leagues holds is not in the question at all, so he
   * goes on the first cap pressed — which is what makes this rail the fastest
   * way to take a four-hundred-row board down to the reader's own players.
   */
  usage: readonly UsageKey[];
};

export const NO_STAT_FILTERS: StatBoardFilters = {
  query: "",
  positions: [],
  teams: [],
  clock: null,
  usage: [],
};

/** Whether anything is narrowing — what lights the Reset key. */
export function statFiltersActive(filters: StatBoardFilters): boolean {
  return filters.query.trim() !== "" || statFacetCount(filters) > 0;
}

/**
 * How many of the tray's four facets are answered, for the Filters key's
 * badge.
 *
 * **Counted per facet rather than per value** — "3" beside the key means three
 * questions have been answered, which is what a reader can act on; the number
 * of chips inside them is the tray's own business. It is `activeFilterCount`'s
 * own rule one panel over, and it deliberately leaves the **search** out: the
 * field is on the ledge with its own text in it, so a badge counting it would
 * be the same narrowing stated twice on one row.
 */
export function statFacetCount(filters: StatBoardFilters): number {
  return (
    (filters.positions.length > 0 ? 1 : 0) +
    (filters.teams.length > 0 ? 1 : 0) +
    (spanActive(filters.clock, STAT_STAGE_BOUNDS) ? 1 : 0) +
    (filters.usage.length > 0 ? 1 : 0)
  );
}

/**
 * What the tray's foot says it has narrowed to.
 *
 * **Every facet the badge counts is named here**, including the usage
 * readings, which is a departure from the design's own footer and is the
 * reading that makes the two honest: a foot saying `Nothing narrowed` under a
 * badge reading `1` is a contradiction on one row of one tray.
 */
export function statFilterSummary(filters: StatBoardFilters): string | null {
  const parts: string[] = [];
  if (filters.positions.length) parts.push(`Pos ${filters.positions.join(" · ")}`);
  if (filters.teams.length) parts.push(`Team ${filters.teams.join(" · ")}`);
  const { clock } = filters;
  if (clock && spanActive(clock, STAT_STAGE_BOUNDS)) {
    parts.push(`Clock ${STAT_STAGES[clock.lo]}–${STAT_STAGES[clock.hi]}`);
  }
  if (filters.usage.length) parts.push(usageSummary(filters.usage));
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A facet's values and how many rows carry each — **over the unfiltered
 * population**, which is the rule both trays' chips live by: a facet says how
 * many it *would leave*, not how many are left, so a chip that reads zero the
 * moment you press it cannot happen and a reader can widen without clearing
 * first.
 *
 * A row with no answer contributes to nothing rather than to a bucket of its
 * own: the board's two string facets are a position (which every row has, by
 * `boardPosition`) and a team (which the `Team` menu simply does not offer for
 * a row the feed named none for).
 */
export function statFacetCounts(
  rows: readonly StatRow[],
  read: (row: StatRow) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = read(row);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The rows a narrowing leaves.
 *
 * A case-insensitive `includes` on the name, which is what a reader typing
 * three letters of a surname means, and set membership on each of the other
 * two. A row whose name the feed never published cannot match a query and is
 * narrowed away by one — which is right: a search is a question about a name.
 */
export function narrowStatRows(
  rows: readonly StatRow[],
  filters: StatBoardFilters,
): StatRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.positions.length === 0 ||
        filters.positions.includes(row.position)) &&
      (filters.teams.length === 0 ||
        (row.team !== null && filters.teams.includes(row.team))) &&
      insideSpan(row.stage, filters.clock, STAT_STAGE_BOUNDS) &&
      (query === "" || (row.name ?? "").toLowerCase().includes(query)) &&
      // Every picked reading, somewhere — see `StatBoardFilters.usage`. A null
      // is a player the question is not about and fails on the first cap.
      filters.usage.every((key) => (USAGE_COUNT[key](row) ?? 0) > 0),
  );
}

/**
 * Which column the list is ordered by — **every head on the board, and only
 * a head**.
 *
 * The board had a `Sort` cap rail of six keys and the heads were not
 * pressable; the rail is gone and the heads are the control, which is the
 * design's own call and is the one that makes the vocabulary honest by
 * construction: a key naming an ordering nothing on the row could show was
 * always possible with a rail beside the table, and is now unreachable.
 *
 * **What went with the rail is the two summed sorts.** `Yds` and `TD` ordered
 * a board by the sum across all three families — the question "who moved the
 * ball furthest" asked of quarterbacks, backs and receivers at once — and no
 * head can carry them, because the sum is no single column's own figure and an
 * arrow on three heads would claim three orderings. It is a real capability
 * lost rather than a tidy-up, and what is left in its place is narrowing the
 * `Splits` rail to one family and pressing that family's `Yd`, which answers
 * the same question of the players a reader has narrowed to.
 */
export type StatSortKey =
  | "name"
  | "clock"
  | StatColumn["key"]
  | UsageKey
  | "points";

/** The list's default order: the week's best first. */
export const DEFAULT_STAT_SORT: StatSortKey = "points";

/**
 * Which way a key is read the *first* time it is pressed.
 *
 * Descending everywhere but the name, because every figure on this board is a
 * superlative question — who scored most, who I started most, whose game is
 * furthest along — and a name is a list a reader looks somebody up in.
 */
export function defaultStatAscending(key: StatSortKey): boolean {
  return key === "name";
}

/** The ordering a press on one head leaves, given the one in force. */
export type StatSort = { key: StatSortKey; asc: boolean };

export const DEFAULT_STAT_SORT_STATE: StatSort = {
  key: DEFAULT_STAT_SORT,
  asc: false,
};

/**
 * A press on a head: **a new key sorts by it, the lit key reverses**.
 *
 * One function rather than a ternary at the call site, because the two arms
 * are not symmetrical — a fresh press takes the key's own natural direction
 * and a repeat takes the opposite of whatever is in force — and a component
 * that got that backwards would be a board whose first press on `Name` opened
 * at Z.
 */
export function nextStatSort(held: StatSort, key: StatSortKey): StatSort {
  if (held.key === key) return { key, asc: !held.asc };
  return { key, asc: defaultStatAscending(key) };
}

/** Ordered, and given the place each row holds **in this view**. */
export function rankStatRows(
  rows: readonly StatRow[],
  sort: StatSort,
): RankedStatRow[] {
  const sorted = [...rows].sort((a, b) => compare(a, b, sort));
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * What one row weighs on one key — a number, a name, or **null for a question
 * it is not in**.
 *
 * The three kinds are three different absences and only one of them is null: a
 * split figure is always a figure (every line ships all thirteen), a name is
 * always a string (the id stands in where the feed published none), and a
 * usage count or a clock stage can genuinely be unknown.
 */
function weigh(row: StatRow, key: StatSortKey): number | string | null {
  if (key === "name") return row.name ?? row.player_id;
  if (key === "points") return row.points;
  if (key === "clock") return row.stage;
  if (key in USAGE_COUNT) return USAGE_COUNT[key as UsageKey](row);
  return row[key as StatColumn["key"]];
}

/**
 * Two rows on one ordering.
 *
 * **An absent value sorts last in either direction, and a zero sorts as a
 * zero.** A player nobody in the reader's leagues has is not the least-started
 * player of the week — he is not in the question at all — where a player they
 * hold and never started is a real nought; and a row whose game the board
 * could not read is not the earliest kickoff of the afternoon. It is the
 * distinction {@link StatRow.start} and {@link StatRow.stage} both carry, and
 * it is the one thing about a *reversible* sort that is silent when wrong:
 * folded into the comparison, flipping the arrow would float every row the
 * question is not about to the top of the board.
 *
 * **Points are the tiebreaker, then the name, and neither reverses.** A count
 * is a small integer over a four-hundred-row board, so ordering by `Started`
 * without one would leave every player started in three leagues in whatever
 * order the ids arrived in — a list that reshuffles between frames with
 * nothing on screen having changed. A tiebreak that flipped with the arrow
 * would do the same thing on every press.
 */
function compare(a: StatRow, b: StatRow, sort: StatSort): number {
  const left = weigh(a, sort.key);
  const right = weigh(b, sort.key);
  if (left === null || right === null) {
    if (left !== right) return left === null ? 1 : -1;
  } else if (typeof left === "string" || typeof right === "string") {
    const cmp = String(left).localeCompare(String(right));
    if (cmp !== 0) return sort.asc ? cmp : -cmp;
  } else if (left !== right) {
    return sort.asc ? left - right : right - left;
  }
  if (a.points !== b.points) return b.points - a.points;
  return byName(a, b);
}

function byName(a: StatRow, b: StatRow): number {
  return (a.name ?? a.player_id).localeCompare(b.name ?? b.player_id);
}

/**
 * One head of the lower tier: what it says, what it orders by and how wide.
 *
 * **Derived from the same width table the row and the group spans are**, which
 * is the mismatch this whole module is arranged against: a head list written
 * out by hand is one that files `Rushing TD` over a passing touchdown the
 * first time a column moves, with every number on the board correct and every
 * one of them labelled wrong.
 */
export type StatHead = {
  key: StatSortKey;
  label: string;
  /** What it is called in full, for the press's own accessible name. */
  hint: string;
  width: number;
  /** `Player` reads left; every figure reads right, under its own column. */
  align: "left" | "right";
  pin: "left" | "right" | null;
};

/** Every head, in the order the tier draws them. */
export function statHeads(columns: readonly StatColumn[]): StatHead[] {
  return [
    { key: "name", label: "Player", hint: "Name", width: STAT_FIXED.player, align: "left", pin: "left" },
    { key: "clock", label: "Game", hint: "Game clock", width: STAT_FIXED.game, align: "right", pin: null },
    ...columns.map(
      (column): StatHead => ({
        key: column.key,
        label: column.label,
        hint: column.hint,
        width: column.width,
        align: "right",
        pin: null,
      }),
    ),
    ...USAGE_KEYS.map(
      (key): StatHead => ({
        key,
        label: USAGE_CHIP[key],
        hint: USAGE_LABEL[key],
        width: STAT_FIXED.count,
        align: "right",
        pin: null,
      }),
    ),
    { key: "points", label: "Pts", hint: "Points", width: STAT_FIXED.points, align: "right", pin: "right" },
  ];
}

/**
 * The sort a given set of columns can still answer.
 *
 * **The heads *are* the sort, and the `Splits` rail can take a head off the
 * board.** So a reader who ordered by `Passing yards` and then dropped the
 * passing family was left with a list ordered by a column nothing on screen
 * names, no head lit, and no way back to that order — which is the one thing
 * about the head-as-sort model that the six-cap rail it replaced could not do
 * wrong, its six keys having been fixed. It is `sharesColumns`' own rule one
 * panel over — a sort names a column on screen, and a dropped column falls
 * back — with this board's own fallback: the points column, which no rail can
 * remove and which is the resting order anyway.
 *
 * A sort the columns still carry is returned **by identity**, so a caller may
 * hand it straight back to `setState` and re-render nothing.
 */
export function statSortFor(
  held: StatSort,
  columns: readonly StatColumn[],
): StatSort {
  return statHeads(columns).some((head) => head.key === held.key)
    ? held
    : DEFAULT_STAT_SORT_STATE;
}

/** The list's best week, for the bar's readout. */
export function topStatRow(rows: readonly StatRow[]): StatRow | null {
  let best: StatRow | null = null;
  for (const row of rows) {
    if (best === null || row.points > best.points) best = row;
  }
  return best;
}

/** One tag of the `Your leagues` cell: a reading, its word, and its count. */
export type StatTag = { key: UsageKey; label: string; count: number };

/**
 * The tags a row carries, **built only from the counts he has a figure in**.
 *
 * A zero is omitted rather than drawn, which is what lets four labels fit a
 * 300px track: a receiver started in nine leagues carries one tag, not four
 * with three noughts in them. The count is still *knowable* — the pane a press
 * opens states all four on its own keys, nought included — so what an omitted
 * tag costs is nothing a reader can only get here.
 *
 * **All four, where this used to sum the opposing pair.** The four-column
 * board had 236px for this cell and `against` was what fitted; the wide board
 * gives it 300, which is what the design measured the four labels against —
 * and the two opposing readings are two different facts about somebody else's
 * week, which is the distinction the pane's own keys turn on.
 *
 * A row nobody holds carries none, and the cell says so in words rather than
 * standing empty: `held` is what the component reads for that, never
 * `tags.length === 0`, because a held player the reader neither started, sat
 * nor faced would otherwise be labelled as one their leagues have never heard
 * of.
 */
export function statTags(row: StatRow): StatTag[] {
  const tags: StatTag[] = [];
  for (const key of USAGE_KEYS) {
    const count = USAGE_COUNT[key](row);
    if (count) tags.push({ key, label: USAGE_CHIP[key], count });
  }
  return tags;
}

/**
 * The same four on one line, for the phone row — `6 st · 2 sat · 4 vs`.
 *
 * Short forms rather than the desktop's words, and it is a width: the line
 * they share already carries a position, a matchup and a clock, and `Started
 * 6 · Sat 2 · Vs 4` is most of a 390px row on its own. The vocabulary is the
 * same four readings in the same order, so a reader who has pressed `Started`
 * on the caps above can see which figure moved.
 */
export function statTagLine(row: StatRow): string {
  return statTags(row)
    .map((tag) => `${tag.count} ${PHONE_TAG[tag.key]}`)
    .join(" · ");
}

/** Exhaustive over the four readings — a fifth breaks the compile here. */
const PHONE_TAG: Record<UsageKey, string> = {
  start: "st",
  bench: "sat",
  "opp-start": "vs",
  "opp-bench": "vs sat",
};

/* ------------------------------------------------------------------ */

/**
 * Which leagues a set of readings leaves, over a population of players.
 *
 * **This is the page-scope narrowing, and the population is the board's own
 * narrowed rows** — which is the only scope that makes the rail mean anything.
 * Asked over every player the reader's leagues fielded, `Started` is "leagues
 * where I started somebody", which is every league with a lineup in it; asked
 * over the rows a reader has already narrowed to quarterbacks, or to one
 * surname, it is "the leagues I started a quarterback in". The caps sit on the
 * *board's* ledge beside the search field and the two menus for exactly that
 * reason: they are a question about the players on screen.
 *
 * **A league passes when every picked reading is answered in it, by any of
 * them.** The AND is across readings and the OR is across players, which is
 * what `matchesSubjects`' own `all` mode does one narrowing over — and it is
 * the only arrangement with anything to say, since ANDing two readings about
 * *one* player is empty by construction.
 *
 * Null is "not narrowing", which is a third state and not an empty set: no cap
 * is pressed, so every league stands. An empty *set* is a narrowing that left
 * nothing, and the grid behind it is right to be empty.
 *
 * The leagues behind each count are the fold's own (`WeekTwoSidedShare.
 * leagues`), passed in as id lists so this stays free of `features/shared`'s
 * client half.
 */
export function usageLeagueScope(
  rows: readonly StatRow[],
  usage: readonly UsageKey[],
  /** Player id to the league ids behind each of his four readings. */
  leagues: Readonly<Record<string, Readonly<Record<UsageKey, readonly string[]>>>>,
): ReadonlySet<string> | null {
  if (usage.length === 0) return null;

  let scope: Set<string> | null = null;
  for (const key of usage) {
    const answered = new Set<string>();
    for (const row of rows) {
      for (const id of leagues[row.player_id]?.[key] ?? []) answered.add(id);
    }
    if (scope === null) scope = answered;
    else for (const id of [...scope]) if (!answered.has(id)) scope.delete(id);
  }
  return scope;
}

/**
 * What the pane's track picks among: his four readings, and `all` of them.
 *
 * `all` is the resting reading and the one the manager console's pane has no
 * need of — there a player is always on exactly one of three arms, where here
 * the question a reader asks first is "which of my leagues is he in at all,
 * either side", and the four keys are the refinements of it.
 */
export type PlayerReading = UsageKey | "all";

/** The track's keys, in order — `All` first, then the four as the rails draw them. */
export const PLAYER_READINGS: readonly PlayerReading[] = ["all", ...USAGE_KEYS];

export const READING_LABEL: Record<PlayerReading, string> = {
  all: "All",
  ...USAGE_LABEL,
};

/**
 * How many of the reader's leagues a reading answers for, on one player.
 *
 * `all` is the four summed, which is exact rather than an estimate: he sits on
 * one roster per league, so the four partition his leagues and the sum counts
 * each once. Null for a player nobody holds, on `USAGE_COUNT`'s own terms — a
 * nought there would be a claim about a player the fold never saw.
 */
export function readingCount(row: StatRow, reading: PlayerReading): number | null {
  if (reading !== "all") return USAGE_COUNT[reading](row);
  if (!row.held) return null;
  return USAGE_KEYS.reduce((sum, key) => sum + (USAGE_COUNT[key](row) ?? 0), 0);
}

/**
 * The leagues one player's picked reading leaves — the pane's own narrowing,
 * and what its `Narrow grid` key puts on the grid.
 *
 * **Single-select, and it has to be**: the four readings partition one
 * player's leagues, so a second key ANDed onto the first is always zero
 * leagues and a reader would be shown an empty grid for a press that looked
 * exactly like the one before it. It is `Subject.readings`' own argument,
 * which unions for the same reason this refuses to offer the choice.
 *
 * `all` is the union of the four — every league he is in, either side — which
 * is the one union that says something, by the same partition.
 */
export function playerLeagueScope(
  reading: PlayerReading | null,
  leagues: Readonly<Record<UsageKey, readonly string[]>> | null,
): ReadonlySet<string> | null {
  if (!reading || !leagues) return null;
  if (reading === "all") return new Set(USAGE_KEYS.flatMap((key) => leagues[key] ?? []));
  return new Set(leagues[reading] ?? []);
}

/**
 * What the header says a usage narrowing left — `Started · They sat`.
 *
 * The words alone; the count beside it is the grid's own, which is the shape
 * the league filters' summary already has one line over (`{filterSummary} ·
 * {visible} of {total}`) and the reason this does not state one: two figures
 * for one narrowing would be a second denominator nobody asked for.
 */
export function usageSummary(usage: readonly UsageKey[]): string {
  return usage.map((key) => USAGE_LABEL[key]).join(" · ");
}
