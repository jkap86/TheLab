import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  median,
  sharePercentile,
  slotPercentile,
  winSharePercentile,
} from "./rank-ramp.ts";

/**
 * The two ramp *inputs* the expanded league card colours by, and the median
 * behind one of them.
 *
 * They are pinned rather than eyeballed for the reason every pure module in
 * this folder is: a table coloured off the wrong scale renders perfectly. A
 * saturation an order of magnitude out paints twelve tightly-matched teams as
 * a blowout, or a genuine runaway as a dead heat, and nothing on screen says
 * which of the two it is doing.
 */

describe("sharePercentile", () => {
  test("the league's mean is the neutral, whatever the scale", () => {
    assert.equal(sharePercentile(100, [50, 100, 150]), 50);
    assert.equal(sharePercentile(10_000, [5_000, 10_000, 15_000]), 50);
  });

  test("±10% of the mean reaches the ends of the ramp", () => {
    // A team 10% clear of a league averaging 100 is at the top of the scale,
    // and one 10% adrift is at the bottom.
    assert.equal(sharePercentile(110, [90, 100, 110]), 100);
    assert.equal(sharePercentile(90, [90, 100, 110]), 0);
  });

  test("beyond ±10% it saturates rather than running off the ramp", () => {
    assert.equal(sharePercentile(1_000, [10, 20, 30]), 100);
    assert.equal(sharePercentile(0, [100, 100, 100]), 0);
  });

  test("**a tight table stays near the neutral**, which is the whole point", () => {
    // Twelve teams within a point of each other: a rank ramp would spend full
    // red and full green here, and this must not.
    const totals = [100.6, 100.5, 100.4, 100.3, 100.2, 100.1, 100, 99.9, 99.8];
    for (const total of totals) {
      const p = sharePercentile(total, totals);
      assert.ok(p > 47 && p < 53, `${total} -> ${p}`);
    }
  });

  test("a mean of zero has no share to take and reads neutral", () => {
    assert.equal(sharePercentile(0, [0, 0, 0]), 50);
    assert.equal(sharePercentile(5, []), 50);
  });
});

describe("slotPercentile", () => {
  test("the median is the neutral", () => {
    assert.equal(slotPercentile(200, 200), 50);
  });

  test("±20% of the median reaches the ends — wider than the standings'", () => {
    assert.equal(slotPercentile(240, 200), 100);
    assert.equal(slotPercentile(160, 200), 0);
    // The same ±10% that saturates a whole roster's total is only halfway here.
    assert.equal(slotPercentile(220, 200), 75);
  });

  test("a median of zero is nothing to compare against, not a floor", () => {
    // No roster in the league has a figure at this seat under this lens. A
    // percentile of 100 (everything beats zero) would paint every seat green.
    assert.equal(slotPercentile(0, 0), 50);
    assert.equal(slotPercentile(240, 0), 50);
  });
});

describe("winSharePercentile", () => {
  test("**8–5 is visibly greener than 7–6**, which a raw share would not be", () => {
    // Unrounded, like every percentile here: the number is fed straight to a
    // continuous ramp and never printed, so there is no precision to invent.
    const better = winSharePercentile(8, 5);
    const worse = winSharePercentile(7, 6);
    assert.ok(better > 72 && better < 74, `8-5 -> ${better}`);
    assert.ok(worse > 57 && worse < 59, `7-6 -> ${worse}`);
    // The raw shares are .615 and .538 — 8 points apart on a 0–100 scale, and
    // indistinguishable on a ramp whose chroma rides distance from the middle.
    assert.ok(better - worse > 14);
  });

  test(".500 is the neutral and the band is .250–.750", () => {
    assert.equal(winSharePercentile(6, 6), 50);
    assert.equal(winSharePercentile(3, 1), 100);
    assert.equal(winSharePercentile(1, 3), 0);
  });

  test("outside the band it saturates", () => {
    assert.equal(winSharePercentile(13, 0), 100);
    assert.equal(winSharePercentile(0, 13), 0);
  });

  test("a manager who has not played has not lost", () => {
    assert.equal(winSharePercentile(0, 0), 50);
  });
});

describe("median", () => {
  test("the middle of an odd set, and the mean of the middle two of an even one", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });

  test("it does not mutate its argument", () => {
    const all = [3, 1, 2];
    median(all);
    assert.deepEqual(all, [3, 1, 2]);
  });

  test("an empty set has no middle", () => {
    assert.equal(median([]), 0);
  });
});
