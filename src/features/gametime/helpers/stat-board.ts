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
};

/**
 * Standard fantasy scoring, spelled once: a passing yard is a twenty-fifth of
 * a point, a passing touchdown four, an interception minus two, a rushing or
 * receiving yard a tenth, those touchdowns six, a lost fumble minus two, and a
 * reception whatever the basis says.
 *
 * Every term is emitted, zero or not; the readers drop their own empties —
 * {@link statScoring} because a row reading `0 touchdowns × 6 = 0.0` is a line
 * spent saying nothing, and {@link statPoints} because adding noughts costs it
 * nothing.
 */
function scoringTerms(line: GametimeStatLine, basis: StatBasis): ScoringTerm[] {
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return [
    { key: "pass_yd", family: "pass", label: plural(line.pass_yd, "passing yard", "passing yards"), count: line.pass_yd, per: 0.04 },
    { key: "pass_td", family: "pass", label: plural(line.pass_td, "passing touchdown", "passing touchdowns"), count: line.pass_td, per: 4 },
    { key: "pass_int", family: "pass", label: plural(line.pass_int, "interception", "interceptions"), count: line.pass_int, per: -2 },
    { key: "rush_yd", family: "rush", label: plural(line.rush_yd, "rushing yard", "rushing yards"), count: line.rush_yd, per: 0.1 },
    { key: "rush_td", family: "rush", label: plural(line.rush_td, "rushing touchdown", "rushing touchdowns"), count: line.rush_td, per: 6 },
    { key: "rec", family: "rec", label: plural(line.rec, "reception", "receptions"), count: line.rec, per: PER_RECEPTION[basis] },
    { key: "rec_yd", family: "rec", label: plural(line.rec_yd, "receiving yard", "receiving yards"), count: line.rec_yd, per: 0.1 },
    { key: "rec_td", family: "rec", label: plural(line.rec_td, "receiving touchdown", "receiving touchdowns"), count: line.rec_td, per: 6 },
    { key: "fumbles_lost", family: "fum", label: plural(line.fumbles_lost, "fumble lost", "fumbles lost"), count: line.fumbles_lost, per: -2 },
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
  key: "pass_yd" | "pass_td" | "pass_int" | "rush_yd" | "rush_td" | "rec" | "rec_yd" | "rec_td" | "fumbles_lost";
  family: StatFamilyKey;
  /** The lower tier's own word — `Yd` three times, under three families. */
  label: string;
  width: number;
};

/** Every split column, in the order the board draws them. */
export const STAT_COLUMNS: readonly StatColumn[] = [
  { key: "pass_yd", family: "pass", label: "Yd", width: 56 },
  { key: "pass_td", family: "pass", label: "TD", width: 44 },
  { key: "pass_int", family: "pass", label: "Int", width: 44 },
  { key: "rush_yd", family: "rush", label: "Yd", width: 56 },
  { key: "rush_td", family: "rush", label: "TD", width: 44 },
  { key: "rec", family: "rec", label: "Rec", width: 44 },
  { key: "rec_yd", family: "rec", label: "Yd", width: 56 },
  { key: "rec_td", family: "rec", label: "TD", width: 44 },
  { key: "fumbles_lost", family: "fum", label: "FL", width: 36 },
];

/** What each family's upper-tier span is called. `fum` labels nothing. */
export const FAMILY_TITLE: Record<StatFamilyKey, string> = {
  pass: "Passing",
  rush: "Rushing",
  rec: "Receiving",
  fum: "",
};

/** The two fixed tracks either side of the splits, and the two between them. */
export const STAT_FIXED = {
  player: 228,
  game: 76,
  leagues: 300,
  points: 84,
} as const;

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
  let width = STAT_FIXED.player + STAT_FIXED.game + STAT_FIXED.leagues + STAT_FIXED.points;
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
    { key: "leagues", label: "", width: STAT_FIXED.leagues, cut: true, pin: null },
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
  /** `0.1 each`, `× 6` — the pane's two readings of one number. */
  rate: string;
  value: string;
  /** Whether the value is a nought, which the pane inks quietly. */
  zero: boolean;
};

/** The short word each figure takes on the phone's strip. */
const SHORT: Record<StatColumn["key"], string> = {
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
 * **An empty family is dropped and a zero inside a live one is kept**, which
 * is the distinction that makes the strip readable: a quarterback who threw
 * for three touchdowns and no interceptions reads `PASS 288 yd · 3 td` — the
 * interception is a nought inside a family he is in, and it is omitted from
 * the *text* — while a receiver has no passing line at all and the group goes.
 * The pane's rows keep every figure of a family it draws, nought included,
 * because there the rate beside it is the point.
 */
export function statFamilies(
  line: GametimeStatLine,
  basis: StatBasis,
): StatFamily[] {
  const per = new Map<string, number>();
  for (const term of scoringTerms(line, basis)) per.set(term.key, term.per);

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
        rate: `${signed(per.get(f.column.key) ?? 0)} each`,
        value: String(f.count),
        zero: f.count === 0,
      })),
    });
  }
  return families;
}

/** What the pane calls each figure, where the column head has two letters. */
const COLUMN_NOUN: Record<StatColumn["key"], string> = {
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
      rate: `× ${signed(term.per)}`,
      value: signedFixed(term.count * term.per),
      zero: term.count * term.per === 0,
    }));
}

/** The four positions the Pos menu offers, in the order it draws them. */
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
  usage: [],
};

/** Whether anything is narrowing — what lights the Reset key. */
export function statFiltersActive(filters: StatBoardFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.positions.length > 0 ||
    filters.teams.length > 0 ||
    filters.usage.length > 0
  );
}

/**
 * Add or drop one value of a multi-select set.
 *
 * Here rather than in the component because it is the edit both menus make and
 * a second spelling is one menu that stops agreeing with the other about what
 * a second press means. Order is the press order, which is what the trigger's
 * `CIN · LAR` summary reads.
 */
export function toggleFilterValue<T extends string>(
  held: readonly T[],
  value: T,
): T[] {
  return held.includes(value) ? held.filter((v) => v !== value) : [...held, value];
}

/**
 * What a multi-select trigger says it is narrowed to.
 *
 * Three readings rather than a list that grows without bound: `All` when
 * nothing is picked, the values themselves while there are few enough to read
 * on a pill, and a count past that. The noun is the caller's, because `3
 * positions` and `3 teams` are the only thing that differs between the two
 * menus.
 */
export function menuSummary(held: readonly string[], noun: string): string {
  if (held.length === 0) return "All";
  if (held.length <= 2) return held.join(" · ");
  return `${held.length} ${noun}`;
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
      (query === "" || (row.name ?? "").toLowerCase().includes(query)) &&
      // Every picked reading, somewhere — see `StatBoardFilters.usage`. A null
      // is a player the question is not about and fails on the first cap.
      filters.usage.every((key) => (USAGE_COUNT[key](row) ?? 0) > 0),
  );
}

/**
 * Which of the four the list is ordered by.
 *
 * Every one of them is a figure the row already prints, which is what keeps
 * the Sort caps, the lit tag and the header arrow one vocabulary: a key naming
 * an ordering the row could not show would be a list whose order nothing on it
 * explained.
 */
export type StatSortKey =
  | "points"
  | "yds"
  | "td"
  | "start"
  | "bench"
  | "against";

/**
 * The two summed figures the rail offers, which no single column prints.
 *
 * **A sum across the three families rather than one of them**, which is what a
 * reader pressing `Yds` on a board holding quarterbacks, backs and receivers
 * means: the question is who moved the ball furthest, and a rail that asked it
 * three times would be three caps saying the same word. The column head is
 * therefore not lit by either — see `Head`, where the arrow stays on the
 * figure a column can show.
 */
export function statYards(row: StatRow): number {
  return row.pass_yd + row.rush_yd + row.rec_yd;
}

export function statTouchdowns(row: StatRow): number {
  return row.pass_td + row.rush_td + row.rec_td;
}

/** The caps, in the order the ledge draws them. */
export const STAT_SORTS: readonly { key: StatSortKey; label: string }[] = [
  { key: "points", label: "Pts" },
  { key: "yds", label: "Yds" },
  { key: "td", label: "TD" },
  { key: "start", label: "Started" },
  { key: "bench", label: "Sat" },
  { key: "against", label: "Against" },
];

/** The list's default order: the week's best first. */
export const DEFAULT_STAT_SORT: StatSortKey = "points";

/** Ordered, and given the place each row holds **in this view**. */
export function rankStatRows(
  rows: readonly StatRow[],
  key: StatSortKey,
): RankedStatRow[] {
  const sorted = [...rows].sort((a, b) => compare(a, b, key));
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Two rows on one key — **descending, always**.
 *
 * There is no direction here and that is the design rather than an omission:
 * sorting lives in the ledge's four caps, and every one of them asks a
 * superlative question — who scored most, who I started most. A toggle would
 * be a second state those caps cannot show, so the one control would stop
 * describing the order.
 *
 * **Points are the tiebreaker on the three counts**, because a count is a
 * small integer over a four-hundred-row board: ordering by `Started` without
 * one would leave every player started in three leagues in whatever order the
 * ids arrived in, which is a list that reshuffles between frames with nothing
 * on screen having changed. **Then the name, ascending**, for the same reason
 * one layer down.
 *
 * **An absent count sorts last, and a zero sorts as a zero.** A player nobody
 * in the reader's leagues has is not the least-started player of the week —
 * he is not in the question at all — where a player they hold and never
 * started is a real nought. It is the distinction {@link StatRow.start}
 * carries, and it is what makes `Started` a "mine first" ordering.
 */
function compare(a: StatRow, b: StatRow, key: StatSortKey): number {
  if (key === "yds" || key === "td") {
    // A sum is always a figure — every line ships all nine — so there is no
    // null arm here and the points tiebreak below does the rest.
    const of = key === "yds" ? statYards : statTouchdowns;
    const left = of(a);
    const right = of(b);
    if (left !== right) return right - left;
  } else if (key !== "points") {
    const left = a[key];
    const right = b[key];
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else if (left !== right) {
      return right - left;
    }
  }
  if (a.points !== b.points) return b.points - a.points;
  return byName(a, b);
}

function byName(a: StatRow, b: StatRow): number {
  return (a.name ?? a.player_id).localeCompare(b.name ?? b.player_id);
}

/** Every team on the list, for the Team menu. A row with none offers none. */
export function statTeams(rows: readonly StatRow[]): string[] {
  const teams = new Set<string>();
  for (const row of rows) if (row.team) teams.add(row.team);
  return [...teams].sort();
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
