import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatRank, ordinal } from "./lineup-metrics.ts";

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
