import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatRank,
  metricFillClass,
  metricToneClass,
  ordinal,
  rankFill,
} from "./lineup-metrics.ts";

describe("ordinal", () => {
  test("the usual suffixes", () => {
    assert.equal(ordinal(1), "1st");
    assert.equal(ordinal(2), "2nd");
    assert.equal(ordinal(3), "3rd");
    assert.equal(ordinal(4), "4th");
    assert.equal(ordinal(10), "10th");
  });

  test("11 through 13 take th regardless of their last digit", () => {
    assert.equal(ordinal(11), "11th");
    assert.equal(ordinal(12), "12th");
    assert.equal(ordinal(13), "13th");
    assert.equal(ordinal(111), "111th");
    assert.equal(ordinal(112), "112th");
  });

  test("the teens rule stops at the teens", () => {
    assert.equal(ordinal(21), "21st");
    assert.equal(ordinal(22), "22nd");
    assert.equal(ordinal(23), "23rd");
    assert.equal(ordinal(101), "101st");
  });
});

describe("formatRank", () => {
  test("a rank reads as ordinal of field size", () => {
    assert.equal(formatRank({ rank: 2, of: 12 }), "2nd of 12");
  });

  test("null is the em dash, for absent and degenerate alike", () => {
    assert.equal(formatRank(null), "—");
  });
});

describe("rankFill", () => {
  test("the ends of the scale are actually reached", () => {
    // The whole reason the divisor is `of - 1`: on `rank / of` these would be
    // 92% and 8%, and a bar that never fills or empties reads as broken.
    assert.equal(rankFill({ rank: 1, of: 12 }), 100);
    assert.equal(rankFill({ rank: 12, of: 12 }), 0);
  });

  test("the middle sits where the position does", () => {
    assert.equal(rankFill({ rank: 6, of: 11 }), 50);
  });

  test("nothing to show draws empty", () => {
    assert.equal(rankFill(null), 0);
    // One roster has no spread; dividing by `of - 1` would be a division by
    // zero rather than a full bar.
    assert.equal(rankFill({ rank: 1, of: 1 }), 0);
  });
});

describe("metric tone", () => {
  test("the two families take two colours, and the pair agree", () => {
    assert.equal(metricToneClass("ros_starters"), "text-active");
    assert.equal(metricFillClass("ros_starters"), "bg-active");
    assert.equal(metricToneClass("capital_total"), "text-metric-secondary");
    assert.equal(metricFillClass("capital_total"), "bg-metric-secondary");
  });
});
