import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { boardPosition, statBoardLines } from "./stat-lines.ts";
import type { WeekProjections } from "../projections/week.ts";

/**
 * Which rows the stat board has, and what is on them.
 *
 * Every rule here renders a perfectly ordinary board when it is wrong — a
 * plausible name against a plausible number is the one failure this whole
 * reading cannot have — so each is driven rather than argued.
 */

type Line = Record<string, number> | null;

function week(
  players: readonly (readonly [string, Line, string[], string | null])[],
): WeekProjections {
  const board: WeekProjections = {};
  for (const [id, stats, positions, team] of players) {
    board[id] = {
      player_id: id,
      stats,
      name: `Player ${id}`,
      positions: [...positions],
      team,
      game_date: "2026-09-13",
    };
  }
  return board;
}

const CHASE: Line = { rec: 11, rec_yd: 148, rec_td: 2 };

describe("statBoardLines", () => {
  test("a published line becomes a row, with every figure filled in", () => {
    const board = statBoardLines(week([["1", CHASE, ["WR"], "CIN"]]));
    assert.deepEqual(board["1"], {
      player_id: "1",
      name: "Player 1",
      position: "WR",
      team: "CIN",
      pass_yd: 0,
      pass_td: 0,
      pass_int: 0,
      rush_yd: 0,
      rush_td: 0,
      rec: 11,
      rec_yd: 148,
      rec_td: 2,
      fumbles_lost: 0,
    });
  });

  test("a feed nobody could read is an empty board, never a board of zeroes", () => {
    // The payload's own `stats: "error"` is what says why it is bare; a row
    // per player would be a claim that each of them did nothing.
    assert.deepEqual(statBoardLines(null), {});
  });

  test("a player with no published line has no row", () => {
    // `stats: null` is the fold's "no game this week" — a bye, or a player
    // the feed has nothing for. Read as nine zeroes it would seat every
    // rostered player in the league on a board of dashes.
    const board = statBoardLines(week([["1", null, ["RB"], "ATL"]]));
    assert.deepEqual(board, {});
  });

  test("a player who did nothing at all has no row", () => {
    // Nine em dashes and a 0.0 is a row with no reading on it — and, worse,
    // a few hundred of them drag `sharePercentile`'s mean to the floor and
    // paint every ordinary afternoon as a career day.
    const board = statBoardLines(week([["1", { rec_tgt: 3, off_snp: 40 }, ["WR"], "CIN"]]));
    assert.deepEqual(board, {});
  });

  test("a lost fumble and nothing else is still a week", () => {
    // The rule is "something to show", not "he scored points": this is a
    // real, and negative, afternoon.
    const board = statBoardLines(week([["1", { fum_lost: 1 }, ["RB"], "NYJ"]]));
    assert.equal(board["1"]?.fumbles_lost, 1);
  });

  test("a position the board has no column for is not on it", () => {
    const board = statBoardLines(
      week([
        ["k", { fgm: 3 }, ["K"], "BUF"],
        ["d", { def_td: 1 }, ["DEF"], "PHI"],
        ["lb", { tkl: 9 }, ["LB"], "SF"],
        ["wr", CHASE, ["WR"], "CIN"],
      ]),
    );
    assert.deepEqual(Object.keys(board), ["wr"]);
  });

  test("a dual-eligible player takes the first position Sleeper lists", () => {
    // The primary is first, and it is where a reader looks for him.
    const board = statBoardLines(week([["1", { rush_yd: 40, rec: 4, rec_yd: 31 }, ["RB", "WR"], "SF"]]));
    assert.equal(board["1"]?.position, "RB");
  });

  test("a team the feed did not name still gets its row", () => {
    // He printed his figures; his opponent and his clock are what read as
    // dashes, because those are the two the board joins through his team.
    const board = statBoardLines(week([["1", CHASE, ["WR"], null]]));
    assert.equal(board["1"]?.team, null);
    assert.equal(board["1"]?.rec_yd, 148);
  });

  test("a stat that is not a finite number is nothing", () => {
    const board = statBoardLines(
      week([["1", { rec: 4, rec_yd: Number.NaN, rec_td: 1 } as Line, ["TE"], "LV"]]),
    );
    assert.equal(board["1"]?.rec_yd, 0);
    assert.equal(board["1"]?.rec, 4);
  });

  test("a fractional yard is rounded to the figure the column shows", () => {
    const board = statBoardLines(week([["1", { rush_yd: 118.4 }, ["RB"], "ATL"]]));
    assert.equal(board["1"]?.rush_yd, 118);
  });
});

describe("boardPosition", () => {
  test("answers null where none of a player's positions is on the board", () => {
    assert.equal(boardPosition(["K"]), null);
    assert.equal(boardPosition([]), null);
    assert.equal(boardPosition(["DB", "LB"]), null);
  });

  test("finds a board position later in the list", () => {
    assert.equal(boardPosition(["DEF", "TE"]), "TE");
  });
});
