import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatPoints, formatRecord } from "./format.ts";

describe("formatRecord", () => {
  test("omits ties when there are none", () => {
    assert.equal(formatRecord({ wins: 9, losses: 4, ties: 0 }), "9-4");
  });

  test("includes ties when there are any", () => {
    assert.equal(formatRecord({ wins: 9, losses: 4, ties: 1 }), "9-4-1");
  });

  test("handles an unplayed season", () => {
    assert.equal(formatRecord({ wins: 0, losses: 0, ties: 0 }), "0-0");
  });
});

describe("formatPoints", () => {
  test("always shows two decimals so columns stay aligned", () => {
    assert.equal(formatPoints(1234.5), "1,234.50");
    assert.equal(formatPoints(0), "0.00");
  });

  test("rounds to two decimals", () => {
    assert.equal(formatPoints(99.999), "100.00");
  });
});
