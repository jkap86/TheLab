import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_LEAGUE_FILTERS, matchesFilters } from "./filters.ts";
import type { ManagerLeague } from "./types.ts";

/**
 * The filters read Sleeper's `settings` blob, which is loosely typed and omits
 * defaults — so the interesting cases are the missing and wrong-typed fields.
 */
const league = (settings: Record<string, unknown> | null): ManagerLeague => ({
  league_id: "1",
  name: "Test League",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings,
  scoring_settings: null,
});

describe("matchesFilters", () => {
  test("the default filters admit everything", () => {
    for (const l of [league(null), league({}), league({ type: 2, best_ball: 1 })]) {
      assert.equal(matchesFilters(l, DEFAULT_LEAGUE_FILTERS), true);
    }
  });

  test("matches an explicit league type", () => {
    const dynasty = league({ type: 2 });
    assert.equal(matchesFilters(dynasty, { type: "2", bestBall: "all" }), true);
    assert.equal(matchesFilters(dynasty, { type: "1", bestBall: "all" }), false);
  });

  test("treats a missing type as redraft, which Sleeper omits", () => {
    for (const l of [league({}), league(null)]) {
      assert.equal(matchesFilters(l, { type: "0", bestBall: "all" }), true);
      assert.equal(matchesFilters(l, { type: "2", bestBall: "all" }), false);
    }
  });

  test("ignores a non-numeric type rather than trusting it", () => {
    // Falls back to the missing-field default (redraft), not a coerced match.
    const odd = league({ type: "2" });
    assert.equal(matchesFilters(odd, { type: "2", bestBall: "all" }), false);
    assert.equal(matchesFilters(odd, { type: "0", bestBall: "all" }), true);
  });

  test("splits best ball from lineup leagues", () => {
    const bestBall = league({ best_ball: 1 });
    const lineup = league({ best_ball: 0 });

    assert.equal(matchesFilters(bestBall, { type: "all", bestBall: "yes" }), true);
    assert.equal(matchesFilters(bestBall, { type: "all", bestBall: "no" }), false);
    assert.equal(matchesFilters(lineup, { type: "all", bestBall: "yes" }), false);
    assert.equal(matchesFilters(lineup, { type: "all", bestBall: "no" }), true);
  });

  test("treats a missing best_ball as a lineup league", () => {
    assert.equal(matchesFilters(league({}), { type: "all", bestBall: "no" }), true);
    assert.equal(matchesFilters(league({}), { type: "all", bestBall: "yes" }), false);
  });

  test("requires every active filter to pass", () => {
    const dynastyBestBall = league({ type: 2, best_ball: 1 });
    assert.equal(matchesFilters(dynastyBestBall, { type: "2", bestBall: "yes" }), true);
    assert.equal(matchesFilters(dynastyBestBall, { type: "2", bestBall: "no" }), false);
    assert.equal(matchesFilters(dynastyBestBall, { type: "1", bestBall: "yes" }), false);
  });
});
