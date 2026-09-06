import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SIMILARITY_ANCHOR_PERCENT,
  SIMILARITY_DECAY_MAX,
  SIMILARITY_DECAY_MIN,
  SIMILARITY_FALLBACK_DECAY,
  SIMILARITY_MIN_SAMPLE,
  calibrateSimilarity,
  quantile,
  similarityPercent,
} from "./similarity.ts";

/** A spread of distances big enough to calibrate against. */
const spread = (n = 40) => Array.from({ length: n }, (_, i) => i / 10);

describe("calibrateSimilarity", () => {
  test("anchors the pool's median distance to the anchor percentage", () => {
    const distances = spread();
    const scale = calibrateSimilarity(distances);
    assert.equal(scale.calibrated, true);
    assert.equal(scale.sample, distances.length);
    assert.ok(scale.anchor !== null);
    assert.equal(scale.percent(scale.anchor!), SIMILARITY_ANCHOR_PERCENT);
    // An exact match is still 100 whatever the pool looks like: the absolute
    // reading is the thing a bare percentile would have thrown away.
    assert.equal(scale.percent(0), 100);
  });

  test("the decay follows the pool rather than a constant", () => {
    // Two pools with the same shape and different spread must not produce the
    // same curve — that was the whole fault of a hand-tuned constant.
    const tight = calibrateSimilarity(spread().map((d) => d / 10));
    const wide = calibrateSimilarity(spread().map((d) => d * 10));
    assert.ok(tight.decay > wide.decay);
    assert.notEqual(tight.decay, SIMILARITY_FALLBACK_DECAY);
    assert.notEqual(wide.decay, SIMILARITY_FALLBACK_DECAY);
  });

  test("monotonic: a nearer distance never reads lower", () => {
    const scale = calibrateSimilarity(spread());
    let previous = 101;
    for (let d = 0; d <= 20; d += 0.05) {
      const percent = scale.percent(d);
      assert.ok(percent <= previous, `at ${d}: ${percent} > ${previous}`);
      previous = percent;
    }
  });

  test("bounded 0–100 over anything a distance can be", () => {
    const scale = calibrateSimilarity(spread());
    for (const d of [0, 0.001, 1, 1000, 1e12, -1, NaN, Infinity, -Infinity]) {
      const percent = scale.percent(d);
      assert.ok(Number.isInteger(percent), `${d} -> ${percent}`);
      assert.ok(percent >= 0 && percent <= 100, `${d} -> ${percent}`);
    }
  });

  test("ties read the same, and a pool of ties falls back rather than dividing by nothing", () => {
    const scale = calibrateSimilarity(spread());
    assert.equal(scale.percent(1.25), scale.percent(1.25));

    // Every row an exact match: the median is 0, so there is no spread to
    // anchor to and the documented fallback answers instead.
    const allZero = calibrateSimilarity(Array(30).fill(0));
    assert.equal(allZero.calibrated, false);
    assert.equal(allZero.decay, SIMILARITY_FALLBACK_DECAY);
    assert.equal(allZero.percent(0), 100);

    // More than half exact matches is the same case.
    const mostlyZero = calibrateSimilarity([...Array(20).fill(0), 1, 2, 3]);
    assert.equal(mostlyZero.calibrated, false);
  });

  test("a pool too small to calibrate falls back and says so", () => {
    for (let n = 0; n < SIMILARITY_MIN_SAMPLE; n++) {
      const scale = calibrateSimilarity(spread(n));
      assert.equal(scale.calibrated, false, `${n} distances`);
      assert.equal(scale.decay, SIMILARITY_FALLBACK_DECAY);
      assert.equal(scale.anchor, null);
      assert.equal(scale.sample, n);
    }
    assert.equal(calibrateSimilarity(spread(SIMILARITY_MIN_SAMPLE)).calibrated, true);
  });

  test("non-finite and negative distances are not part of the sample", () => {
    const scale = calibrateSimilarity([...spread(10), NaN, Infinity, -1]);
    assert.equal(scale.sample, 10);
  });

  test("a degenerate distribution is clamped rather than allowed to read as all-or-nothing", () => {
    const tiny = calibrateSimilarity(Array.from({ length: 30 }, (_, i) => (i + 1) * 1e-12));
    assert.ok(tiny.decay <= SIMILARITY_DECAY_MAX);
    const huge = calibrateSimilarity(Array.from({ length: 30 }, (_, i) => (i + 1) * 1e12));
    assert.ok(huge.decay >= SIMILARITY_DECAY_MIN);
  });
});

describe("similarityPercent", () => {
  test("100 at zero distance, falling on the decay it is given", () => {
    assert.equal(similarityPercent(0), 100);
    // The old sample-corpus constant, kept as the fallback and named as one.
    assert.equal(similarityPercent(1, SIMILARITY_FALLBACK_DECAY), 54);
    assert.ok(similarityPercent(3) < similarityPercent(2));
  });

  test("nothing unprintable reaches a card", () => {
    assert.equal(similarityPercent(NaN), 0);
    assert.equal(similarityPercent(Infinity), 0);
    assert.equal(similarityPercent(-5), 100);
  });
});

describe("quantile", () => {
  test("interpolates between the two straddling values", () => {
    assert.equal(quantile([0, 1, 2, 3], 0.5), 1.5);
    assert.equal(quantile([0, 10], 0.5), 5);
    assert.equal(quantile([0, 1, 2], 0.5), 1);
  });

  test("the ends and the degenerate cases", () => {
    assert.equal(quantile([1, 2, 3], 0), 1);
    assert.equal(quantile([1, 2, 3], 1), 3);
    assert.equal(quantile([7], 0.5), 7);
    assert.ok(Number.isNaN(quantile([], 0.5)));
    // Out-of-range quantiles clamp rather than indexing off the end.
    assert.equal(quantile([1, 2, 3], -1), 1);
    assert.equal(quantile([1, 2, 3], 2), 3);
  });
});
