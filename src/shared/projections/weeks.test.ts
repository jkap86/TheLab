import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  horizonWeeks,
  LAST_REGULAR_WEEK,
  parseWeeks,
  MAX_REQUESTED_WEEKS,
  targetWeeks,
} from "./weeks.ts";

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

describe("horizonWeeks", () => {
  test("picks up where targetWeeks leaves off, through week 18", () => {
    const state = { week: 6, display_week: 7 };
    assert.deepEqual(targetWeeks(state), [7, 8]);
    assert.deepEqual(horizonWeeks(state), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  test("covers the whole season from the offseason", () => {
    // The case that matters: in July every week past the first two is horizon,
    // and Sleeper has already published all of them.
    assert.equal(horizonWeeks({ week: 0, display_week: 1 }).length, 16);
    assert.deepEqual(horizonWeeks({ week: 0, display_week: 1 })[0], 3);
  });

  test("never overlaps the near window", () => {
    for (const week of [1, 5, 12, 17, 18]) {
      const state = { week, display_week: week };
      const near = new Set(targetWeeks(state));
      assert.ok(
        horizonWeeks(state).every((w) => !near.has(w)),
        `week ${week} overlaps`,
      );
    }
  });

  test("is empty once the near window reaches the end of the season", () => {
    assert.deepEqual(horizonWeeks({ week: 18, display_week: 18 }), []);
    assert.deepEqual(horizonWeeks({ week: 21, display_week: 21 }), []);
    // A lookahead wide enough to swallow the season leaves nothing behind it.
    assert.deepEqual(horizonWeeks({ week: 1, display_week: 1 }, LAST_REGULAR_WEEK), []);
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

  test("the whole regular season is requestable, and nothing beyond it", () => {
    const all = Array.from({ length: MAX_REQUESTED_WEEKS }, (_, i) => String(i + 1));
    assert.equal(parseWeeks(all).ok, true);
  });

  test("rejects more weeks than the cap allows", () => {
    // Each week is a ~5.6MB download held under one advisory lock, so an
    // over-long list is refused rather than discovered an hour in.
    const result = parseWeeks(["1,2,3,4"], 3);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /at most 3 week/);
  });

  test("the cap is counted after deduplication", () => {
    // `?week=1,1,1,1` names one week's work however long the string is.
    assert.deepEqual(parseWeeks(["1,1,1,1"], 1), { ok: true, weeks: [1] });
  });
});
