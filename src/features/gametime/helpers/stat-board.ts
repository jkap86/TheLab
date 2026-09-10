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
): StatRow[] {
  return Object.values(lines).map((line) => {
    const game = line.team ? (board[line.team] ?? null) : null;
    return {
      ...line,
      opponent: game?.opponent ? (game.home ? game.opponent : `@${game.opponent}`) : null,
      clock: gameClockLabel(game),
      points: statPoints(line, basis),
    };
  });
}

/** What the caps offer, and what "not asked" is called. */
export type PositionFilter = StatBoardPosition | "ALL";

/** The three narrowings, which are one AND. */
export type StatBoardFilters = {
  query: string;
  position: PositionFilter;
  team: string;
};

export const NO_STAT_FILTERS: StatBoardFilters = { query: "", position: "ALL", team: "ALL" };

/** Whether anything is narrowing — what lights the Reset key. */
export function statFiltersActive(filters: StatBoardFilters): boolean {
  return (
    filters.query.trim() !== "" || filters.position !== "ALL" || filters.team !== "ALL"
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
 */
export function narrowStatRows(
  rows: readonly StatRow[],
  filters: StatBoardFilters,
): StatRow[] {
  const query = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.position === "ALL" || row.position === filters.position) &&
      (filters.team === "ALL" || row.team === filters.team) &&
      (query === "" || (row.name ?? "").toLowerCase().includes(query)),
  );
}

/** Which column a board is ordered by — every column is one. */
export type StatSortKey = StatColumn["key"];

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
 * **An absent value sorts last in either direction**, which is the shares
 * columns' own rule and is right for the same reason: a player with no clock
 * is not the earliest kickoff of the week, and flipping the arrow must not
 * make him one. Only the text columns can be absent — every figure is a real
 * count, and every row has a points total.
 *
 * **Ties break on the name, ascending, whichever way the column runs.** A
 * points column has a great many of them, and stable-sort order over a record
 * is the order the ids happened to arrive in — a board that reshuffled its
 * equal rows between frames with nothing on screen having changed.
 */
function compare(a: StatRow, b: StatRow, column: StatColumn, direction: 1 | -1): number {
  if (column.numeric) {
    const gap = (a[column.key] as number) - (b[column.key] as number);
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

/** Which of the three stat groups a column belongs to, or none. */
export type StatGroup = "Passing" | "Rushing" | "Receiving" | "Total" | null;

/** One column of the desktop grid. */
export type StatColumn = {
  key:
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
    | "points";
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
  // figure whose width is its widest reading, so a fixed set of fifteen sums
  // to 68.5rem and leaves whatever the case is wider than that as dead space
  // at the *end* of the row — where the pinned Pts cell would sit short of the
  // row's own right edge with its rounded corner and its edge cast stranded in
  // mid-row. `1fr` hands that slack to the name, which is the column that can
  // use it; at or below the grid's min-width it resolves to the 14rem floor,
  // so the narrow arm is unchanged. No spaces inside it: the template is split
  // on them to check that there is one track per column.
  { key: "name", label: "Player", title: "Player", group: null, align: "start", numeric: false, width: "minmax(14rem,1fr)" },
  { key: "position", label: "Pos", title: "Position", group: null, align: "center", numeric: false, width: "3.5rem" },
  { key: "team", label: "Tm", title: "Team", group: null, align: "center", numeric: false, width: "3.5rem" },
  { key: "opponent", label: "Opp", title: "Opponent", group: null, align: "center", numeric: false, width: "4rem" },
  { key: "clock", label: "Game", title: "Game clock", group: null, align: "end", numeric: false, width: "6rem" },
  { key: "pass_yd", label: "Yds", title: "Passing yards", group: "Passing", align: "end", numeric: true, width: "4.25rem" },
  { key: "pass_td", label: "TD", title: "Passing touchdowns", group: "Passing", align: "end", numeric: true, width: "3.25rem" },
  { key: "pass_int", label: "Int", title: "Interceptions", group: "Passing", align: "end", numeric: true, width: "3.25rem" },
  { key: "rush_yd", label: "Yds", title: "Rushing yards", group: "Rushing", align: "end", numeric: true, width: "4.25rem" },
  { key: "rush_td", label: "TD", title: "Rushing touchdowns", group: "Rushing", align: "end", numeric: true, width: "3.25rem" },
  { key: "rec", label: "Rec", title: "Receptions", group: "Receiving", align: "end", numeric: true, width: "3.25rem" },
  { key: "rec_yd", label: "Yds", title: "Receiving yards", group: "Receiving", align: "end", numeric: true, width: "4.25rem" },
  { key: "rec_td", label: "TD", title: "Receiving touchdowns", group: "Receiving", align: "end", numeric: true, width: "3.25rem" },
  { key: "fumbles_lost", label: "Fum", title: "Fumbles lost", group: null, align: "end", numeric: true, width: "3.25rem" },
  { key: "points", label: "Pts", title: "Fantasy points", group: "Total", align: "end", numeric: true, width: "5.25rem" },
];

const STAT_COLUMN_BY_KEY = new Map(STAT_COLUMNS.map((column) => [column.key, column]));
const POINTS_COLUMN = STAT_COLUMNS[STAT_COLUMNS.length - 1];

/** The grid's tracks, generated from the one list above. */
export const STAT_GRID_TEMPLATE = STAT_COLUMNS.map((column) => column.width).join(" ");

/** The board's default order: the week's best first. */
export const DEFAULT_STAT_SORT: StatSortKey = "points";

/** One span of the group header — a run of columns naming the same group. */
export type StatGroupSpan = { group: StatGroup; span: number };

/**
 * The header's first row, as runs rather than as a written-down table.
 *
 * A group is read as a *run*, so a span is cut wherever the value changes —
 * which is what keeps the header and the columns from ever disagreeing about
 * how many tracks `Passing` covers.
 *
 * **With one extra cut, after the first column, and it is a correctness rule
 * rather than a tidiness.** That column is pinned, so its header cell is
 * `position: sticky` — and a sticky cell keeps its own width, so one that
 * also covered the four unpinned columns beside it would slide across the
 * group labels as the table scrolled sideways, covering `Passing` and
 * `Rushing` with a blank block. The pinned column gets a span of its own and
 * the four beside it get theirs.
 */
export function statGroupSpans(columns: readonly StatColumn[] = STAT_COLUMNS): StatGroupSpan[] {
  const spans: StatGroupSpan[] = [];
  for (const [i, column] of columns.entries()) {
    const last = spans[spans.length - 1];
    if (i > 0 && last && last.group === column.group && i !== 1) last.span += 1;
    else spans.push({ group: column.group, span: 1 });
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
  "name",
];

/** What the Sort menu calls each — the column's own label, qualified by group. */
export function sortLabel(key: StatSortKey): string {
  const column = STAT_COLUMN_BY_KEY.get(key);
  if (!column) return key;
  if (column.group === "Passing") return `Pass ${column.label.toLowerCase()}`;
  if (column.group === "Rushing") return `Rush ${column.label.toLowerCase()}`;
  if (column.group === "Receiving" && column.key !== "rec") {
    return `Rec ${column.label.toLowerCase()}`;
  }
  return column.label;
}
