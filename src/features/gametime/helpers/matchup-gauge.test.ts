import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { matchupGauge } from "./matchup-gauge.ts";

describe("matchupGauge", () => {
  test("both sides read off one scale, with the design's own numbers", () => {
    const gauge = matchupGauge(
      { scored: 96.4, live: 128.7 },
      { scored: 88.1, live: 121.9 },
      { scored: 84.6, live: 118.3 },
    );
    // max = 128.7 * 1.05 = 135.135
    assert.equal(round(gauge.mine.ghost), 95.2);
    assert.equal(round(gauge.mine.live), 71.3);
    assert.equal(round(gauge.theirs.ghost), 90.2);
    assert.equal(round(gauge.theirs.live), 65.2);
    assert.equal(round(gauge.median!), 87.5);
  });

  test("the leading bar keeps its headroom", () => {
    const gauge = matchupGauge({ scored: 100, live: 100 }, { scored: 0, live: 50 }, null);
    assert.ok(gauge.mine.ghost < 100);
    assert.equal(round(gauge.mine.ghost), 95.2);
  });

  test("a median above both sides still sets the scale, so its tick stays on the track", () => {
    const gauge = matchupGauge(
      { scored: 0, live: 90 },
      { scored: 0, live: 95 },
      { scored: 0, live: 140 },
    );
    assert.ok(gauge.median! < 100);
    assert.equal(round(gauge.median!), 95.2);
    // And both sides shrink against it rather than running full.
    assert.equal(round(gauge.mine.ghost), 61.2);
  });

  test("no median is null rather than a tick at zero", () => {
    assert.equal(matchupGauge({ scored: 1, live: 2 }, { scored: 1, live: 2 }, null).median, null);
  });

  test("a week nobody projected draws empty rather than NaN", () => {
    const gauge = matchupGauge({ scored: 0, live: 0 }, { scored: 0, live: 0 }, null);
    assert.equal(gauge.mine.ghost, 0);
    assert.equal(gauge.mine.live, 0);
    assert.equal(gauge.theirs.live, 0);
  });

  test("a median with no scale to sit on is not placed at all", () => {
    const gauge = matchupGauge(
      { scored: 0, live: 0 },
      { scored: 0, live: 0 },
      { scored: 0, live: 0 },
    );
    assert.equal(gauge.median, null);
  });

  test("a median of zero on a real scale is still a place", () => {
    const gauge = matchupGauge(
      { scored: 50, live: 100 },
      { scored: 40, live: 90 },
      { scored: 0, live: 0 },
    );
    assert.equal(gauge.median, 0);
  });

  test("a negative score is empty, and a negative scale flips nothing", () => {
    const gauge = matchupGauge({ scored: -4, live: 110 }, { scored: -9, live: -2 }, null);
    assert.equal(gauge.mine.live, 0);
    assert.equal(gauge.theirs.live, 0);
    assert.equal(gauge.theirs.ghost, 0);
    assert.equal(round(gauge.mine.ghost), 95.2);
  });

  test("a scale made only of negatives draws nothing at all", () => {
    const gauge = matchupGauge({ scored: -4, live: -3 }, { scored: -9, live: -8 }, null);
    assert.equal(gauge.mine.ghost, 0);
    assert.equal(gauge.theirs.ghost, 0);
  });
});

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
