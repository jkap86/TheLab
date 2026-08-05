import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_PEAK,
  DEFAULT_STEEPNESS,
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  adpBoardFor,
  adpValue,
  boardSignature,
  leagueAdpPool,
  parseSteepness,
  rosterAdpValue,
  startingSlotCount,
} from "./adp-value.ts";

// A 12-team league starting 9 — 108 startable slots — at the default steepness.
const POOL = 108;
const HALVINGS = 4;

describe("adpValue", () => {
  test("the first pick sits at the peak", () => {
    assert.equal(adpValue(1, POOL, HALVINGS), ADP_PEAK);
  });

  test("value halves one full halving-step into the pool", () => {
    // (adp − 1)/pool = 1/halvings ⇒ one halving. 27/108 = 1/4 = 1/HALVINGS.
    assert.equal(adpValue(1 + POOL / HALVINGS, POOL, HALVINGS), Math.round(ADP_PEAK / 2));
  });

  test("a full pool deep, value has halved `halvings` times", () => {
    assert.equal(adpValue(1 + POOL, POOL, HALVINGS), Math.round(ADP_PEAK / 2 ** HALVINGS));
  });

  test("a better (lower) ADP is never worth less", () => {
    // Non-increasing everywhere — integer rounding leaves ties in the deep tail
    // (two picks in the hundreds price a rounding apart), which is fine: two deep
    // bench pieces really are worth about the same.
    let previous = Infinity;
    for (let adp = 1; adp <= 300; adp += 3) {
      const value = adpValue(adp, POOL, HALVINGS);
      assert.ok(value <= previous, `adp ${adp} rose above ${previous}`);
      previous = value;
    }
  });

  test("a bigger startable pool holds value further down the board", () => {
    // The league-size anchor: the same pick is worth more where more players start.
    assert.ok(adpValue(30, 132, HALVINGS) > adpValue(30, 72, HALVINGS));
  });

  test("more halvings make the curve steeper", () => {
    assert.ok(adpValue(30, POOL, 5) < adpValue(30, POOL, 3));
  });

  test("a junk ADP can't exceed the peak or return NaN", () => {
    assert.equal(adpValue(Number.NaN, POOL, HALVINGS), ADP_PEAK);
    assert.equal(adpValue(0, POOL, HALVINGS), ADP_PEAK);
  });

  test("a zero pool is floored rather than dividing by zero", () => {
    const value = adpValue(30, 0, HALVINGS);
    assert.ok(Number.isFinite(value) && value >= 0 && value < ADP_PEAK);
  });
});

describe("startingSlotCount", () => {
  test("counts starting slots, dropping bench, IR and taxi", () => {
    assert.equal(
      startingSlotCount(["QB", "RB", "RB", "WR", "TE", "FLEX", "BN", "IR", "TAXI"]),
      6,
    );
  });

  test("a superflex slot is a starting slot", () => {
    assert.equal(startingSlotCount(["QB", "SUPER_FLEX", "BN"]), 2);
  });

  test("an unrecognised slot starts nobody", () => {
    assert.equal(startingSlotCount(["QB", "OP", "BN"]), 1);
  });

  test("no slots on file is zero, not a guess", () => {
    assert.equal(startingSlotCount(null), 0);
    assert.equal(startingSlotCount([]), 0);
  });
});

describe("leagueAdpPool", () => {
  test("teams times starting slots", () => {
    assert.equal(leagueAdpPool(12, ["QB", "RB", "WR", "BN"]), 36);
  });

  test("a league with no slots on file falls back to a typical lineup", () => {
    // The fallback keeps the curve from collapsing to a pool of zero; the same
    // number must reach the league route and the adp-value route, which is why
    // it lives here and not retyped per caller.
    assert.equal(leagueAdpPool(10, null), 10 * TYPICAL_STARTING_SLOTS);
    assert.equal(leagueAdpPool(10, []), 10 * TYPICAL_STARTING_SLOTS);
  });
});

describe("parseSteepness", () => {
  test("a number of halvings passes through, fractions included", () => {
    // The slider's step is a quarter of a halving, so a whole-number parse would
    // silently coarsen every curve between the notches.
    assert.equal(parseSteepness("3"), 3);
    assert.equal(parseSteepness("4.25"), 4.25);
  });

  test("anything unparseable falls back to the default", () => {
    assert.equal(parseSteepness(null), DEFAULT_STEEPNESS);
    assert.equal(parseSteepness(undefined), DEFAULT_STEEPNESS);
    assert.equal(parseSteepness("garbage"), DEFAULT_STEEPNESS);
    // An empty parameter is an absent one — `Number("")` is 0, which would clamp
    // to the flattest curve on the scale rather than the default.
    assert.equal(parseSteepness(""), DEFAULT_STEEPNESS);
  });

  test("out of range clamps rather than resetting", () => {
    // The nearest curve on the scale is a better answer to "steeper than that"
    // than silently pricing every roster on the default.
    assert.equal(parseSteepness("99"), STEEPNESS_RANGE.max);
    assert.equal(parseSteepness("-5"), STEEPNESS_RANGE.min);
  });

  test("the default sits inside the range", () => {
    assert.ok(DEFAULT_STEEPNESS >= STEEPNESS_RANGE.min);
    assert.ok(DEFAULT_STEEPNESS <= STEEPNESS_RANGE.max);
  });
});

describe("rosterAdpValue", () => {
  const values = new Map([
    ["qb", 8000],
    ["rb", 5000],
    ["wr", 3000],
    ["stash", 2000],
  ]);

  test("splits the total across the lineup, bench taking the remainder", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["qb", "rb"],
      values,
    });
    assert.deepEqual(result, {
      total: 18000,
      priced: 4,
      rostered: 4,
      split: { starters: 13000, bench: 5000 },
    });
  });

  test("the halves always add back up to the total", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb", "wr", "stash"],
      starters: ["wr"],
      values,
    });
    assert.equal(result.split!.starters + result.split!.bench, result.total);
  });

  test("a player with no ADP is rostered but adds nothing", () => {
    const result = rosterAdpValue({
      players: ["qb", "kicker", "def"],
      starters: ["qb", "kicker"],
      values,
    });
    assert.equal(result.total, 8000);
    assert.equal(result.priced, 1);
    assert.equal(result.rostered, 3);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("empty and padded slot ids are not players", () => {
    const result = rosterAdpValue({
      players: ["qb", "0", ""],
      starters: ["qb", "0"],
      values,
    });
    assert.equal(result.rostered, 1);
    assert.deepEqual(result.split, { starters: 8000, bench: 0 });
  });

  test("a repeated player id counts once", () => {
    const result = rosterAdpValue({
      players: ["qb", "qb", "rb"],
      starters: ["qb"],
      values,
    });
    assert.equal(result.total, 13000);
    assert.equal(result.rostered, 2);
    assert.deepEqual(result.split, { starters: 8000, bench: 5000 });
  });

  test("a starter this roster doesn't hold can't overdraw the bench", () => {
    const result = rosterAdpValue({
      players: ["wr"],
      starters: ["qb", "wr"],
      values,
    });
    assert.deepEqual(result.split, { starters: 3000, bench: 0 });
  });

  test("no lineup leaves the total intact and the split unanswered", () => {
    const result = rosterAdpValue({
      players: ["qb", "rb"],
      starters: null,
      values,
    });
    assert.equal(result.total, 13000);
    assert.equal(result.split, null);
  });

  test("an empty roster prices at nothing rather than failing", () => {
    const result = rosterAdpValue({ players: [], starters: [], values });
    assert.deepEqual(result, {
      total: 0,
      priced: 0,
      rostered: 0,
      split: { starters: 0, bench: 0 },
    });
  });
});

describe("adpBoardFor", () => {
  test("reads the board off the league's slots and scoring", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR", "SUPER_FLEX", "BN"],
      scoringSettings: { rec: 1 },
    });
    assert.deepEqual(board.seasons, ["2025"]);
    assert.equal(board.superflex, true);
    assert.deepEqual(board.scoring, ["ppr"]);
  });

  test("a single QB league reads the 1QB board, half-PPR its bucket", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR", "FLEX", "BN"],
      scoringSettings: { rec: 0.5 },
    });
    assert.equal(board.superflex, false);
    assert.deepEqual(board.scoring, ["half_ppr"]);
  });

  test("missing reception scoring is standard, not a failure", () => {
    const board = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: null,
    });
    assert.deepEqual(board.scoring, ["std"]);
  });

  test("leagues sharing the priced axes share a signature", () => {
    // The league type is deliberately not an axis: the fetch answers both
    // boards, so a dynasty league and a redraft league alike in slots and
    // scoring share one query and read their own side of it.
    const a = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "SUPER_FLEX", "BN"],
      scoringSettings: { rec: 1 },
    });
    const b = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "QB", "RB"],
      scoringSettings: { rec: 1.5 },
    });
    const c = adpBoardFor({
      season: "2025",
      rosterPositions: ["QB", "RB", "WR"],
      scoringSettings: { rec: 1 },
    });
    assert.equal(boardSignature(a), boardSignature(b));
    assert.notEqual(boardSignature(a), boardSignature(c));
  });
});
