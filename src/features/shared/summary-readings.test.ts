import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSummaryReadings } from "./summary-readings.ts";

test("the fold is the default: nothing stored reads as folded", () => {
  assert.equal(parseSummaryReadings(null), false);
  assert.equal(parseSummaryReadings(""), false);
});

test("only the literal the store writes reads as shown", () => {
  assert.equal(parseSummaryReadings("1"), true);
  assert.equal(parseSummaryReadings("0"), false);
});

test("a stale or hand-edited value falls back to the fold, never to Boolean()", () => {
  assert.equal(parseSummaryReadings("true"), false);
  assert.equal(parseSummaryReadings("yes"), false);
  assert.equal(parseSummaryReadings("01"), false);
});
