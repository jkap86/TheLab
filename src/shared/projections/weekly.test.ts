import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import { groupWeeklyPoints, weeklyLineupSplit, weeklyRosters } from "./weekly.ts";
import { optimalLineup } from "./optimal.ts";
import type { RosterPlayer } from "./optimal.ts";

const p = (
  player_id: string,
  positions: string | string[],
  points: number,
): RosterPlayer => ({
  player_id,
  positions: Array.isArray(positions) ? positions : [positions],
  points,
});

const points = (slots: readonly string[], players: RosterPlayer[]) =>
  Math.round(optimalLineup(slots, players).reduce((a, s) => a + s.points, 0) * 100) / 100;

describe("groupWeeklyPoints", () => {
  it("groups scored rows by week, then player", () => {
    const grouped = groupWeeklyPoints(
      [
        { player_id: "a", week: 1, stats: { rush_yd: 100 } },
        { player_id: "b", week: 1, stats: { rush_yd: 50 } },
        { player_id: "a", week: 2, stats: { rush_yd: 20 } },
      ],
      (stats) => (stats?.rush_yd ?? 0) * 0.1,
    );

    assert.deepEqual(
      [...grouped.keys()].sort((x, y) => x - y),
      [1, 2],
    );
    assert.equal(grouped.get(1)?.get("a"), 10);
    assert.equal(grouped.get(1)?.get("b"), 5);
    assert.equal(grouped.get(2)?.get("a"), 2);
    assert.equal(grouped.get(2)?.has("b"), false);
  });

  it("scores with the caller's function, so league settings decide the points", () => {
    const stats = [{ player_id: "a", week: 1, stats: { rec: 4 } }];
    const ppr = groupWeeklyPoints(stats, (s) => (s?.rec ?? 0) * 1);
    const half = groupWeeklyPoints(stats, (s) => (s?.rec ?? 0) * 0.5);
    assert.equal(ppr.get(1)?.get("a"), 4);
    assert.equal(half.get(1)?.get("a"), 2);
  });
});

describe("weeklyRosters", () => {
  const weekPoints = new Map([
    [1, new Map([["a", 10], ["b", 5]])],
    [2, new Map([["b", 7]])],
  ]);

  it("prices each candidate at that week's points, not a season total", () => {
    const [wk1, wk2] = weeklyRosters([p("a", "RB", 999), p("b", "RB", 999)], [1, 2], weekPoints);
    assert.deepEqual(
      wk1.map((p) => [p.player_id, p.points]),
      [["a", 10], ["b", 5]],
    );
    assert.deepEqual(
      wk2.map((p) => [p.player_id, p.points]),
      [["b", 7]],
    );
  });

  it("omits an unprojected candidate from the week instead of passing a zero", () => {
    // The property the benched-weeks counts rest on: player "a" has no week-2
    // projection (a bye), so he must be absent from week 2's candidates — a
    // zero-point entry would count the bye as a week he sat.
    const [, wk2] = weeklyRosters([p("a", "RB", 0), p("b", "RB", 0)], [1, 2], weekPoints);
    assert.equal(wk2.some((p) => p.player_id === "a"), false);
  });

  it("keeps eligibility while re-pricing", () => {
    const dual: RosterPlayer = { player_id: "a", positions: ["RB", "WR"], points: 0 };
    const [wk1] = weeklyRosters([dual], [1], weekPoints);
    assert.deepEqual(wk1[0].positions, ["RB", "WR"]);
  });

  it("yields an empty roster for a week with no projections at all", () => {
    const rosters = weeklyRosters([p("a", "RB", 0)], [1, 3], weekPoints);
    assert.equal(rosters.length, 2);
    assert.deepEqual(rosters[1], []);
  });
});

describe("weeklyLineupSplit", () => {
  test("sums each week's own best lineup", () => {
    const { points: total } = weeklyLineupSplit(
      ["QB", "RB"],
      [
        [p("qb1", "QB", 20), p("rb1", "RB", 15)],
        [p("qb1", "QB", 18), p("rb1", "RB", 12)],
      ],
    );
    assert.equal(total, 65);
  });

  test("beats one lineup ranked on the aggregate when the best start alternates", () => {
    // Both backs total 25 over the two weeks, so a season-long lineup with one RB
    // slot starts either of them for 25. Setting the lineup week by week starts
    // whichever is up that week, for 40 — the gap is the whole point of this
    // number sitting beside the aggregate one.
    const weeks = [
      [p("rb1", "RB", 20), p("rb2", "RB", 5)],
      [p("rb1", "RB", 5), p("rb2", "RB", 20)],
    ];
    assert.equal(weeklyLineupSplit(["RB"], weeks).points, 40);
    assert.equal(
      points(["RB"], [p("rb1", "RB", 25), p("rb2", "RB", 25)]),
      25,
    );
  });

  test("covers a bye with the bench rather than losing the slot", () => {
    // rb1 is the better start in week 1 and unprojected in week 2, where his slot
    // goes to rb2 — 30, not the 20 a fixed lineup would score.
    const { points: total } = weeklyLineupSplit(
      ["RB"],
      [
        [p("rb1", "RB", 20), p("rb2", "RB", 10)],
        // rb1 is absent, not at zero — the omission the comment describes.
        [p("rb2", "RB", 10)],
      ],
    );
    assert.equal(total, 30);
  });

  test("rounds once over the whole horizon, not once a week", () => {
    // Three weeks at 0.005 are 0.02 together and 0.03 rounded a week at a time.
    const weeks = [0, 1, 2].map(() => [p("qb1", "QB", 0.005)]);
    assert.equal(weeklyLineupSplit(["QB"], weeks).points, 0.02);
  });

  test("is zero over no weeks", () => {
    assert.deepEqual(weeklyLineupSplit(["QB"], []), {
      points: 0,
      bench_points: 0,
      players: {},
    });
  });

  test("totals what the lineups leave behind", () => {
    // One RB slot, three backs: the best starts each week and the other two are
    // the bench total, whoever they happen to be that week.
    const { points: total, bench_points } = weeklyLineupSplit(
      ["RB"],
      [
        [p("rb1", "RB", 20), p("rb2", "RB", 8), p("rb3", "RB", 3)],
        [p("rb1", "RB", 4), p("rb2", "RB", 15), p("rb3", "RB", 6)],
      ],
    );

    assert.equal(total, 20 + 15);
    assert.equal(bench_points, 8 + 3 + 4 + 6);
  });

  test("the team bench total is the sum of the per-player bench halves", () => {
    const { bench_points, players } = weeklyLineupSplit(
      ["QB", "RB", "FLEX"],
      [
        [p("qb1", "QB", 20), p("rb1", "RB", 15), p("rb2", "RB", 9), p("wr1", "WR", 11)],
        [p("qb1", "QB", 18), p("rb1", "RB", 4), p("rb2", "RB", 13), p("wr1", "WR", 12)],
      ],
    );

    const perPlayer = Object.values(players).reduce((a, s) => a + s.bench_points, 0);
    assert.equal(bench_points, Math.round(perPlayer * 100) / 100);
    // rb2 sits in week 1 and rb1 sits in week 2 — nobody else ever sits.
    assert.equal(bench_points, 9 + 4);
  });

  test("counts nothing as benched when every candidate starts", () => {
    const { bench_points } = weeklyLineupSplit(
      ["QB", "RB"],
      [[p("qb1", "QB", 20), p("rb1", "RB", 15)]],
    );
    assert.equal(bench_points, 0);
  });

  test("splits each player's points by the weeks he actually starts", () => {
    // One RB slot and two backs who take turns: each starts once for 20 and sits
    // once for 5, so neither player's 25-point total is what he is worth here.
    const { players } = weeklyLineupSplit(
      ["RB"],
      [
        [p("rb1", "RB", 20), p("rb2", "RB", 5)],
        [p("rb1", "RB", 5), p("rb2", "RB", 20)],
      ],
    );

    assert.deepEqual(players.rb1, {
      starting_points: 20,
      bench_points: 5,
      starting_weeks: 1,
      bench_weeks: 1,
    });
    assert.deepEqual(players.rb2, {
      starting_points: 20,
      bench_points: 5,
      starting_weeks: 1,
      bench_weeks: 1,
    });
  });

  test("the started halves add up to the total", () => {
    // The invariant that makes this a split rather than two loosely related
    // numbers: every point in `points` is a point some player is credited with
    // starting for.
    const { points: total, players } = weeklyLineupSplit(
      ["QB", "RB", "FLEX"],
      [
        [p("qb1", "QB", 20), p("rb1", "RB", 15), p("rb2", "RB", 9), p("wr1", "WR", 11)],
        [p("qb1", "QB", 18), p("rb1", "RB", 4), p("rb2", "RB", 13), p("wr1", "WR", 12)],
      ],
    );

    const started = Object.values(players).reduce((a, s) => a + s.starting_points, 0);
    assert.equal(started, total);
    assert.equal(total, 20 + 15 + 11 + 18 + 13 + 12);
  });

  test("credits a player who never starts with nothing, not with his total", () => {
    // The reason a bench player's season total is the wrong number to read: te1
    // is projected 24 points that no lineup ever collects.
    const { players } = weeklyLineupSplit(
      ["RB"],
      [
        [p("rb1", "RB", 20), p("te1", "TE", 12)],
        [p("rb1", "RB", 18), p("te1", "TE", 12)],
      ],
    );

    assert.deepEqual(players.te1, {
      starting_points: 0,
      bench_points: 24,
      starting_weeks: 0,
      bench_weeks: 2,
    });
  });

  test("a week a player is absent from counts as neither started nor benched", () => {
    // A bye is not a week on the bench: rb1 has no projection in week 2, and
    // reporting that as a benched week would have every player on the roster
    // looking like a part-time starter.
    const { players } = weeklyLineupSplit(
      ["RB"],
      [[p("rb1", "RB", 20), p("rb2", "RB", 10)], [p("rb2", "RB", 10)]],
    );

    assert.deepEqual(players.rb1, {
      starting_points: 20,
      bench_points: 0,
      starting_weeks: 1,
      bench_weeks: 0,
    });
    assert.equal(players.rb2.starting_weeks, 1);
    assert.equal(players.rb2.bench_weeks, 1);
  });

  test("rounds each half once rather than once a week", () => {
    const weeks = [0, 1, 2].map(() => [p("qb1", "QB", 0.005), p("qb2", "QB", 0.005)]);
    const { players } = weeklyLineupSplit(["QB"], weeks);

    // qb1 wins the tie on player_id all three weeks, so one starts throughout and
    // the other sits throughout — both at 0.02, not the 0.03 a weekly rounding
    // would accumulate.
    assert.equal(players.qb1.starting_points, 0.02);
    assert.equal(players.qb2.bench_points, 0.02);
  });
});
