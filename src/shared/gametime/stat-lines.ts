/**
 * The week's stat board, folded off the stats feed: every skill player who
 * registered something, and what he registered.
 *
 * The gametime page's second reading, and the one that is not about the
 * account at all. Its cards say what *your* lineups are doing and the two
 * Browse panels say which of your leagues a player is in; neither says what
 * any given player actually **did** this week, which is a fact about the NFL
 * rather than about anybody's roster. So it is folded once per week, rides
 * beside `board` rather than inside `leagues`, and is the same answer for
 * every reader of that week.
 *
 * Pure and free of runtime imports, on `./live-rules`' terms and for its
 * reason: `./feeds` reads Sleeper and `./payload` reaches the solver, neither
 * of which resolves under Node's own runner, and every judgement below renders
 * a perfectly ordinary board while being wrong.
 *
 * **It reads the *stats* board, never the projections one.** Both are folded
 * by `assembleWeekProjections` into the same shape, and handing this the wrong
 * one produces a full, plausible, entirely fictional week — the projections
 * feed carries a row for every player in the league whether or not a ball has
 * been snapped.
 */

import type { GametimeStatLine, StatBoardPosition } from "../contract/gametime.ts";
import type { WeekProjections } from "../projections/week.ts";

/**
 * The positions the board has columns for, in the order its caps offer them.
 *
 * Also the *filter*: a player whose `fantasy_positions` name none of these is
 * not on the board. See {@link StatBoardPosition} for why the vocabulary stops
 * where it does.
 */
export const STAT_BOARD_POSITIONS: readonly StatBoardPosition[] = ["QB", "RB", "WR", "TE"];

const BOARD_POSITION = new Set<string>(STAT_BOARD_POSITIONS);

/**
 * The nine Sleeper stat keys a row is built from, in the board's own column
 * order, paired with the field each fills.
 *
 * Named once rather than nine times: the fold reads them, the "did he do
 * anything" test walks them, and a key misspelled in one place and not the
 * other is a column that is silently always empty.
 */
const STAT_FIELDS = [
  ["pass_yd", "pass_yd"],
  ["pass_td", "pass_td"],
  ["pass_int", "pass_int"],
  ["rush_yd", "rush_yd"],
  ["rush_td", "rush_td"],
  ["rec", "rec"],
  ["rec_yd", "rec_yd"],
  ["rec_td", "rec_td"],
  ["fum_lost", "fumbles_lost"],
] as const satisfies readonly (readonly [string, keyof GametimeStatLine])[];

/**
 * Fold one week's stat lines into the board.
 *
 * Null in (a stats feed nobody could read) is an **empty board** out, which is
 * the honest answer: no row is a claim that a player did nothing, and the
 * payload's own `stats: "error"` is what says why the board is bare.
 *
 * Three rules decide which rows exist, and each is silent when it is wrong.
 *
 * **A published line, and only a published line.** `stats === null` is the
 * fold's own "no game this week" — a bye, or a player the feed has nothing for
 * — and reading its absent map as nine zeroes would seat every rostered
 * player in the league on a board of dashes.
 *
 * **A position the board has columns for**, which is the vocabulary above. The
 * first of a player's `fantasy_positions` that names one wins, because Sleeper
 * lists the primary first and a dual-eligible player belongs under the
 * position a reader would look for him at.
 *
 * **And something to show.** A skill player who was active and never touched
 * the ball has a published line and nine zeroes, which is a row of nine em
 * dashes and a `0.0` — no column can say anything about him, so the row
 * carries no reading at all. Two things go wrong if he is kept, and the second
 * is the one that matters: the bar's `Players` count stops being a count of
 * the week and becomes a count of the league's active rosters; and the ramp
 * behind every figure is `sharePercentile`, which is anchored **on the mean**
 * — so a few hundred zeroes drag that mean toward the floor and paint every
 * ordinary afternoon as a career day. A colour that says "this is a lot" is
 * only worth printing against an honest middle.
 *
 * Note what that rule is *not*: it is not "he scored points". A fumble lost
 * and nothing else is a real, and negative, week, and it keeps its row.
 */
export function statBoardLines(
  stats: WeekProjections | null,
): Record<string, GametimeStatLine> {
  const board: Record<string, GametimeStatLine> = {};
  if (!stats) return board;

  for (const player of Object.values(stats)) {
    const line = player.stats;
    if (!line) continue;

    const position = boardPosition(player.positions);
    if (position === null) continue;

    const row: GametimeStatLine = {
      player_id: player.player_id,
      name: player.name,
      position,
      team: player.team,
      pass_yd: 0,
      pass_td: 0,
      pass_int: 0,
      rush_yd: 0,
      rush_td: 0,
      rec: 0,
      rec_yd: 0,
      rec_td: 0,
      fumbles_lost: 0,
    };

    let played = false;
    for (const [key, field] of STAT_FIELDS) {
      const value = statNumber(line[key]);
      if (value === 0) continue;
      row[field] = value;
      played = true;
    }
    if (!played) continue;

    board[player.player_id] = row;
  }

  return board;
}

/** The board's own position for a player, or null where he has none of them. */
export function boardPosition(
  positions: readonly string[],
): StatBoardPosition | null {
  for (const position of positions) {
    if (BOARD_POSITION.has(position)) return position as StatBoardPosition;
  }
  return null;
}

/**
 * One stat, read defensively and rounded to the whole number the column shows.
 *
 * The map is untyped JSON from an undocumented host, so anything that is not a
 * finite number is nothing. Rounded because Sleeper carries fractional yardage
 * on some keys and a column headed `Yds` showing `148.3` is a rushing total
 * nobody recognises — the *scoring* is not done from these, so nothing depends
 * on the hundredths.
 */
function statNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}
