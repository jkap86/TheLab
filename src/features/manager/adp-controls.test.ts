import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  adpQueryString,
  defaultAdpControls,
  deriveScoring,
  seasonOptions,
  seedFromLeague,
  type AdpControls,
} from "./adp-controls.ts";
import type { ManagerLeague } from "./types.ts";

const league = (over: Partial<ManagerLeague>): ManagerLeague => ({
  league_id: "1",
  name: "Test League",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: null,
  scoring_settings: null,
  ...over,
});

/** Parse a query string back to a plain object for order-independent asserts. */
const params = (query: string) =>
  Object.fromEntries(new URLSearchParams(query).entries());

describe("adpQueryString", () => {
  test("the default board sends this season, snake+linear, and nothing else", () => {
    const query = params(adpQueryString(defaultAdpControls("2026")));
    assert.deepEqual(query, {
      limit: "1000",
      season: "2026",
      draft_type: "snake,linear",
    });
  });

  test("an 'all' control is omitted, not sent empty", () => {
    // Every league filter left on "all" must drop out entirely.
    const query = params(adpQueryString(defaultAdpControls("2026")));
    for (const key of ["league_type", "scoring", "superflex", "best_ball"]) {
      assert.equal(key in query, false);
    }
  });

  test("league settings map to the route's vocabulary", () => {
    const controls: AdpControls = {
      season: "all",
      draftType: "auction",
      leagueType: "2",
      scoring: "ppr",
      superflex: "yes",
      bestBall: "no",
      teams: "12",
      rounds: "full",
      steepness: "steep",
    };
    assert.deepEqual(params(adpQueryString(controls)), {
      limit: "1000",
      season: "all",
      draft_type: "auction",
      league_type: "dynasty",
      scoring: "ppr",
      superflex: "1",
      best_ball: "0",
      teams_min: "12",
      teams_max: "12",
      rounds_min: "12",
    });
  });

  test("steepness is a value-curve knob, not a board filter — never sent here", () => {
    // It drives the Leagues-tab team value, not which drafts /api/adp averages.
    const flat = adpQueryString({ ...defaultAdpControls("2026"), steepness: "flat" });
    const steep = adpQueryString({ ...defaultAdpControls("2026"), steepness: "steep" });
    assert.equal(flat, steep);
    assert.equal("steepness" in params(flat), false);
  });

  test("the rounds buckets bound one side each, all-rounds neither", () => {
    const round = (rounds: AdpControls["rounds"]) =>
      params(adpQueryString({ ...defaultAdpControls("2026"), rounds }));
    assert.equal("rounds_min" in round("all"), false);
    assert.equal("rounds_max" in round("all"), false);
    assert.deepEqual(
      { min: round("rookie").rounds_min, max: round("rookie").rounds_max },
      { min: undefined, max: "5" },
    );
    assert.deepEqual(
      { min: round("full").rounds_min, max: round("full").rounds_max },
      { min: "12", max: undefined },
    );
  });

  test("a team count binds both bounds to an exact match", () => {
    const query = params(
      adpQueryString({ ...defaultAdpControls("2026"), teams: "10" }),
    );
    assert.equal(query.teams_min, "10");
    assert.equal(query.teams_max, "10");
  });

  test("the three explicit draft types pass through unchanged", () => {
    for (const draftType of ["snake", "linear", "auction"] as const) {
      const query = params(
        adpQueryString({ ...defaultAdpControls("2026"), draftType }),
      );
      assert.equal(query.draft_type, draftType);
    }
  });
});

describe("deriveScoring", () => {
  test("buckets on rec, treating a missing rec as standard", () => {
    assert.equal(deriveScoring(null), "std");
    assert.equal(deriveScoring({}), "std");
    assert.equal(deriveScoring({ rec: 0 }), "std");
    assert.equal(deriveScoring({ rec: 0.5 }), "half_ppr");
    assert.equal(deriveScoring({ rec: 0.75 }), "half_ppr");
    assert.equal(deriveScoring({ rec: 1 }), "ppr");
  });
});

describe("seedFromLeague", () => {
  test("fills the league settings and leaves the rest", () => {
    const base: AdpControls = {
      ...defaultAdpControls("2026"),
      season: "2025",
      draftType: "auction",
      superflex: "yes",
    };
    const seeded = seedFromLeague(
      base,
      league({
        total_rosters: 10,
        settings: { type: 2, best_ball: 1 },
        scoring_settings: { rec: 0.5 },
      }),
    );
    assert.equal(seeded.leagueType, "2");
    assert.equal(seeded.scoring, "half_ppr");
    assert.equal(seeded.bestBall, "yes");
    assert.equal(seeded.teams, "10");
    // Not league settings — left exactly as they were.
    assert.equal(seeded.season, "2025");
    assert.equal(seeded.draftType, "auction");
    assert.equal(seeded.superflex, "yes");
  });

  test("a league Sleeper omits `type` for reads as redraft, lineup", () => {
    const seeded = seedFromLeague(defaultAdpControls("2026"), league({ settings: {} }));
    assert.equal(seeded.leagueType, "0");
    assert.equal(seeded.bestBall, "no");
  });
});

describe("seasonOptions", () => {
  test("offers the viewed season, two before it, and all", () => {
    assert.deepEqual(seasonOptions("2026"), ["2026", "2025", "2024", "all"]);
  });
});
