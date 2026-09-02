import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LeagueLineup } from "@/shared/contract";

import { lineupMetricTotals, rankLeagueLineups } from "./league-ranks.ts";
import type { LeagueRosterRow, RankLeague } from "./league-ranks.ts";
import type { RosProjections } from "../projections/ros.ts";

/** A one-starter league, so a roster's total is its best player's points. */
function league(
  rosters: readonly LeagueRosterRow[],
  overrides: Partial<RankLeague> = {},
): RankLeague {
  return {
    league_id: "L1",
    total_rosters: rosters.length,
    roster_positions: ["FLEX", "BN"],
    scoring_settings: { rec: 1 },
    rosters,
    ...overrides,
  };
}

function roster(
  roster_id: number,
  owner_id: string | null,
  players: string[],
): LeagueRosterRow {
  return { roster_id, owner_id, players };
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
const NO_PROJECTIONS: RosProjections = {};

describe("lineupMetricTotals", () => {
  test("sums each lens off one lineup, counting nulls as zero", () => {
    const lineup: LeagueLineup = {
      league_id: "L1",
      starters: [
        {
          slot: "FLEX",
          player: {
            player_id: "a",
            name: null,
            positions: ["WR"],
            points: 7.5,
            adp_value: 100,
          },
        },
        { slot: "QB", player: null },
      ],
      bench: [
        { player_id: "b", name: null, positions: [], points: 2.25, adp_value: null },
        { player_id: "c", name: null, positions: [], points: null, adp_value: 40 },
      ],
      projected_points: 7.5,
      unknown_slots: [],
    };
    assert.deepEqual(lineupMetricTotals(lineup), {
      ros_starters: 7.5,
      ros_bench: 2.25,
      capital_total: 140,
      capital_bench: 40,
      capital_starters: 100,
    });
  });
});

describe("rankLeagueLineups", () => {
  test("ranks the manager's starters among every stored roster", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 20 }),
      w2: projected("w2", ["WR"], { rec: 10 }),
      w3: projected("w3", ["WR"], { rec: 5 }),
    };
    const l = league([
      roster(1, "t1", ["w1"]),
      roster(2, "me", ["w2"]),
      roster(3, "t3", ["w3"]),
    ]);
    const { lineup, ranks } = rankLeagueLineups(l, "me", board, NO_ADP);

    // The lineup that ships is the manager's own, not the league's best.
    assert.equal(lineup?.starters[0]?.player?.player_id, "w2");
    assert.deepEqual(ranks.ros_starters, { rank: 2, of: 3 });
  });

  test("ties share the better rank and the next total skips", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 20 }),
      w2: projected("w2", ["WR"], { rec: 10 }),
      w3: projected("w3", ["WR"], { rec: 10 }),
      w4: projected("w4", ["WR"], { rec: 5 }),
    };
    const l = league([
      roster(1, "t1", ["w1"]),
      roster(2, "t2", ["w2"]),
      roster(3, "t3", ["w3"]),
      roster(4, "me", ["w4"]),
    ]);

    // One of the tied pair reads 2nd…
    const tied = rankLeagueLineups(l, "t2", board, NO_ADP);
    assert.deepEqual(tied.ranks.ros_starters, { rank: 2, of: 4 });
    // …and the manager behind both of them reads 4th, not 3rd.
    const behind = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(behind.ranks.ros_starters, { rank: 4, of: 4 });
  });

  test("an unprojected bench player counts zero toward the bench total", () => {
    const board: RosProjections = {
      s1: projected("s1", ["WR"], { rec: 9 }),
      b1: projected("b1", ["WR"], { rec: 5 }),
      s2: projected("s2", ["WR"], { rec: 9 }),
      b2: projected("b2", ["WR"], { rec: 7 }),
    };
    // "gh" is unknown to the feed entirely: null points, worth nothing here.
    const l = league([
      roster(1, "me", ["s1", "b1", "gh"]),
      roster(2, "t2", ["s2", "b2"]),
    ]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(ranks.ros_bench, { rank: 2, of: 2 });
  });

  test("capital ranks read the same whether or not the players have points", () => {
    const adp = new Map([
      ["a", 1],
      ["b", 30],
    ]);
    // Same identities both times; only the points differ. The truly absent
    // feed ({}) is a different degradation — see the next test.
    const pointed: RosProjections = {
      a: projected("a", ["WR"], { rec: 1 }),
      b: projected("b", ["WR"], { rec: 20 }),
    };
    const pointless: RosProjections = {
      a: unprojected("a", ["WR"]),
      b: unprojected("b", ["WR"]),
    };
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);

    const withPoints = rankLeagueLineups(l, "me", pointed, adp);
    const without = rankLeagueLineups(l, "me", pointless, adp);
    assert.deepEqual(withPoints.ranks.capital_total, { rank: 1, of: 2 });
    for (const metric of ["capital_total", "capital_bench", "capital_starters"] as const) {
      assert.deepEqual(without.ranks[metric], withPoints.ranks[metric]);
    }
    assert.equal(without.ranks.ros_starters, null);
  });

  test("with no feed at all, capital_total still answers but the split cannot", () => {
    const adp = new Map([
      ["a", 1],
      ["b", 30],
    ]);
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);
    // An empty feed knows no positions, so nobody can be seated: the whole
    // roster's capital lands on the bench, and the starters/bench split is
    // degenerate while the total keeps ranking.
    const { ranks } = rankLeagueLineups(l, "me", NO_PROJECTIONS, adp);

    assert.equal(ranks.ros_starters, null);
    assert.equal(ranks.ros_bench, null);
    assert.deepEqual(ranks.capital_total, { rank: 1, of: 2 });
    assert.deepEqual(ranks.capital_bench, { rank: 1, of: 2 });
    assert.equal(ranks.capital_starters, null);
  });

  test("with no ADP board the capital ranks are null while ROS still answers", () => {
    const board: RosProjections = {
      a: projected("a", ["WR"], { rec: 5 }),
      b: projected("b", ["WR"], { rec: 3 }),
    };
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP);

    assert.deepEqual(ranks.ros_starters, { rank: 1, of: 2 });
    assert.equal(ranks.capital_total, null);
    assert.equal(ranks.capital_bench, null);
    assert.equal(ranks.capital_starters, null);
  });

  test("orphan and empty rosters are ranked and counted, behind the scorers", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 5 }),
      w2: projected("w2", ["WR"], { rec: 8 }),
    };
    const l = league([
      roster(1, "me", ["w1"]),
      roster(2, null, ["w2"]), // an orphan team still beats the manager
      roster(3, "t3", []), // an empty roster still widens the field
    ]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(ranks.ros_starters, { rank: 2, of: 3 });
    // Every bench is empty, so the bench metric has nothing to say.
    assert.equal(ranks.ros_bench, null);
  });

  test("a manager holding no roster gets a null lineup and null ranks", () => {
    const board: RosProjections = { w1: projected("w1", ["WR"], { rec: 5 }) };
    const l = league([roster(1, "t1", ["w1"])]);
    const result = rankLeagueLineups(l, "nobody", board, NO_ADP);

    assert.equal(result.lineup, null);
    assert.deepEqual(result.ranks, {
      ros_starters: null,
      ros_bench: null,
      capital_total: null,
      capital_bench: null,
      capital_starters: null,
    });
  });
});
