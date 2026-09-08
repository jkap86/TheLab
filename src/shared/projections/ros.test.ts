import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assembleRosProjections } from "./ros.ts";
import type { RosWeek } from "./ros.ts";
import type { SleeperProjection } from "../sleeper/types/sleeper.types.ts";

/** A feed row with only the fields the assembly reads filled in. */
function row(
  player_id: string,
  week: number,
  overrides: Partial<SleeperProjection> = {},
): SleeperProjection {
  return {
    player_id,
    season: "2026",
    week,
    season_type: "regular",
    category: "proj",
    company: null,
    team: null,
    opponent: null,
    game_id: `game-${week}`,
    date: "2026-09-13",
    last_modified: null,
    stats: { rec: 4, rec_yd: 50 },
    player: { first_name: "Test", last_name: "Player", fantasy_positions: ["WR"] },
    ...overrides,
  };
}

describe("assembleRosProjections", () => {
  test("sums real weeks and keeps which weeks contributed", () => {
    const weeks: RosWeek[] = [
      { week: 3, rows: [row("p1", 3)] },
      { week: 4, rows: [row("p1", 4, { stats: { rec: 6, rec_yd: 80 } })] },
    ];
    const board = assembleRosProjections(weeks);
    assert.deepEqual(board.p1.stats, { rec: 10, rec_yd: 130 });
    assert.deepEqual(board.p1.weeks, [3, 4]);
  });

  test("a null game_id row contributes identity but no stats", () => {
    // The feed's spelling of "no game this week": stats are ADP placeholders,
    // and folding them in would put draft metadata in a season total.
    const weeks: RosWeek[] = [
      {
        week: 3,
        rows: [
          row("p1", 3, { game_id: null, date: null, stats: { adp_dd_ppr: 40 } }),
        ],
      },
    ];
    const board = assembleRosProjections(weeks);
    assert.deepEqual(board.p1.stats, {});
    // Empty weeks is the "no projection at all" state the fallback keys off.
    assert.deepEqual(board.p1.weeks, []);
    assert.equal(board.p1.name, "Test Player");
    assert.deepEqual(board.p1.positions, ["WR"]);
  });

  test("identity is read defensively from untyped JSON", () => {
    const weeks: RosWeek[] = [
      {
        week: 1,
        rows: [
          row("junk", 1, {
            player: { first_name: 7, fantasy_positions: ["RB", 9], position: 3 },
          }),
          row("bare", 1, { player: null }),
          row("pos-only", 1, {
            player: { position: "K" },
          }),
        ],
      },
    ];
    const board = assembleRosProjections(weeks);
    assert.equal(board.junk.name, null);
    assert.deepEqual(board.junk.positions, ["RB"]);
    assert.equal(board.bare.name, null);
    assert.deepEqual(board.bare.positions, []);
    assert.deepEqual(board["pos-only"].positions, ["K"]);
  });

  test("a later week can supply the identity an earlier row lacked", () => {
    const weeks: RosWeek[] = [
      { week: 1, rows: [row("p1", 1, { player: null })] },
      { week: 2, rows: [row("p1", 2)] },
    ];
    const board = assembleRosProjections(weeks);
    assert.equal(board.p1.name, "Test Player");
    assert.deepEqual(board.p1.weeks, [1, 2]);
  });

  test("the team is the latest real projection's, and a no-game row leaves it null", () => {
    // A player traded mid-span is on his new team by the last week that
    // projects him — and it is the *week number* that decides, not the order
    // the weeks arrived in, so the fold stays a fact about the response.
    const weeks: RosWeek[] = [
      { week: 5, rows: [row("p1", 5, { team: "KC" })] },
      { week: 3, rows: [row("p1", 3, { team: "SF" })] },
      // Week 6 is a no-game row: it carries no team and must not clear KC.
      { week: 6, rows: [row("p1", 6, { game_id: null, stats: { adp_dd_ppr: 4 }, team: null })] },
    ];
    const board = assembleRosProjections(weeks);
    assert.equal(board.p1.team, "KC");
  });

  test("a player with no real projection has no team", () => {
    // Identity is read from any row, the team is not: a no-game row's `team`
    // is null on the feed anyway, and a team read off one would be a claim.
    const weeks: RosWeek[] = [
      { week: 3, rows: [row("p1", 3, { game_id: null, stats: { adp_dd_ppr: 4 }, team: "SF" })] },
    ];
    const board = assembleRosProjections(weeks);
    assert.equal(board.p1.team, null);
    assert.equal(board.p1.name, "Test Player");
  });

  test("rows without a player id are dropped whole", () => {
    const weeks: RosWeek[] = [
      {
        week: 1,
        rows: [
          row("", 1),
          { ...row("x", 1), player_id: undefined as unknown as string },
        ],
      },
    ];
    assert.deepEqual(assembleRosProjections(weeks), {});
  });
});
