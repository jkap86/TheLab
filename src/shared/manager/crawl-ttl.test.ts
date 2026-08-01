import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DRAFT_SEASON_LEAGUE_TTL_MS,
  DRAFT_SEASON_WINDOW_DAYS,
  leagueCrawlTtl,
  OFFSEASON_LEAGUE_TTL_MS,
  REGULAR_SEASON_LEAGUE_TTL_MS,
} from "./crawl-ttl.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

// Everything is measured against one UTC-midnight kickoff, with `nowMs`
// injected as arithmetic on it, so the boundaries hold in any timezone on any
// day the suite runs.
const KICKOFF = "2026-09-04";
const kickoffMs = Date.parse(KICKOFF);

const at = (daysBeforeKickoff: number) => kickoffMs - daysBeforeKickoff * DAY_MS;

describe("leagueCrawlTtl", () => {
  test("the regular season takes the 15-minute tier", () => {
    const { ttlMs, tier } = leagueCrawlTtl(
      { season_type: "regular", season_start_date: KICKOFF },
      at(-30),
    );
    assert.equal(ttlMs, REGULAR_SEASON_LEAGUE_TTL_MS);
    assert.equal(tier, "regular");
  });

  test("regular season needs no start date", () => {
    // The short-circuit must not depend on the undocumented field.
    const { ttlMs } = leagueCrawlTtl({ season_type: "regular" }, at(0));
    assert.equal(ttlMs, REGULAR_SEASON_LEAGUE_TTL_MS);
  });

  test("the window before kickoff is draft season, inclusive at both ends", () => {
    for (const days of [DRAFT_SEASON_WINDOW_DAYS, 74, 40, 1, 0]) {
      const { ttlMs, tier } = leagueCrawlTtl(
        { season_type: "pre", season_start_date: KICKOFF },
        at(days),
      );
      assert.equal(ttlMs, DRAFT_SEASON_LEAGUE_TTL_MS, `${days} days out`);
      assert.equal(tier, "draft");
    }
  });

  test("season_type does not gate the draft window", () => {
    // Sleeper labels most of the offseason "off" and flips to "pre" only around
    // the preseason games, so late July — squarely draft season — arrives as
    // "off". The window decides; the label doesn't.
    const { tier } = leagueCrawlTtl(
      { season_type: "off", season_start_date: KICKOFF },
      at(35),
    );
    assert.equal(tier, "draft");
  });

  test("beyond the window is the offseason tier", () => {
    for (const days of [DRAFT_SEASON_WINDOW_DAYS + 1, 120, 300]) {
      const { ttlMs, tier } = leagueCrawlTtl(
        { season_type: "off", season_start_date: KICKOFF },
        at(days),
      );
      assert.equal(ttlMs, OFFSEASON_LEAGUE_TTL_MS, `${days} days out`);
      assert.equal(tier, "offseason");
    }
  });

  test("the postseason is offseason-slow, via its months-past kickoff", () => {
    const { ttlMs, tier } = leagueCrawlTtl(
      { season_type: "post", season_start_date: KICKOFF },
      at(-130),
    );
    assert.equal(ttlMs, OFFSEASON_LEAGUE_TTL_MS);
    assert.equal(tier, "offseason");
  });

  test("an unknown season type with a distant kickoff is offseason", () => {
    const { tier } = leagueCrawlTtl(
      { season_type: "postseason?", season_start_date: KICKOFF },
      at(200),
    );
    assert.equal(tier, "offseason");
  });

  test("a missing or unparseable date fails toward freshness", () => {
    // A stale cache is the failure that hides; extra fetches are the one that
    // doesn't. Note "2026-13-01" is genuinely NaN where a fake *day* is not —
    // see the rollover test below.
    const cases = [
      null,
      { season_type: "off" },
      { season_type: "off", season_start_date: null },
      { season_type: "off", season_start_date: "" },
      { season_type: "off", season_start_date: "garbage" },
      { season_type: "off", season_start_date: "2026-13-01" },
    ];
    for (const state of cases) {
      const { ttlMs, tier } = leagueCrawlTtl(state, at(35));
      assert.equal(ttlMs, REGULAR_SEASON_LEAGUE_TTL_MS, JSON.stringify(state));
      assert.equal(tier, "regular");
    }
  });

  test("an out-of-range day is a real date to V8, and takes that date's tier", () => {
    // V8 rolls 2026-02-31 forward to March 3 rather than failing — the same
    // trap isIsoDate round-trips to catch. Here it is pinned, not caught: the
    // fail-safe is for dates that don't parse, and "fixing" it to reject this
    // shape would reject nothing V8 agrees is invalid.
    const rolled = Date.parse("2026-02-31");
    assert.equal(rolled, Date.parse("2026-03-03"));

    const { tier } = leagueCrawlTtl(
      { season_type: "off", season_start_date: "2026-02-31" },
      rolled - 10 * DAY_MS,
    );
    assert.equal(tier, "draft");
  });

  test("a kickoff already past is not the draft window", () => {
    // Date-only parses are UTC midnight, so kickoff day drifts negative within
    // hours; until Sleeper flips to "regular" that reads as offseason. Brief
    // and accepted — the window's floor stays at zero.
    const { tier } = leagueCrawlTtl(
      { season_type: "pre", season_start_date: KICKOFF },
      at(-1),
    );
    assert.equal(tier, "offseason");
  });
});
