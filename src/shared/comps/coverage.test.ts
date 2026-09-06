import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COVERAGE_EPSILON,
  MIN_WEIGHTED_COVERAGE,
  meetsMinimumCoverage,
  weightedCoverage,
} from "./coverage.ts";

describe("weightedCoverage", () => {
  test("is the available share of the comparable weight", () => {
    // The section's own example: PPG at 2, target share at 1, YPRR at 1, and a
    // candidate who has the first two.
    assert.equal(weightedCoverage(3, 4), 0.75);
    assert.equal(weightedCoverage(4, 4), 1);
    assert.equal(weightedCoverage(1, 4), 0.25);
  });

  test("a comparable weight of zero is a coverage of zero, never a division", () => {
    // Nothing the subject can be read on is nothing to have a coverage of.
    assert.equal(weightedCoverage(0, 0), 0);
    assert.equal(weightedCoverage(2, 0), 0);
    assert.equal(Number.isFinite(weightedCoverage(1, 0)), true);
  });

  test("nothing available is zero, and nothing escapes the 0–1 range", () => {
    assert.equal(weightedCoverage(0, 4), 0);
    // A float that overshoots by a representation is still full coverage, not
    // more than full.
    assert.equal(weightedCoverage(4.0000001, 4), 1);
    assert.equal(weightedCoverage(NaN, 4), 0);
    assert.equal(weightedCoverage(4, NaN), 0);
    assert.equal(weightedCoverage(4, Infinity), 0);
  });
});

describe("meetsMinimumCoverage", () => {
  test("the boundary passes", () => {
    assert.equal(meetsMinimumCoverage(MIN_WEIGHTED_COVERAGE), true);
    assert.equal(meetsMinimumCoverage(1), true);
  });

  test("below it does not", () => {
    assert.equal(meetsMinimumCoverage(MIN_WEIGHTED_COVERAGE - 0.01), false);
    assert.equal(meetsMinimumCoverage(0), false);
  });

  test("a float one representation short of the boundary still passes", () => {
    // Three pairs of weight 1.4 out of four is the boundary written the way
    // the rails actually produce it — a weight is summed pair by pair — and in
    // binary that sum is 4.199999999999999 over 5.6, which is
    // 0.7499999999999999. This is the case the epsilon exists for, and
    // without it the reader would watch a comp vanish on a rail step that
    // changed nothing they can see.
    const available = 1.4 + 1.4 + 1.4;
    const comparable = 1.4 * 4;
    const coverage = weightedCoverage(available, comparable);
    assert.ok(coverage < MIN_WEIGHTED_COVERAGE, "the float really is short");
    assert.equal(meetsMinimumCoverage(coverage), true);
  });

  test("the epsilon is far smaller than any weight step, so it cannot let a real shortfall through", () => {
    assert.ok(COVERAGE_EPSILON < 1e-6);
    assert.equal(meetsMinimumCoverage(MIN_WEIGHTED_COVERAGE - 1e-6), false);
  });

  test("the minimum is a caller's where one is given", () => {
    assert.equal(meetsMinimumCoverage(0.5, 0.5), true);
    assert.equal(meetsMinimumCoverage(0.5, 0.6), false);
  });
});
