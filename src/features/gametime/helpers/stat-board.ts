/**
 * The stat board's arithmetic: what a player's week is worth, which rows a
 * narrowing leaves, and what order they come in.
 *
 * Pure and under Node's own runner, for `seat-compare.ts`' and
 * `matchup-gauge.ts`' reason: a board sorted the wrong way, a rank that does
 * not renumber, or a zero scored as a figure all render a perfectly ordinary
 * table and say something untrue. The component beside this owns the surfaces
 * and nothing else.
 *
 * **The board is account-wide, so it prices itself.** Every other figure on
 * this page is scored through one league's own `scoring_settings`; a board
 * that spans a reader's leagues has no single league to ask, and picking one
 * would be a claim none of the others could support. So it states its basis
 * (`PPR`, `Half PPR`, `Standard`) on the bar and prices every row on it —
 * `figured()`'s own argument one reading over, where the panes are labelled
 * `Live` so nobody has to infer which of three scales they are on.
 */

import type { GametimeGame, GametimeStatLine, StatBoardPosition } from "@/shared/contract";

// **Relative and `.ts`, on this repo's deep-import rule**: `league-subjects.ts`
// is the module with no imports of its own, which is what lets a narrowing
// resolve under Node's runner — and an alias import never would. Reaching for
// it rather than spelling the four readings again is the tie
// `WEEK_READING_COLUMN` already draws one grain out: the board's four columns
// and the tray's four keys are one vocabulary, so a reading renamed on either
// side stops compiling rather than quietly lighting the wrong cell.
import { WEEK_READINGS, type WeekReading } from "../../shared/league-subjects.ts";

import { gameClockLabel } from "./live-record.ts";

/** Which of the three scales a board is priced on. */
export type StatBasis = "ppr" | "half" | "std";

/** What a reception is worth on each. The whole difference between them. */
const PER_RECEPTION: Record<StatBasis, number> = { ppr: 1, half: 0.5, std: 0 };

/** What the bar calls each, so a reader is never left inferring the scale. */
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
 * One player's week, priced.
 *
 * Standard fantasy scoring, spelled once: a passing yard is a twenty-fifth of
 * a point, a passing touchdown four, an interception minus two, a rushing or
 * receiving yard a tenth, those touchdowns six, a lost fumble minus two, and a
 * reception whatever the basis says.
 *
 * Rounded to the one decimal the column prints, so the figure a reader adds up
 * and the figure they are shown are the same number.
 */
export function statPoints(line: GametimeStatLine, basis: StatBasis): number {
  const points =
    line.pass_yd / 25 +
    line.pass_td * 4 -
    line.pass_int * 2 +
    line.rush_yd / 10 +
    line.rush_td * 6 +
    line.rec * PER_RECEPTION[basis] +
    line.rec_yd / 10 +
    line.rec_td * 6 -
    line.fumbles_lost * 2;
  return Math.round(points * 10) / 10;
}

/**
 * Which of the four readings a share column carries.
 *
 * It **is** {@link WeekReading}, rather than a second union that happens to
 * agree with it: the tray's keys are the row's cells, so a column named
 * differently from the reading that lights it would be two vocabularies for one
 * fact. See the import above.
 */
export type ShareColumnKey = WeekReading;

/**
 * How the week's lineups treated one player, as the board's join reads it.
 *
 * A structural four rather than `WeekTwoSidedShare` itself, which is what keeps
 * this module free of `features/shared`'s client half and therefore testable
 * under Node's own runner: the fold's own row satisfies it, and nothing here
 * needs the leagues behind the counts.
 */
export type StatShareCounts = {
  started: number;
  benched: number;
  oppStarted: number;
  oppBenched: number;
};

/** One row of the board: the wire's line, joined to his game and priced. */
export type StatRow = GametimeStatLine & {
  /**
   * The NFL opponent as the column prints him — `@NYJ` away, `CLE` home — or
   * null on a bye, an unnamed team, or a scoreboard nobody could read.
   */
  opponent: string | null;
  /** What the Game column reads, and whether his game is running. */
  clock: { text: string; live: boolean };
  points: number;
  /**
   * Whether anybody in the reader's leagues has him — what the `Mine` cap
   * narrows to, what the name cell's pip says, and what the bar's `Yours`
   * counts.
   *
   * It is the presence of a share row rather than a count above zero, because
   * the fold only ever produces a row for a player some roster names: a player
   * with four zeroes cannot exist, where a player with no entry is one the
   * reader's leagues have never heard of.
   */
  held: boolean;
  /**
   * The four counts, keyed by the reading — **null for a player nobody in the
   * reader's leagues holds, and never zero.**
   *
   * The distinction is the one thing about these four columns that is silent
   * when it is wrong. A dash says "not in your leagues" and a `0` says "in
   * your leagues, and this side never did that with him" — which on these four
   * is a real answer rather than an absence, so it must not fall back to null.
   * It is `weightOf`'s own note, and it is why {@link compare} sorts a null
   * last in either direction while sorting a zero as a zero.
   *
   * Keyed by the column's own name so {@link compare} can read a share column
   * exactly as it reads a stat one.
   */
  start: number | null;
  bench: number | null;
  "opp-start": number | null;
  "opp-bench": number | null;
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
   * **A join rather than a second list**, which is the whole of the merge: the
   * board is every NFL player with a line and the fold is every player the
   * reader's leagues fielded, and the two overlap on rather less than half of
   * either. So every unmatched row keeps four nulls and reads four dashes, and
   * a player the reader holds who did nothing this week is simply not on the
   * board at all — he has no line to be a row of.
   *
   * Defaulted, because the fold is behind the page's own gate: before a reader
   * has any reason to pay for it the board is the NFL's week and nothing else,
   * which is exactly what it was before the merge.
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
      "opp-start": share ? share.oppStarted : null,
      "opp-bench": share ? share.oppBenched : null,
    };
  });
}

/** Nothing folded yet — a module-level identity, so a memo sees one object. */
export const NO_SHARES: Readonly<Record<string, StatShareCounts>> = {};

/** How many of the board's rows anybody in the reader's leagues has. */
export function heldStatRows(rows: readonly StatRow[]): number {
  let held = 0;
  for (const row of rows) if (row.held) held++;
  return held;
}

/** What the caps offer, and what "not asked" is called. */
export type PositionFilter = StatBoardPosition | "ALL";

/**
 * Whose shelf the board is showing — the merge's own narrowing.
 *
 * The board is account-wide and only a minority of its rows are in the
 * reader's leagues at all, so a scope needs a control rather than a reading:
 * without one, `Mine` is a question a reader can only answer by scanning a
 * column of dashes. `all` is the default, because the board's subject is the
 * NFL's week and the reader's leagues are the lens.
 */
export type StatScope = "all" | "mine";

/** The four narrowings, which are one AND. */
export type StatBoardFilters = {
  query: string;
  position: PositionFilter;
  team: string;
  /**
   * On the filters rather than beside them, which is the reverse of what the
   * design's state table draws and is the same fact either way: it is a
   * narrowing, it is undone by the same Reset key, and `narrowStatRows`,
   * `statFiltersActive` and that key each take one object instead of two.
   */
  scope: StatScope;
};

export const NO_STAT_FILTERS: StatBoardFilters = {
  query: "",
  position: "ALL",
  team: "ALL",
  scope: "all",
};

/** Whether anything is narrowing — what lights the Reset key. */
export function statFiltersActive(filters: StatBoardFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.position !== "ALL" ||
    filters.team !== "ALL" ||
    filters.scope !== "all"
  );
}

/**
 * The rows a narrowing leaves.
 *
 * A case-insensitive `includes` on the name, which is what a reader typing
 * three letters of a surname means, and single-select on each of the other
 * two with `ALL` as "not asked". A row whose name the feed never published
 * cannot match a query and is narrowed away by one — which is right: a search
 * is a question about a name.
 *
 * **`mine` narrows to a share row rather than to a count**, on
 * {@link StatRow.held}'s own terms: a player his own leagues answered four
 * zeroes for is still in them.
 */
export function narrowStatRows(
  rows: readonly StatRow[],
  filters: StatBoardFilters,
): StatRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.scope === "all" || row.held) &&
      (filters.position === "ALL" || row.position === filters.position) &&
      (filters.team === "ALL" || row.team === filters.team) &&
      (query === "" || (row.name ?? "").toLowerCase().includes(query)),
  );
}

/**
 * Which column a board is ordered by.
 *
 * Every column but the tray key's, which heads a column of controls: there is
 * no ordering a board by a row's disclosure, and a type that allowed one would
 * be a state the head could never produce and every reader of it would have to
 * handle.
 */
export type StatSortKey = Exclude<StatColumnKey, "tray">;

/**
 * A column a head can be pressed on — every one but the tray key's.
 *
 * The narrowing exists so {@link compare} can read `row[column.key]` at all:
 * the tray has no field on a row to order by, and a signature that admitted it
 * would be a lookup the compiler could only wave through with an `any`.
 */
export type SortableStatColumn = StatColumn & { key: StatSortKey };

/** Ordered, and given the place each row holds **in this view**. */
export function rankStatRows(
  rows: readonly StatRow[],
  key: StatSortKey,
  direction: 1 | -1,
): RankedStatRow[] {
  const column = STAT_COLUMN_BY_KEY.get(key) ?? POINTS_COLUMN;
  const sorted = [...rows].sort((a, b) => compare(a, b, column, direction));
  return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
}

/**
 * Two rows on one column.
 *
 * **An absent value sorts last in either direction**: a player with no clock
 * is not the earliest kickoff of the week, and flipping the arrow must not
 * make him one.
 *
 * **And on the four share columns a zero is not an absence**, which is the
 * whole of why the numeric branch reads a nullable: a player his leagues
 * answered `0` for sorts as a zero, above the players they have never heard
 * of. Every other figure column is a real count that can only be a number, so
 * the null arm is inert there — one rule rather than a second code path.
 *
 * **Ties break on the name, ascending, whichever way the column runs.** A
 * points column has a great many of them, and stable-sort order over a record
 * is the order the ids happened to arrive in — a board that reshuffled its
 * equal rows between frames with nothing on screen having changed.
 */
function compare(
  a: StatRow,
  b: StatRow,
  column: SortableStatColumn,
  direction: 1 | -1,
): number {
  if (column.numeric) {
    const left = a[column.key] as number | null;
    const right = b[column.key] as number | null;
    if (left === null || right === null) {
      if (left === right) return byName(a, b);
      return left === null ? 1 : -1;
    }
    const gap = left - right;
    if (gap !== 0) return gap * direction;
    return byName(a, b);
  }
  const left = text(a, column.key);
  const right = text(b, column.key);
  if (left === right) return byName(a, b);
  if (left === "") return 1;
  if (right === "") return -1;
  return left.localeCompare(right) * direction;
}

function text(row: StatRow, key: StatSortKey): string {
  if (key === "clock") return row.clock.text;
  const value = row[key as keyof StatRow];
  return typeof value === "string" ? value : "";
}

function byName(a: StatRow, b: StatRow): number {
  return (a.name ?? a.player_id).localeCompare(b.name ?? b.player_id);
}

/** Every team on the board, for the Team menu. A row with none offers none. */
export function statTeams(rows: readonly StatRow[]): string[] {
  const teams = new Set<string>();
  for (const row of rows) if (row.team) teams.add(row.team);
  return [...teams].sort();
}

/** The board's best week, for the collapsed bar's readout. */
export function topStatRow(rows: readonly StatRow[]): StatRow | null {
  let best: StatRow | null = null;
  for (const row of rows) {
    if (best === null || row.points > best.points) best = row;
  }
  return best;
}

/**
 * A player's week on one line, for the phone row.
 *
 * **Built only from the groups he has a figure in**, so a receiver's line is
 * never three dashes wide on a 390px pane — which is the whole reason the
 * phone drops the columns rather than shrinking them. A player with nothing to
 * say cannot reach this, since a row with no figure at all is not on the board
 * (`statBoardLines`).
 */
export function statLineSummary(row: StatRow): string {
  const parts: string[] = [];
  if (row.pass_yd) {
    parts.push(
      `${row.pass_yd} PA${row.pass_td ? `/${row.pass_td}TD` : ""}${
        row.pass_int ? `/${row.pass_int}INT` : ""
      }`,
    );
  }
  if (row.rush_yd) parts.push(`${row.rush_yd} RU${row.rush_td ? `/${row.rush_td}TD` : ""}`);
  if (row.rec) parts.push(`${row.rec}-${row.rec_yd}${row.rec_td ? `/${row.rec_td}TD` : ""}`);
  if (row.fumbles_lost) parts.push(`${row.fumbles_lost} FUM`);
  return parts.join(" · ");
}

/**
 * Which group a column belongs to, or none.
 *
 * `My leagues` is the merge's own, and it is the one group whose label is
 * drawn in `--billet-accent` rather than `--billet-scope`: those four columns
 * are the reader's own half of the row, where the thirteen beside them are the
 * NFL's.
 */
export type StatGroup =
  | "Passing"
  | "Rushing"
  | "Receiving"
  | "My leagues"
  | "Total"
  | null;

/** Every track of the desktop grid, sortable or not. */
export type StatColumnKey =
  | "name"
  | "position"
  | "team"
  | "opponent"
  | "clock"
  | "pass_yd"
  | "pass_td"
  | "pass_int"
  | "rush_yd"
  | "rush_td"
  | "rec"
  | "rec_yd"
  | "rec_td"
  | "fumbles_lost"
  | ShareColumnKey
  | "points"
  | "tray";

/** One column of the desktop grid. */
export type StatColumn = {
  key: StatColumnKey;
  label: string;
  /** What the head says it is, where the short label alone would not. */
  title: string;
  group: StatGroup;
  align: "start" | "center" | "end";
  /**
   * Whether the first press sorts it **descending** — which is what a reader
   * means by pressing a figure column, and the opposite of what they mean by
   * pressing a name.
   */
  numeric: boolean;
  /**
   * Whether the head over it is a sort key.
   *
   * The tray's is the only one that is not: it heads a column of controls
   * rather than of readings, and there is nothing to order a board by. A field
   * rather than a test on the key, so the head renders a `<button>` or a blank
   * without the component having to know which column is the odd one.
   */
  sortable: boolean;
  /**
   * Where this column sticks, or null for one that scrolls.
   *
   * On the column rather than derived at the call site, which is this list's
   * own rule: the offsets below are summed from the run, so a column inserted
   * into the pinned tail moves every offset after it with no edit.
   */
  pinned: "left" | "right" | null;
  /** This column's grid track, and the reason there is one list — see below. */
  width: string;
};

/**
 * The board's columns, in order.
 *
 * **One list, and the grid template is generated from it.** A second list of
 * track widths beside this one is a column that lands in the wrong track the
 * first time somebody inserts one — every cell after it shifted a place, with
 * nothing failing and every figure under the wrong head. The group header's
 * spans are read off the `group` runs for the same reason, which is the tool
 * tray's own "a run rather than a key" reading one component over.
 */
export const STAT_COLUMNS: readonly StatColumn[] = [
  // **The one flexible track, and it has to be one.** Every other column is a
  // figure whose width is its widest reading, so a fixed set sums to a fixed
  // number and leaves whatever the case is wider than that as dead space at
  // the *end* of the row — where the pinned tail would sit short of the row's
  // own right edge with its rounded corner and its edge cast stranded in
  // mid-row. `1fr` hands that slack to the name, which is the column that can
  // use it; at or below the grid's min-width it resolves to the 14rem floor,
  // so the narrow arm is unchanged. No spaces inside it: the template is split
  // on them to check that there is one track per column.
  { key: "name", label: "Player", title: "Player", group: null, align: "start", numeric: false, sortable: true, pinned: "left", width: "minmax(14rem,1fr)" },
  { key: "position", label: "Pos", title: "Position", group: null, align: "center", numeric: false, sortable: true, pinned: null, width: "3.5rem" },
  { key: "team", label: "Tm", title: "Team", group: null, align: "center", numeric: false, sortable: true, pinned: null, width: "3.5rem" },
  { key: "opponent", label: "Opp", title: "Opponent", group: null, align: "center", numeric: false, sortable: true, pinned: null, width: "4rem" },
  { key: "clock", label: "Game", title: "Game clock", group: null, align: "end", numeric: false, sortable: true, pinned: null, width: "6rem" },
  { key: "pass_yd", label: "Yds", title: "Passing yards", group: "Passing", align: "end", numeric: true, sortable: true, pinned: null, width: "4.25rem" },
  { key: "pass_td", label: "TD", title: "Passing touchdowns", group: "Passing", align: "end", numeric: true, sortable: true, pinned: null, width: "3.25rem" },
  { key: "pass_int", label: "Int", title: "Interceptions", group: "Passing", align: "end", numeric: true, sortable: true, pinned: null, width: "3.25rem" },
  { key: "rush_yd", label: "Yds", title: "Rushing yards", group: "Rushing", align: "end", numeric: true, sortable: true, pinned: null, width: "4.25rem" },
  { key: "rush_td", label: "TD", title: "Rushing touchdowns", group: "Rushing", align: "end", numeric: true, sortable: true, pinned: null, width: "3.25rem" },
  { key: "rec", label: "Rec", title: "Receptions", group: "Receiving", align: "end", numeric: true, sortable: true, pinned: null, width: "3.25rem" },
  { key: "rec_yd", label: "Yds", title: "Receiving yards", group: "Receiving", align: "end", numeric: true, sortable: true, pinned: null, width: "4.25rem" },
  { key: "rec_td", label: "TD", title: "Receiving touchdowns", group: "Receiving", align: "end", numeric: true, sortable: true, pinned: null, width: "3.25rem" },
  { key: "fumbles_lost", label: "Fum", title: "Fumbles lost", group: null, align: "end", numeric: true, sortable: true, pinned: null, width: "3.25rem" },
  // **The four are `3.25rem`, not `SHARES_COLUMN_WIDTHS`' `4.75rem`**, and the
  // difference is the trailing percentage. That width is sized for `7/12`
  // *plus* a `58%` beside it; the percentage comes off here — the bar states
  // the denominator once, and four percentages on every row of a nineteen
  // column table is the column the board cannot spare — so `3.25rem` is what
  // `n/12` alone needs. They move together, on `shares-columns.ts`' own rule:
  // they are one reading split four ways, and a cell a quarter-rem narrower
  // than the one beside it reads as a different kind of number.
  { key: "start", label: "Start", title: "Leagues you started him in", group: "My leagues", align: "end", numeric: true, sortable: true, pinned: "right", width: "3.25rem" },
  { key: "bench", label: "Bench", title: "Leagues you benched him in", group: "My leagues", align: "end", numeric: true, sortable: true, pinned: "right", width: "3.25rem" },
  { key: "opp-start", label: "Opp st", title: "Leagues an opponent started him in", group: "My leagues", align: "end", numeric: true, sortable: true, pinned: "right", width: "3.25rem" },
  { key: "opp-bench", label: "Opp bn", title: "Leagues an opponent benched him in", group: "My leagues", align: "end", numeric: true, sortable: true, pinned: "right", width: "3.25rem" },
  { key: "points", label: "Pts", title: "Fantasy points", group: "Total", align: "end", numeric: true, sortable: true, pinned: "right", width: "5.25rem" },
  // The row's own tray key. A track rather than something tucked inside the
  // Pts cell, so the header reserves its width and the two stay in step — a
  // key laid out by the row alone would drift the moment either changed.
  { key: "tray", label: "", title: "", group: "Total", align: "end", numeric: true, sortable: false, pinned: "right", width: "2rem" },
];

/** The sortable columns by key — what a head press and the order both read. */
const STAT_COLUMN_BY_KEY: ReadonlyMap<StatSortKey, SortableStatColumn> = new Map(
  STAT_COLUMNS.filter(
    (column): column is SortableStatColumn => column.sortable,
  ).map((column) => [column.key, column]),
);
const POINTS_COLUMN = STAT_COLUMN_BY_KEY.get("points")!;

/** The grid's tracks, generated from the one list above. */
export const STAT_GRID_TEMPLATE = STAT_COLUMNS.map((column) => column.width).join(" ");

/**
 * The four league columns, in the order the panel offers them.
 *
 * Derived from the one list rather than written again — which is also what
 * ties them to {@link WEEK_READINGS}: they are the same four readings in the
 * same order, and `share-columns match the readings` in the test beside this
 * is what says so out loud.
 */
export const SHARE_COLUMNS: readonly StatColumn[] = STAT_COLUMNS.filter(
  (column) => column.group === "My leagues",
);

/**
 * Which of the four is the reader's own side, and which is the quieter half of
 * its pair.
 *
 * `mine` decides two things a cell cannot work out for itself: which
 * denominator it is scaled by — the opposing one is legitimately lower, since
 * a future week, an unpaired week and an unstored opponent roster all leave a
 * league out of it — and which way the tray's dot is drawn.
 *
 * `quiet` is `Cell`'s own rule one panel over: the benched figure is a step
 * quieter than the started one, because which of the two a reader is after is
 * the whole of what these columns are for, and two lit columns side by side
 * say neither is.
 */
export const SHARE_READING: Record<
  ShareColumnKey,
  { mine: boolean; quiet: boolean; phone: string }
> = {
  start: { mine: true, quiet: false, phone: "St" },
  bench: { mine: true, quiet: true, phone: "Bn" },
  "opp-start": { mine: false, quiet: false, phone: "Opp st" },
  "opp-bench": { mine: false, quiet: true, phone: "Opp bn" },
};

/** Whether that key names one of the four — the narrowing type guard. */
export function isShareColumn(key: StatSortKey): key is ShareColumnKey {
  return key in SHARE_READING;
}

/**
 * How far each pinned column sits from the grid's right edge, in `rem`.
 *
 * **Summed from the list rather than written down**, which is the only way six
 * offsets stay right: each is the total width of the pinned columns after it,
 * so inserting one into the tail moves every offset before it with no edit. A
 * hand-kept table is six numbers that are all wrong the first time a width
 * moves, and what a wrong one looks like is two cells stacked on each other
 * with the figure underneath showing through.
 *
 * A grid demands them: six cells that all said `right: 0` would pile up at the
 * same edge. The alternative — one cell spanning the six tracks with a flex
 * row inside — is what the design prototype draws, and it costs the four new
 * columns their own `role="cell"`, which is the one thing this table's
 * semantics note says it will not give up.
 */
export const STAT_PINNED_RIGHT: ReadonlyMap<StatColumnKey, string> = (() => {
  const offsets = new Map<StatColumnKey, string>();
  let after = 0;
  for (const column of [...STAT_COLUMNS].reverse()) {
    if (column.pinned !== "right") continue;
    offsets.set(column.key, `${after}rem`);
    after += rem(column.width);
  }
  return offsets;
})();

/**
 * A track's width in `rem`, for the two sums below.
 *
 * Every fixed track is a plain `<n>rem` and the one flexible track is the
 * name's `minmax(14rem,1fr)`, whose floor is what a sum wants — so the parse
 * reads the first number it finds and the test beside this pins that every
 * width is one of those two shapes.
 */
function rem(width: string): number {
  return Number.parseFloat(width.replace(/^[^0-9.]*/, ""));
}

/**
 * What the grid cannot be narrower than, summed from the tracks.
 *
 * Generated rather than the design's own `81.5rem`, which counts the four
 * share columns and not the tray key beside them: at 81.5 the name column
 * would be asked to give up the missing 2rem, and it cannot, because its floor
 * is 14. So the figure is inert at best and the honest one is free.
 */
export const STAT_GRID_MIN = `${STAT_COLUMNS.reduce(
  (total, column) => total + rem(column.width),
  0,
)}rem`;

/** The board's default order: the week's best first. */
export const DEFAULT_STAT_SORT: StatSortKey = "points";

/** One span of the group header — a run of columns naming the same group. */
export type StatGroupSpan = {
  group: StatGroup;
  span: number;
  /** Where the span sticks, taken from the columns under it. */
  pinned: "left" | "right" | null;
  /** Its offset from that edge — its **leftmost** column's, for a right pin. */
  offset: string | null;
};

/**
 * The header's first row, as runs rather than as a written-down table.
 *
 * A group is read as a *run*, so a span is cut wherever the value changes —
 * which is what keeps the header and the columns from ever disagreeing about
 * how many tracks `Passing` covers.
 *
 * **And a run is cut where the *pin* changes too, which is a correctness rule
 * rather than a tidiness.** A pinned span's cell is `position: sticky`, and a
 * sticky cell keeps its own width — so one that covered unpinned columns
 * beside it would slide across the group labels as the table scrolled
 * sideways, covering `Passing` and `Rushing` with a blank block. It used to be
 * spelled as a special case for the first column, which was the only place it
 * could arise; with a pinned tail of six it is the general rule, and stating it
 * that way is what makes `My leagues` and `Total` stick without being told to.
 *
 * **A right-pinned span takes its *rightmost* column's offset**, which is the
 * one thing here that reads backwards and is forced by what `right` means: it
 * positions an element's right edge, so a span covering `Pts` and the tray key
 * sits at the tray key's own `0` and reaches leftward across both. Given the
 * leftmost instead — the run's own first column, which is the tempting one —
 * `My leagues` renders 156px inboard of where it belongs, leaving a gap beside
 * `Total` and painting itself over `Receiving`. Measured on a 1280 render,
 * which is what caught it.
 */
export function statGroupSpans(columns: readonly StatColumn[] = STAT_COLUMNS): StatGroupSpan[] {
  const spans: StatGroupSpan[] = [];
  for (const [i, column] of columns.entries()) {
    const last = spans[spans.length - 1];
    const offset = column.pinned === null ? null : (STAT_PINNED_RIGHT.get(column.key) ?? "0rem");
    if (i > 0 && last && last.group === column.group && last.pinned === column.pinned) {
      last.span += 1;
      // Every further column of a right-pinned run moves the span's own edge
      // inward, so the last one seen — the rightmost — is the one that stands.
      if (column.pinned === "right") last.offset = offset;
    } else {
      spans.push({
        group: column.group,
        span: 1,
        pinned: column.pinned,
        offset: column.pinned === "left" ? "0rem" : offset,
      });
    }
  }
  return spans;
}

/**
 * What the phone's Sort menu offers, in place of a header a 390px pane has
 * nowhere to put.
 *
 * A subset rather than all fifteen: the six a reader actually reorders a phone
 * board by, and every one of them is a real column, so the two controls cannot
 * come to name different orderings.
 */
export const PHONE_SORTS: readonly StatSortKey[] = [
  "points",
  "pass_yd",
  "rush_yd",
  "rec",
  "rec_yd",
  // **The four join the menu**, because the phone's Sort control stands in for
  // a header the pane has nowhere to put — and with the merge, four of the
  // columns it stands in for are the reader's own. A board a reader cannot
  // order by "who I started most" on a phone is a merge that only landed at
  // one width.
  ...WEEK_READINGS,
  "name",
];

/**
 * What the Sort menu calls each — the column's own label, qualified by group.
 *
 * The four league columns are the exception, and it is a width rather than a
 * rule: their heads are cut to `Opp st` and `Opp bn` to fit a 3.25rem track,
 * and a menu has room to say what those mean. So the menu spells them out
 * where the head cannot — the same split `READING_CHIP` and `READING_LABEL`
 * already draw one panel over.
 */
const SHARE_SORT_LABEL: Record<ShareColumnKey, string> = {
  start: "Started",
  bench: "Benched",
  "opp-start": "Opp started",
  "opp-bench": "Opp benched",
};

export function sortLabel(key: StatSortKey): string {
  const column = STAT_COLUMN_BY_KEY.get(key);
  if (!column) return key;
  if (isShareColumn(key)) return SHARE_SORT_LABEL[key];
  if (column.group === "Passing") return `Pass ${column.label.toLowerCase()}`;
  if (column.group === "Rushing") return `Rush ${column.label.toLowerCase()}`;
  if (column.group === "Receiving" && column.key !== "rec") {
    return `Rec ${column.label.toLowerCase()}`;
  }
  return column.label;
}
