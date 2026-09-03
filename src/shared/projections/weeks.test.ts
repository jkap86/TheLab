import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  clampWeek,
  isPlausibleWeek,
  LAST_REGULAR_WEEK,
  parseRequestedWeek,
} from "./weeks.ts";

describe("isPlausibleWeek", () => {
  test("accepts the whole regular season and nothing either side", () => {
    assert.equal(isPlausibleWeek(1), true);
    assert.equal(isPlausibleWeek(LAST_REGULAR_WEEK), true);
    assert.equal(isPlausibleWeek(0), false);
    assert.equal(isPlausibleWeek(LAST_REGULAR_WEEK + 1), false);
  });

  test("a week is a whole number", () => {
    assert.equal(isPlausibleWeek(7.5), false);
    assert.equal(isPlausibleWeek(NaN), false);
    assert.equal(isPlausibleWeek(Infinity), false);
  });
});

describe("parseRequestedWeek", () => {
  test("an absent parameter is null — 'not asked', not an error", () => {
    // The only state a caller may fill from a resolver. Everything else is an
    // answer the caller gave.
    assert.equal(parseRequestedWeek(null), null);
  });

  test("a blank parameter is also 'not asked'", () => {
    // `?week=` is a URL builder's artefact rather than anybody's question.
    assert.equal(parseRequestedWeek(""), null);
    assert.equal(parseRequestedWeek("   "), null);
  });

  test("a week reads back as itself", () => {
    assert.deepEqual(parseRequestedWeek("7"), { ok: true, week: 7 });
    assert.deepEqual(parseRequestedWeek(" 18 "), { ok: true, week: 18 });
  });

  test("a non-numeric week is refused, never folded to a default", () => {
    // The whole reason this returns three states: `?week=abc` quietly becoming
    // the current week shows one week's lineup under another week's heading.
    const parsed = parseRequestedWeek("abc");
    assert.equal(parsed?.ok, false);
  });

  test("weeks outside the regular season are refused", () => {
    assert.equal(parseRequestedWeek("0")?.ok, false);
    assert.equal(parseRequestedWeek("19")?.ok, false);
    assert.equal(parseRequestedWeek("-3")?.ok, false);
    assert.equal(parseRequestedWeek("7.5")?.ok, false);
  });
});

describe("clampWeek", () => {
  test("the preseason's week 0 becomes week 1", () => {
    // Sleeper's state answers 0 before the season; the season ahead is whole.
    assert.equal(clampWeek(0), 1);
  });

  test("the postseason folds back to the last regular week", () => {
    assert.equal(clampWeek(22), LAST_REGULAR_WEEK);
  });

  test("an unreadable week is the widest honest answer", () => {
    assert.equal(clampWeek(NaN), 1);
  });
});
