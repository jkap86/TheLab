import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAST_REGULAR_WEEK, parseWeeks, targetWeeks } from "./weeks.ts";

describe("targetWeeks", () => {
  test("follows display_week during the season, plus the next", () => {
    assert.deepEqual(targetWeeks({ week: 6, display_week: 7 }), [7, 8]);
  });

  test("uses display_week in the offseason, when week is 0", () => {
    // Projections for week 1 exist months before kickoff, so an offseason state
    // (week 0, display_week 1) should still have something to sync.
    assert.deepEqual(targetWeeks({ week: 0, display_week: 1 }), [1, 2]);
  });

  test("falls back to week when display_week is missing or 0", () => {
    assert.deepEqual(targetWeeks({ week: 4, display_week: 0 }), [4, 5]);
  });

  test("defaults to week 1 when NFL state is unavailable", () => {
    assert.deepEqual(targetWeeks(null), [1, 2]);
  });

  test("never looks past the last regular-season week", () => {
    assert.deepEqual(targetWeeks({ week: 18, display_week: 18 }), [LAST_REGULAR_WEEK]);
    // Playoff weeks report past 18; projections stop there.
    assert.deepEqual(targetWeeks({ week: 21, display_week: 21 }), [LAST_REGULAR_WEEK]);
  });

  test("honours the lookahead, including zero", () => {
    assert.deepEqual(targetWeeks({ week: 3, display_week: 3 }, 0), [3]);
    assert.deepEqual(targetWeeks({ week: 3, display_week: 3 }, 3), [3, 4, 5, 6]);
    assert.deepEqual(targetWeeks({ week: 3, display_week: 3 }, -1), [3]);
  });
});

describe("parseWeeks", () => {
  test("accepts repeated params and comma lists alike", () => {
    assert.deepEqual(parseWeeks(["1", "2"]), { ok: true, weeks: [1, 2] });
    assert.deepEqual(parseWeeks(["1,2"]), { ok: true, weeks: [1, 2] });
    assert.deepEqual(parseWeeks([" 3 , 4 "]), { ok: true, weeks: [3, 4] });
  });

  test("no values means unspecified, not empty", () => {
    assert.deepEqual(parseWeeks([]), { ok: true, weeks: [] });
    assert.deepEqual(parseWeeks([""]), { ok: true, weeks: [] });
  });

  test("dedupes while preserving order", () => {
    assert.deepEqual(parseWeeks(["5,5,2"]), { ok: true, weeks: [5, 2] });
  });

  test("rejects anything that isn't a week number", () => {
    for (const bad of ["0", "19", "-1", "1.5", "abc", "1e2"]) {
      const result = parseWeeks([bad]);
      assert.equal(result.ok, false, `expected "${bad}" to be rejected`);
    }
  });
});
