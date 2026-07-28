import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  compareLineup,
  optimalLineup,
  startingSlots,
  weeklyOptimalPoints,
} from "./optimal.ts";
import type { RosterPlayer } from "./optimal.ts";

/**
 * The lineup this produces is advice a manager acts on, and a wrong answer looks
 * exactly like a right one — so the flex cases are pinned individually and the
 * whole thing is cross-checked against brute force on random rosters at the end.
 */

const p = (
  player_id: string,
  positions: string | string[],
  points: number,
): RosterPlayer => ({
  player_id,
  positions: Array.isArray(positions) ? positions : [positions],
  points,
});

/** Ids in the filled slots, in slot order; null for an empty slot. */
const filled = (slots: readonly string[], players: RosterPlayer[]) =>
  optimalLineup(slots, players).map((s) => s.player_id);

const points = (slots: readonly string[], players: RosterPlayer[]) =>
  Math.round(optimalLineup(slots, players).reduce((a, s) => a + s.points, 0) * 100) / 100;

describe("startingSlots", () => {
  test("drops the slots that hold players without starting them", () => {
    assert.deepEqual(
      startingSlots(["QB", "RB", "BN", "FLEX", "IR", "BN", "TAXI"]),
      ["QB", "RB", "FLEX"],
    );
  });
});

describe("optimalLineup", () => {
  test("fills each slot from the players eligible for it", () => {
    const roster = [p("qb", "QB", 20), p("rb", "RB", 15), p("wr", "WR", 12)];
    assert.deepEqual(filled(["QB", "RB", "WR"], roster), ["qb", "rb", "wr"]);
  });

  test("gives a slot its best eligible player", () => {
    const roster = [p("rb1", "RB", 15), p("rb2", "RB", 9)];
    assert.deepEqual(filled(["RB"], roster), ["rb1"]);
  });

  test("FLEX takes the best of RB/WR/TE left over", () => {
    const roster = [p("rb1", "RB", 15), p("rb2", "RB", 14), p("wr1", "WR", 12)];
    assert.deepEqual(filled(["RB", "FLEX"], roster), ["rb1", "rb2"]);
  });

  test("seats the better player in the stricter slot, not the flex", () => {
    // Both orderings score 29; only one of them reads as sensible advice, and
    // the arbitrary one would diff against a sane lineup as two needless moves.
    const roster = [p("rb1", "RB", 15), p("rb2", "RB", 14)];
    assert.deepEqual(filled(["FLEX", "RB"], roster), ["rb2", "rb1"]);
    assert.deepEqual(filled(["RB", "FLEX"], roster), ["rb1", "rb2"]);
  });

  test("orders two copies of the same slot best first", () => {
    // Both orderings are the same lineup for the same points, but a roster that
    // lists RB2 above RB1 reads as an oversight, and diffs against a sane current
    // lineup as two moves that change nothing.
    const roster = [p("rb1", "RB", 15), p("rb2", "RB", 14), p("rb3", "RB", 9)];
    assert.deepEqual(filled(["RB", "RB"], roster), ["rb1", "rb2"]);
    assert.deepEqual(filled(["FLEX", "FLEX"], roster), ["rb1", "rb2"]);
  });

  test("SUPER_FLEX starts a second quarterback when he outscores the flex", () => {
    const roster = [p("qb1", "QB", 22), p("qb2", "QB", 19), p("rb1", "RB", 14)];
    assert.deepEqual(filled(["QB", "SUPER_FLEX"], roster), ["qb1", "qb2"]);
  });

  test("SUPER_FLEX takes a skill player when he outscores the backup QB", () => {
    const roster = [p("qb1", "QB", 22), p("qb2", "QB", 9), p("rb1", "RB", 14)];
    assert.deepEqual(filled(["QB", "SUPER_FLEX"], roster), ["qb1", "rb1"]);
  });

  test("solves overlapping flexes that slot-by-slot filling gets wrong", () => {
    // WRRB_FLEX takes RB/WR, REC_FLEX takes WR/TE — neither contains the other.
    // Filling WRRB first grabs the WR and strands the RB: 10 + 3 = 13. Putting the
    // WR in REC_FLEX instead scores 18.
    const roster = [p("wr", "WR", 10), p("rb", "RB", 8), p("te", "TE", 3)];
    assert.equal(points(["WRRB_FLEX", "REC_FLEX"], roster), 18);
    assert.deepEqual(filled(["WRRB_FLEX", "REC_FLEX"], roster), ["rb", "wr"]);
  });

  test("the same trap in the other slot order", () => {
    const roster = [p("wr", "WR", 10), p("rb", "RB", 8), p("te", "TE", 3)];
    assert.equal(points(["REC_FLEX", "WRRB_FLEX"], roster), 18);
    assert.deepEqual(filled(["REC_FLEX", "WRRB_FLEX"], roster), ["wr", "rb"]);
  });

  test("uses a dual-eligible player wherever he is worth more", () => {
    // A DL/LB with an LB and an IDP_FLEX open: he should free the flex for the
    // better of the others rather than blocking it.
    const roster = [p("hybrid", ["DL", "LB"], 12), p("lb", "LB", 11), p("db", "DB", 4)];
    assert.equal(points(["LB", "IDP_FLEX"], roster), 23);
  });

  test("leaves a slot empty when nobody is eligible", () => {
    const roster = [p("wr", "WR", 12)];
    assert.deepEqual(filled(["WR", "K", "DEF"], roster), ["wr", null, null]);
  });

  test("starts nobody in an unrecognised slot", () => {
    assert.deepEqual(filled(["WEIRD_FLEX"], [p("wr", "WR", 12)]), [null]);
  });

  test("is deterministic when players tie", () => {
    const roster = [p("b", "RB", 10), p("a", "RB", 10)];
    assert.deepEqual(filled(["RB"], roster), ["a"]);
    assert.deepEqual(filled(["RB"], [...roster].reverse()), ["a"]);
  });

  test("handles an empty roster and an empty lineup", () => {
    assert.deepEqual(optimalLineup([], [p("wr", "WR", 12)]), []);
    assert.deepEqual(filled(["QB"], []), [null]);
  });
});

describe("weeklyOptimalPoints", () => {
  test("sums each week's own best lineup", () => {
    const total = weeklyOptimalPoints(
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
    assert.equal(weeklyOptimalPoints(["RB"], weeks), 40);
    assert.equal(
      points(["RB"], [p("rb1", "RB", 25), p("rb2", "RB", 25)]),
      25,
    );
  });

  test("covers a bye with the bench rather than losing the slot", () => {
    // rb1 is the better start in week 1 and unprojected in week 2, where his slot
    // goes to rb2 — 30, not the 20 a fixed lineup would score.
    const total = weeklyOptimalPoints(
      ["RB"],
      [
        [p("rb1", "RB", 20), p("rb2", "RB", 10)],
        [p("rb1", "RB", 0), p("rb2", "RB", 10)],
      ],
    );
    assert.equal(total, 30);
  });

  test("rounds once over the whole horizon, not once a week", () => {
    // Three weeks at 0.005 are 0.02 together and 0.03 rounded a week at a time.
    const weeks = [0, 1, 2].map(() => [p("qb1", "QB", 0.005)]);
    assert.equal(weeklyOptimalPoints(["QB"], weeks), 0.02);
  });

  test("is zero over no weeks", () => {
    assert.equal(weeklyOptimalPoints(["QB"], []), 0);
  });
});

describe("compareLineup", () => {
  const roster = [
    p("qb1", "QB", 20),
    p("rb1", "RB", 15),
    p("rb2", "RB", 14),
    p("wr1", "WR", 12),
    p("te1", "TE", 4),
  ];

  test("finds the points a bad lineup is leaving on the bench", () => {
    const result = compareLineup({
      rosterPositions: ["QB", "RB", "FLEX", "BN", "BN"],
      starters: ["qb1", "rb1", "te1"],
      players: roster,
    });

    assert.equal(result.current_points, 39);
    assert.equal(result.optimal_points, 49);
    assert.equal(result.points_left, 10);
    assert.deepEqual(result.start, ["rb2"]);
    assert.deepEqual(result.sit, ["te1"]);
  });

  test("says nothing to change when the lineup is already optimal", () => {
    const result = compareLineup({
      rosterPositions: ["QB", "RB", "FLEX"],
      starters: ["qb1", "rb1", "rb2"],
      players: roster,
    });

    assert.equal(result.points_left, 0);
    assert.deepEqual(result.start, []);
    assert.deepEqual(result.sit, []);
  });

  test("reads Sleeper's empty-slot marker as an empty slot", () => {
    const result = compareLineup({
      rosterPositions: ["QB", "RB"],
      starters: ["qb1", "0"],
      players: roster,
    });

    assert.deepEqual(result.current[1], { slot: "RB", player_id: null, points: 0 });
    assert.deepEqual(result.start, ["rb1"]);
  });

  test("scores a started player with no projection as zero, not as absent", () => {
    // Dropping him would credit the current lineup with a slot it isn't using.
    const result = compareLineup({
      rosterPositions: ["QB", "RB"],
      starters: ["qb1", "unknown-player"],
      players: roster,
    });

    assert.equal(result.current[1].player_id, "unknown-player");
    assert.equal(result.current[1].points, 0);
    assert.equal(result.current_points, 20);
    assert.deepEqual(result.sit, ["unknown-player"]);
  });

  test("drops an unrecognised slot from both lineups and names it", () => {
    const result = compareLineup({
      rosterPositions: ["QB", "WEIRD_FLEX", "RB"],
      starters: ["qb1", "wr1", "rb1"],
      players: roster,
    });

    assert.deepEqual(result.unknown_slots, ["WEIRD_FLEX"]);
    assert.deepEqual(
      result.current.map((s) => [s.slot, s.player_id]),
      [["QB", "qb1"], ["RB", "rb1"]],
    );
    // The RB slot keeps its own starter: dropping the unknown slot must not
    // shift `starters` by one and blame the wrong player.
    assert.equal(result.points_left, 0);
  });

  test("ignores bench slots on both sides", () => {
    const result = compareLineup({
      rosterPositions: ["QB", "BN", "BN"],
      starters: ["qb1"],
      players: roster,
    });

    assert.equal(result.current.length, 1);
    assert.equal(result.optimal.length, 1);
    assert.equal(result.points_left, 0);
  });

  test("never reports negative points left", () => {
    const result = compareLineup({
      rosterPositions: ["QB"],
      starters: ["qb1"],
      players: [p("qb1", "QB", 20.005)],
    });
    assert.ok(result.points_left >= 0);
  });
});

describe("optimalLineup vs brute force", () => {
  test("matches an exhaustive search on 400 random rosters", () => {
    // The greedy is only optimal because of an argument about matroids; this is
    // the check that the argument survived contact with the implementation.
    const SLOTS = ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "WRRB_FLEX", "REC_FLEX"];
    const POSITIONS = [["QB"], ["RB"], ["WR"], ["TE"], ["RB", "WR"], ["WR", "TE"]];

    // Seeded so a failure is reproducible; Math.random would report a different
    // counterexample every run.
    let seed = 20260727;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    const best = (slots: string[], players: RosterPlayer[]): number => {
      const used = new Set<string>();
      const walk = (i: number): number => {
        if (i === slots.length) return 0;
        let top = walk(i + 1); // leave this slot empty
        for (const player of players) {
          if (used.has(player.player_id)) continue;
          const allowed = {
            QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"],
            FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
            WRRB_FLEX: ["RB", "WR"], REC_FLEX: ["WR", "TE"],
          }[slots[i]] as string[];
          if (!player.positions.some((x) => allowed.includes(x))) continue;
          used.add(player.player_id);
          top = Math.max(top, player.points + walk(i + 1));
          used.delete(player.player_id);
        }
        return top;
      };
      return Math.round(walk(0) * 100) / 100;
    };

    for (let run = 0; run < 400; run++) {
      const slots = Array.from({ length: 1 + rand(4) }, () => SLOTS[rand(SLOTS.length)]);
      const players = Array.from({ length: 1 + rand(7) }, (_, i) =>
        p(`p${i}`, POSITIONS[rand(POSITIONS.length)], rand(300) / 10),
      );

      assert.equal(
        points(slots, players),
        best(slots, players),
        `suboptimal for slots ${slots.join("/")} and ${JSON.stringify(players)}`,
      );
    }
  });
});
