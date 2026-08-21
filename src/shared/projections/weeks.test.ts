import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  horizonWeeks,
  LAST_REGULAR_WEEK,
  parseWeeks,
  MAX_REQUESTED_WEEKS,
  regularSeasonWeek,
  targetWeeks,
} from "./weeks.ts";

describe("regularSeasonWeek", () => {
  test("reads display_week only when the regular season is what is being played", () => {
    assert.equal(regularSeasonWeek({ week: 6, display_week: 7, season_type: "regular" }), 7);
    assert.equal(regularSeasonWeek({ week: 4, display_week: 0, season_type: "regular" }), 4);
  });

  test("preseason week N is not regular-season week N", () => {
    // The production failure: `{week: 2, display_week: 2, season_type: "pre"}`
    // is the second week of August, while regular-season week 1 has not been
    // played. Reading it unqualified walks the near window past week 1 and
    // strands it — before the window, so `horizonWeeks` treats it as past.
    assert.equal(regularSeasonWeek({ week: 2, display_week: 2, season_type: "pre" }), 1);
    assert.equal(regularSeasonWeek({ week: 4, display_week: 4, season_type: "pre" }), 1);
  });

  test("the offseason, an unknown label and no state all answer week 1", () => {
    assert.equal(regularSeasonWeek({ week: 0, display_week: 1, season_type: "off" }), 1);
    assert.equal(regularSeasonWeek({ week: 9, display_week: 9, season_type: "wat" }), 1);
    assert.equal(regularSeasonWeek(null), 1);
  });

  test("the postseason still names a regular-season week, for the clamp above it", () => {
    // "post" reports 19+, which `targetWeeks` clamps to 18. Forcing it to 1
    // instead would put the sync back on weeks nobody can still play.
    assert.equal(regularSeasonWeek({ week: 21, display_week: 21, season_type: "post" }), 21);
  });
});

describe("targetWeeks", () => {
  test("follows display_week during the season, plus the next two", () => {
    assert.deepEqual(
      targetWeeks({ week: 6, display_week: 7, season_type: "regular" }),
      [7, 8, 9],
    );
  });

  test("covers week 1 onward through the whole preseason", () => {
    // Not [2, 3, 4]: the near window must not advance on a preseason week, or
    // week 1 falls out of both tiers before its first game is played.
    for (const week of [1, 2, 3, 4]) {
      assert.deepEqual(
        targetWeeks({ week, display_week: week, season_type: "pre" }),
        [1, 2, 3],
        `preseason week ${week}`,
      );
    }
  });

  test("uses week 1 in the offseason, when week is 0", () => {
    // Projections for week 1 exist months before kickoff, so an offseason state
    // should still have something to sync.
    assert.deepEqual(targetWeeks({ week: 0, display_week: 1, season_type: "off" }), [1, 2, 3]);
  });

  test("falls back to week when display_week is missing or 0", () => {
    assert.deepEqual(
      targetWeeks({ week: 4, display_week: 0, season_type: "regular" }),
      [4, 5, 6],
    );
  });

  test("defaults to week 1 when NFL state is unavailable", () => {
    assert.deepEqual(targetWeeks(null), [1, 2, 3]);
  });

  test("never looks past the last regular-season week", () => {
    assert.deepEqual(
      targetWeeks({ week: 18, display_week: 18, season_type: "regular" }),
      [LAST_REGULAR_WEEK],
    );
    // Playoff weeks report past 18; projections stop there.
    assert.deepEqual(
      targetWeeks({ week: 21, display_week: 21, season_type: "post" }),
      [LAST_REGULAR_WEEK],
    );
    // The clamp applies to the lookahead's tail, not only to its head.
    assert.deepEqual(
      targetWeeks({ week: 17, display_week: 17, season_type: "regular" }),
      [17, LAST_REGULAR_WEEK],
    );
  });

  test("honours the lookahead, including zero", () => {
    const state = { week: 3, display_week: 3, season_type: "regular" };
    assert.deepEqual(targetWeeks(state, 0), [3]);
    assert.deepEqual(targetWeeks(state, 3), [3, 4, 5, 6]);
    assert.deepEqual(targetWeeks(state, -1), [3]);
  });
});

describe("horizonWeeks", () => {
  test("picks up where targetWeeks leaves off, through week 18", () => {
    const state = { week: 6, display_week: 7, season_type: "regular" };
    assert.deepEqual(targetWeeks(state), [7, 8, 9]);
    assert.deepEqual(horizonWeeks(state), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  test("covers the whole season from the offseason", () => {
    // The case that matters: in July every week past the first three is horizon,
    // and Sleeper has already published all of them.
    const state = { week: 0, display_week: 1, season_type: "off" };
    assert.equal(horizonWeeks(state).length, 15);
    assert.deepEqual(horizonWeeks(state)[0], 4);
  });

  test("never strands week 1 during the preseason", () => {
    // The other half of the production failure. With the near window on [2,3,4],
    // week 1 was in neither list — and a week before the near window is a week
    // this sync never fetches again.
    const state = { week: 2, display_week: 2, season_type: "pre" };
    const covered = new Set([...targetWeeks(state), ...horizonWeeks(state)]);
    for (let week = 1; week <= LAST_REGULAR_WEEK; week++) {
      assert.ok(covered.has(week), `week ${week} is in neither tier`);
    }
  });

  test("never overlaps the near window", () => {
    for (const week of [1, 5, 12, 17, 18]) {
      const state = { week, display_week: week, season_type: "regular" };
      const near = new Set(targetWeeks(state));
      assert.ok(
        horizonWeeks(state).every((w) => !near.has(w)),
        `week ${week} overlaps`,
      );
    }
  });

  test("is empty once the near window reaches the end of the season", () => {
    assert.deepEqual(horizonWeeks({ week: 18, display_week: 18, season_type: "regular" }), []);
    assert.deepEqual(horizonWeeks({ week: 21, display_week: 21, season_type: "post" }), []);
    // A lookahead wide enough to swallow the season leaves nothing behind it.
    assert.deepEqual(
      horizonWeeks({ week: 1, display_week: 1, season_type: "regular" }, LAST_REGULAR_WEEK),
      [],
    );
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
