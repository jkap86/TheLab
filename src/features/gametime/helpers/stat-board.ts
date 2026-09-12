/**
 * The Player Scores list's arithmetic: what a player's week is worth, which
 * rows a narrowing leaves, and what order they come in.
 *
 * Pure and under Node's own runner, for `seat-compare.ts`' and
 * `matchup-gauge.ts`' reason: a board sorted the wrong way, a rank that does
 * not renumber, or a zero scored as a figure all render a perfectly ordinary
 * list and say something untrue. The component beside this owns the surfaces
 * and nothing else.
 *
 * **The board is account-wide, so it prices itself.** Every other figure on
 * this page is scored through one league's own `scoring_settings`; a board
 * that spans a reader's leagues has no single league to ask, and picking one
 * would be a claim none of the others could support. So it states its basis
 * (`PPR`, `Half PPR`, `Standard`) on the bar and prices every row on it —
 * `figured()`'s own argument one reading over, where the panes are labelled
 * `Live` so nobody has to infer which of three scales they are on.
 *
 * **The box score is gone, and that is the redesign rather than a trim.** This
 * used to carry nineteen columns — passing, rushing and receiving splits, four
 * pinned league-share cells and a tray key — in a grid that could not be read
 * without scrolling sideways, so answering any one question meant travelling
 * past four others. What is left is the two a reader actually asks on a
 * Sunday: *who is scoring what*, which is one figure, and *where do I stand on
 * this guy*, which is the breakdown beside the list (`player-breakdown.ts`).
 * Points are the only stat figure now; the three counts are the bridge into
 * the second question.
 */

import type { GametimeGame, GametimeStatLine, StatBoardPosition } from "@/shared/contract";

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
   * The three counts the row carries, **null for a player nobody in the
   * reader's leagues holds, and never zero.**
   *
   * The distinction is the one thing about these three that is silent when it
   * is wrong. An absent tag says "not in your leagues" and a `0` says "in your
   * leagues, and this never happened" — which on these three is a real answer
   * rather than an absence, so it must not fall back to null. It is why
   * {@link compare} sorts a null last in either direction while sorting a zero
   * as a zero, and it is what floats a reader's own players to the top of a
   * four-hundred-row board the moment they press `Started`.
   */
  start: number | null;
  bench: number | null;
  /**
   * **One figure for both opposing readings**, which is this list's own call
   * rather than the fold's.
   *
   * The four counts partition the leagues he appears in, and the two on the
   * reader's own side are decisions *they* made — started him, sat him — where
   * the two opposite are one fact about somebody else's roster: he is on it.
   * Whether the manager across from you left him on their bench is a question
   * about their week rather than yours, and a nineteen-column board was the
   * only place there was room to ask it. So the row sums them and the
   * breakdown, which has room, still tells the two apart.
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

/** The four positions the Pos menu offers, in the order it draws them. */
export const STAT_POSITIONS: readonly StatBoardPosition[] = ["QB", "RB", "WR", "TE"];

/**
 * The three narrowings, which are one AND.
 *
 * **Both sets are multi-select and an empty set is "not asked" rather than
 * "nothing chosen"** — the rule `player-filters.ts` states in full one panel
 * over, and it is the arm that is silent when reversed: read the other way, a
 * player carrying a value that appeared after the reader last touched the menu
 * would quietly drop off the list.
 */
export type StatBoardFilters = {
  query: string;
  positions: readonly StatBoardPosition[];
  teams: readonly string[];
};

export const NO_STAT_FILTERS: StatBoardFilters = {
  query: "",
  positions: [],
  teams: [],
};

/** Whether anything is narrowing — what lights the Reset key. */
export function statFiltersActive(filters: StatBoardFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.positions.length > 0 ||
    filters.teams.length > 0
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
      (query === "" || (row.name ?? "").toLowerCase().includes(query)),
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
export type StatSortKey = "points" | "start" | "bench" | "against";

/** The caps, in the order the ledge draws them. */
export const STAT_SORTS: readonly { key: StatSortKey; label: string }[] = [
  { key: "points", label: "Pts" },
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
  if (key !== "points") {
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
export type StatTag = { key: StatSortKey; label: string; count: number };

/**
 * The tags a row carries, **built only from the counts he has a figure in**.
 *
 * A zero is omitted rather than drawn, which is the whole reason the cell fits
 * a 14rem track: a receiver started in nine leagues carries one tag, not three
 * with two noughts in them. The count is still *knowable* — the breakdown a
 * press opens names every league including the ones he is in neither side of
 * — so what an omitted tag costs is nothing a reader can only get here.
 *
 * A row nobody holds carries none, and the cell says so in words rather than
 * standing empty: `held` is what the component reads for that, never
 * `tags.length === 0`, because a held player the reader neither started, sat
 * nor faced would otherwise be labelled as one their leagues have never heard
 * of.
 */
export function statTags(row: StatRow): StatTag[] {
  const tags: StatTag[] = [];
  if (row.start) tags.push({ key: "start", label: "Started", count: row.start });
  if (row.bench) tags.push({ key: "bench", label: "Sat", count: row.bench });
  if (row.against) {
    tags.push({ key: "against", label: "Against", count: row.against });
  }
  return tags;
}

/**
 * The same three on one line, for the phone row — `6 st · 2 sat · 4 vs`.
 *
 * Short forms rather than the desktop's words, and it is a width: the line
 * they share already carries a position, a matchup and a clock, and `Started
 * 6 · Sat 2 · Against 4` is most of a 390px row on its own. The vocabulary is
 * the same three readings in the same order, so a reader who has pressed
 * `Started` on the caps above can see which figure moved.
 */
export function statTagLine(row: StatRow): string {
  return statTags(row)
    .map((tag) => `${tag.count} ${PHONE_TAG[tag.key]}`)
    .join(" · ");
}

/** Exhaustive over the sort keys; `points` is unreachable — see {@link statTags}. */
const PHONE_TAG: Record<StatSortKey, string> = {
  points: "pts",
  start: "st",
  bench: "sat",
  against: "vs",
};
