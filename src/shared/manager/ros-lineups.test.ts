import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { solveLeagueLineup } from "./ros-lineups.ts";
import type { RosLineupLeague } from "./ros-lineups.ts";
import type { RosProjections } from "../projections/ros.ts";

/** A 2-team league starting QB/RB/FLEX, so pools and seats stay countable. */
function league(players: string[], overrides: Partial<RosLineupLeague> = {}): RosLineupLeague {
  return {
    league_id: "L1",
    total_rosters: 2,
    roster_positions: ["QB", "RB", "FLEX", "BN"],
    scoring_settings: { rec: 1, rec_yd: 0.1 },
    players,
    ...overrides,
  };
}

function projected(
  id: string,
  positions: string[],
  stats: Record<string, number>,
): RosProjections[string] {
  return { player_id: id, stats, weeks: [1, 2], name: `Name ${id}`, positions };
}

function unprojected(id: string, positions: string[]): RosProjections[string] {
  return { player_id: id, stats: {}, weeks: [], name: `Name ${id}`, positions };
}

const NO_ADP = new Map<string, number>();

describe("solveLeagueLineup", () => {
  test("seats by projected points under the league's own scoring", () => {
    const board: RosProjections = {
      wr1: projected("wr1", ["WR"], { rec: 10, rec_yd: 100 }), // 20 pts
      wr2: projected("wr2", ["WR"], { rec: 5, rec_yd: 50 }), // 10 pts
      qb: projected("qb", ["QB"], { rec: 1 }), // 1 pt
      rb: projected("rb", ["RB"], { rec: 2 }), // 2 pts
    };
    const result = solveLeagueLineup(league(["qb", "rb", "wr1", "wr2"]), board, NO_ADP);

    assert.deepEqual(
      result.starters.map((s) => [s.slot, s.player?.player_id]),
      [
        ["QB", "qb"],
        ["RB", "rb"],
        ["FLEX", "wr1"],
      ],
    );
    assert.deepEqual(
      result.bench.map((p) => p.player_id),
      ["wr2"],
    );
    assert.equal(result.projected_points, 23);
  });

  test("an unprojected player carries null points, never zero", () => {
    const board: RosProjections = { rb: unprojected("rb", ["RB"]) };
    const result = solveLeagueLineup(league(["rb"]), board, NO_ADP);
    const rb = result.starters.find((s) => s.slot === "RB")!.player!;
    assert.equal(rb.points, null);
    assert.equal(result.projected_points, 0);
  });

  test("draft capital decides only where projections say nothing", () => {
    // Two unprojected RBs: the earlier pick starts. A projected third RB with a
    // tiny score still outranks both for the other seat — one projected point
    // must never be outbid by any amount of draft capital.
    const board: RosProjections = {
      early: unprojected("early", ["RB"]),
      late: unprojected("late", ["RB"]),
      proj: projected("proj", ["RB"], { rec: 0.5 }), // 0.5 pts
    };
    const adp = new Map([
      ["early", 1],
      ["late", 30],
    ]);
    const result = solveLeagueLineup(
      league(["early", "late", "proj"], { roster_positions: ["RB", "FLEX", "BN"] }),
      board,
      adp,
    );

    assert.deepEqual(
      result.starters.map((s) => [s.slot, s.player?.player_id]),
      [
        ["RB", "proj"],
        ["FLEX", "early"],
      ],
    );
    assert.deepEqual(
      result.bench.map((p) => p.player_id),
      ["late"],
    );
  });

  test("with no projections at all the whole solve runs on draft capital", () => {
    const result = solveLeagueLineup(
      league(["a", "b"], { roster_positions: ["FLEX", "BN"] }),
      {
        a: unprojected("a", ["WR"]),
        b: unprojected("b", ["WR"]),
      },
      new Map([
        ["a", 40],
        ["b", 2],
      ]),
    );
    assert.equal(result.starters[0].player?.player_id, "b");
    assert.equal(result.projected_points, 0);
  });

  test("the payload carries real values, not the composite score", () => {
    const result = solveLeagueLineup(
      league(["a"], { roster_positions: ["FLEX", "BN"] }),
      { a: unprojected("a", ["WR"]) },
      new Map([["a", 1]]),
    );
    const seated = result.starters[0].player!;
    // adp 1 is the peak; the tiebreak epsilon must not leak into either field.
    assert.equal(seated.points, null);
    assert.equal(seated.adp_value, 10_000);
  });

  test("a player the feed doesn't know rides the bench with nothing to say", () => {
    const result = solveLeagueLineup(
      league(["ghost", "wr"], { roster_positions: ["FLEX", "BN"] }),
      { wr: projected("wr", ["WR"], { rec: 1 }) },
      NO_ADP,
    );
    assert.equal(result.starters[0].player?.player_id, "wr");
    const ghost = result.bench[0];
    assert.equal(ghost.player_id, "ghost");
    assert.equal(ghost.name, null);
    assert.deepEqual(ghost.positions, []);
    assert.equal(ghost.points, null);
  });

  test("padded roster entries are not players and unknown slots are named", () => {
    const result = solveLeagueLineup(
      league(["wr", "wr", "0", ""], { roster_positions: ["FLEX", "OP", "BN"] }),
      { wr: projected("wr", ["WR"], { rec: 1 }) },
      NO_ADP,
    );
    assert.equal(result.starters.length, 1);
    assert.deepEqual(result.unknown_slots, ["OP"]);
    assert.deepEqual(result.bench, []);
  });

  test("bench orders by the same key the solver seated by", () => {
    const board: RosProjections = {
      s1: projected("s1", ["WR"], { rec: 9 }),
      b1: projected("b1", ["WR"], { rec: 5 }),
      b2: unprojected("b2", ["WR"]),
      b3: unprojected("b3", ["WR"]),
    };
    const result = solveLeagueLineup(
      league(["b3", "b2", "b1", "s1"], { roster_positions: ["FLEX", "BN"] }),
      board,
      new Map([
        ["b2", 5],
        ["b3", 90],
      ]),
    );
    assert.deepEqual(
      result.bench.map((p) => p.player_id),
      ["b1", "b2", "b3"],
    );
  });
});
