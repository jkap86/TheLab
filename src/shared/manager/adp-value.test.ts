import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_PEAK,
  DEFAULT_STEEPNESS,
  ROOKIE_PICK_STRIDE,
  ROOKIE_TOP_OVERALL_PICK,
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  adpEntryValue,
  adpValue,
  leagueAdpPool,
  parseSteepness,
  rookieOverallPick,
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
    assert.equal(
      adpValue(1 + POOL / HALVINGS, POOL, HALVINGS),
      Math.round(ADP_PEAK / 2),
    );
  });

  test("a full pool deep, value has halved `halvings` times", () => {
    assert.equal(
      adpValue(1 + POOL, POOL, HALVINGS),
      Math.round(ADP_PEAK / 2 ** HALVINGS),
    );
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

describe("rookieOverallPick", () => {
  test("the 1.01 lands on the anchor, not on pick 1", () => {
    // The whole point of the map. A rookie draft's 1.01 is `pick_no` 1, which
    // read as an overall pick is the best player in the game.
    assert.equal(rookieOverallPick(1), ROOKIE_TOP_OVERALL_PICK);
    assert.ok(rookieOverallPick(1) > 1);
  });

  test("each rookie pick is a stride of overall picks", () => {
    assert.equal(
      rookieOverallPick(5),
      ROOKIE_TOP_OVERALL_PICK + 4 * ROOKIE_PICK_STRIDE,
    );
    // Fractional, because a board average is an average of several drafts.
    assert.equal(
      rookieOverallPick(2.5),
      ROOKIE_TOP_OVERALL_PICK + 1.5 * ROOKIE_PICK_STRIDE,
    );
  });

  test("junk and sub-1 averages floor at the anchor rather than running off it", () => {
    assert.equal(rookieOverallPick(Number.NaN), ROOKIE_TOP_OVERALL_PICK);
    assert.equal(rookieOverallPick(0), ROOKIE_TOP_OVERALL_PICK);
    assert.equal(rookieOverallPick(-5), ROOKIE_TOP_OVERALL_PICK);
  });
});

describe("adpEntryValue", () => {
  test("a full-board entry prices exactly as the bare curve does", () => {
    assert.equal(
      adpEntryValue({ board: "full", adp: 30 }, POOL, HALVINGS),
      adpValue(30, POOL, HALVINGS),
    );
  });

  test("a rookie 1.01 is worth less than the overall first pick", () => {
    // The bug this split exists to fix: pooled into one average, a rookie 1.01
    // arrived as adp 1 and priced at the peak — the same number the best player
    // in the game gets.
    const rookie = adpEntryValue({ board: "rookie", adp: 1 }, POOL, HALVINGS);
    assert.ok(rookie < ADP_PEAK);
    assert.equal(rookie, adpValue(ROOKIE_TOP_OVERALL_PICK, POOL, HALVINGS));
  });

  test("a mid-board rookie pick falls below a full-board pick of the same number", () => {
    // Rookie pick 24 is a second-rounder; overall pick 24 is a startable
    // starter. Before the split these were one number.
    assert.ok(
      adpEntryValue({ board: "rookie", adp: 24 }, POOL, HALVINGS) <
        adpEntryValue({ board: "full", adp: 24 }, POOL, HALVINGS),
    );
  });

  test("a rookie board stays monotonic and bounded by the peak", () => {
    let previous = ADP_PEAK;
    for (const pick of [1, 2, 6, 12, 24, 36, 48, 60]) {
      const value = adpEntryValue({ board: "rookie", adp: pick }, POOL, HALVINGS);
      assert.ok(value <= previous, `rookie ${pick} should not rise`);
      assert.ok(value <= ADP_PEAK && value >= 0);
      previous = value;
    }
  });

  test("a deeper-starting league carries a rookie pick further, as it does any pick", () => {
    // League size reaches a rookie pick only through `pool` — the map itself is
    // size-free, because a rookie's board position is his rank in the class.
    assert.ok(
      adpEntryValue({ board: "rookie", adp: 12 }, 132, HALVINGS) >
        adpEntryValue({ board: "rookie", adp: 12 }, 72, HALVINGS),
    );
  });

  test("a whole rookie class no longer outranks the top of a startup board", () => {
    // The symptom on the page: at the default steepness every pick of a
    // four-round rookie draft used to price above the 60th player off a
    // startup board. A late rookie pick must now sit below one.
    const startupSixty = adpEntryValue({ board: "full", adp: 60 }, POOL, DEFAULT_STEEPNESS);
    assert.ok(
      adpEntryValue({ board: "rookie", adp: 36 }, POOL, DEFAULT_STEEPNESS) <
        startupSixty,
    );
  });
});

describe("leagueAdpPool", () => {
  test("teams times starting slots", () => {
    assert.equal(leagueAdpPool(12, ["QB", "RB", "WR", "BN"]), 36);
  });

  test("a league with no slots on file falls back to a typical lineup", () => {
    // The fallback keeps the curve from collapsing to a pool of zero; every lens
    // pricing a roster off ADP must reach the same number, which is why it lives
    // in one place and is not retyped per caller.
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

  test("the default sits inside the range, on one of its notches", () => {
    assert.ok(DEFAULT_STEEPNESS >= STEEPNESS_RANGE.min);
    assert.ok(DEFAULT_STEEPNESS <= STEEPNESS_RANGE.max);
    // The measured optimum is 2.70 and the default is the notch beside it: an
    // off-grid default is one a slider snaps away from the moment a reader
    // touches it, so the number the cards open on would not be the number the
    // control can express.
    const notches = Math.round(
      (DEFAULT_STEEPNESS - STEEPNESS_RANGE.min) / STEEPNESS_RANGE.step,
    );
    assert.equal(
      STEEPNESS_RANGE.min + notches * STEEPNESS_RANGE.step,
      DEFAULT_STEEPNESS,
    );
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
