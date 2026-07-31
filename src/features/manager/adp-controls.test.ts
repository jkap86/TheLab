import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  adpQueryString,
  defaultAdpControls,
  deriveScoring,
  rangeBounds,
  rangeLabel,
  rangeSummary,
  seedFromLeague,
  todayIso,
  type AdpControls,
  type AdpRange,
} from "./adp-controls.ts";
import type { ManagerLeague } from "./types.ts";

/** A fixed "today" so the relative presets resolve to asserted dates. */
const TODAY = "2026-07-31";

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
  test("the default board sends the last twelve months, snake+linear, and nothing else", () => {
    const query = params(adpQueryString(defaultAdpControls(), TODAY));
    assert.deepEqual(query, {
      limit: "1000",
      start_after: "2025-07-31",
      draft_type: "snake,linear",
    });
  });

  test("season is never sent — the range replaced it", () => {
    // Sending both would intersect two different cuts of the same drafts.
    for (const preset of ["30d", "12m", "all"] as const) {
      const query = params(
        adpQueryString({ ...defaultAdpControls(), range: { preset, from: null, to: null } }, TODAY),
      );
      assert.equal("season" in query, false);
    }
  });

  test("an unbounded range sends no date at all", () => {
    const all = params(
      adpQueryString(
        { ...defaultAdpControls(), range: { preset: "all", from: null, to: null } },
        TODAY,
      ),
    );
    assert.equal("start_after" in all, false);
    assert.equal("start_before" in all, false);
  });

  test("a custom range sends the ends it has, and only those", () => {
    const query = (range: AdpRange) =>
      params(adpQueryString({ ...defaultAdpControls(), range }, TODAY));

    assert.deepEqual(
      query({ preset: "custom", from: "2026-06-01", to: "2026-07-31" }),
      {
        limit: "1000",
        draft_type: "snake,linear",
        start_after: "2026-06-01",
        start_before: "2026-07-31",
      },
    );
    assert.equal("start_before" in query({ preset: "custom", from: "2026-06-01", to: null }), false);
    assert.equal("start_after" in query({ preset: "custom", from: null, to: "2026-07-31" }), false);
  });

  test("an 'all' control is omitted, not sent empty", () => {
    // Every league filter left on "all" must drop out entirely.
    const query = params(adpQueryString(defaultAdpControls(), TODAY));
    for (const key of ["league_type", "scoring", "superflex", "best_ball"]) {
      assert.equal(key in query, false);
    }
  });

  test("league settings map to the route's vocabulary", () => {
    const controls: AdpControls = {
      range: { preset: "all", from: null, to: null },
      draftType: "auction",
      leagueType: "2",
      scoring: "ppr",
      superflex: "yes",
      bestBall: "no",
      teams: "12",
      rounds: "full",
      steepness: "steep",
    };
    assert.deepEqual(params(adpQueryString(controls, TODAY)), {
      limit: "1000",
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
    const flat = adpQueryString({ ...defaultAdpControls(), steepness: "flat" }, TODAY);
    const steep = adpQueryString({ ...defaultAdpControls(), steepness: "steep" }, TODAY);
    assert.equal(flat, steep);
    assert.equal("steepness" in params(flat), false);
  });

  test("the rounds buckets bound one side each, all-rounds neither", () => {
    const round = (rounds: AdpControls["rounds"]) =>
      params(adpQueryString({ ...defaultAdpControls(), rounds }, TODAY));
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
      adpQueryString({ ...defaultAdpControls(), teams: "10" }, TODAY),
    );
    assert.equal(query.teams_min, "10");
    assert.equal(query.teams_max, "10");
  });

  test("the three explicit draft types pass through unchanged", () => {
    for (const draftType of ["snake", "linear", "auction"] as const) {
      const query = params(
        adpQueryString({ ...defaultAdpControls(), draftType }, TODAY),
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
      ...defaultAdpControls(),
      range: { preset: "custom", from: "2025-05-01", to: null },
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
    assert.deepEqual(seeded.range, { preset: "custom", from: "2025-05-01", to: null });
    assert.equal(seeded.draftType, "auction");
    assert.equal(seeded.superflex, "yes");
  });

  test("a league Sleeper omits `type` for reads as redraft, lineup", () => {
    const seeded = seedFromLeague(defaultAdpControls(), league({ settings: {} }));
    assert.equal(seeded.leagueType, "0");
    assert.equal(seeded.bestBall, "no");
  });
});

describe("rangeBounds", () => {
  test("the relative presets count back from today and end open", () => {
    // Open-ended on purpose: a draft in progress can carry a start time hours
    // ahead, and "last 30 days" shouldn't drop it.
    assert.deepEqual(rangeBounds({ preset: "30d", from: null, to: null }, TODAY), {
      from: "2026-07-01",
      to: null,
    });
    assert.deepEqual(rangeBounds({ preset: "90d", from: null, to: null }, TODAY), {
      from: "2026-05-02",
      to: null,
    });
    assert.deepEqual(rangeBounds({ preset: "12m", from: null, to: null }, TODAY), {
      from: "2025-07-31",
      to: null,
    });
  });

  test("months are calendar months, clamped where the day doesn't exist", () => {
    // Backing up 12 months from a leap day, or from the 31st of a month whose
    // counterpart is shorter, must not roll into the next month — that would
    // silently widen the window by a whole month.
    assert.equal(rangeBounds({ preset: "12m", from: null, to: null }, "2024-02-29").from, "2023-02-28");
    assert.equal(rangeBounds({ preset: "12m", from: null, to: null }, "2026-03-31").from, "2025-03-31");
  });

  test("day arithmetic crosses months and years", () => {
    assert.equal(rangeBounds({ preset: "30d", from: null, to: null }, "2026-01-15").from, "2025-12-16");
  });

  test("all time bounds nothing; custom passes its own ends through", () => {
    assert.deepEqual(rangeBounds({ preset: "all", from: null, to: null }, TODAY), {
      from: null,
      to: null,
    });
    assert.deepEqual(
      rangeBounds({ preset: "custom", from: "2026-06-01", to: "2026-06-30" }, TODAY),
      { from: "2026-06-01", to: "2026-06-30" },
    );
  });
});

describe("rangeLabel", () => {
  test("a preset keeps its name, so it stays true tomorrow", () => {
    assert.equal(rangeLabel({ preset: "90d", from: null, to: null }), "Last 90 days");
    assert.equal(rangeLabel({ preset: "all", from: null, to: null }), "All time");
  });

  test("a custom range spells out the ends it has", () => {
    assert.equal(
      rangeLabel({ preset: "custom", from: "2026-06-01", to: "2026-07-31" }),
      "Jun 1, 2026 – Jul 31, 2026",
    );
    assert.equal(rangeLabel({ preset: "custom", from: "2026-06-01", to: null }), "Since Jun 1, 2026");
    assert.equal(rangeLabel({ preset: "custom", from: null, to: "2026-07-31" }), "Through Jul 31, 2026");
    // Neither end set narrows nothing, so say what it does rather than "Custom".
    assert.equal(rangeLabel({ preset: "custom", from: null, to: null }), "All time");
  });
});

describe("rangeSummary", () => {
  test("says the dates a preset's name doesn't", () => {
    // The label stays "Last 90 days"; inside the scrubber, where the handles
    // are sitting on those dates, the reader shouldn't have to work them back
    // off the axis.
    assert.equal(rangeSummary({ preset: "90d", from: null, to: null }, TODAY), "since May 2, 2026");
    assert.equal(rangeSummary({ preset: "12m", from: null, to: null }, TODAY), "since Jul 31, 2025");
  });

  test("a bounded range reads as its pair, a half-open one as its end", () => {
    const custom = (from: string | null, to: string | null): AdpRange => ({
      preset: "custom",
      from,
      to,
    });
    assert.equal(
      rangeSummary(custom("2026-06-01", "2026-07-31"), TODAY),
      "Jun 1, 2026 – Jul 31, 2026",
    );
    assert.equal(rangeSummary(custom(null, "2026-07-31"), TODAY), "up to Jul 31, 2026");
  });

  test("an unbounded range has nothing to add", () => {
    // "All time" needs no gloss, and null is what the caller skips rendering.
    assert.equal(rangeSummary({ preset: "all", from: null, to: null }, TODAY), null);
    assert.equal(rangeSummary({ preset: "custom", from: null, to: null }, TODAY), null);
  });
});

describe("todayIso", () => {
  test("formats the local date, not the UTC one", () => {
    // Late evening in a western zone is already tomorrow in UTC; the reader's
    // "last 30 days" should start from the date on their calendar.
    assert.equal(todayIso(new Date(2026, 6, 31, 23, 30)), "2026-07-31");
    assert.equal(todayIso(new Date(2026, 0, 5, 0, 15)), "2026-01-05");
  });
});
