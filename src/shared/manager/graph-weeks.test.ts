import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAST_REGULAR_WEEK } from "../projections/weeks.ts";
import {
  collectionWeeks,
  graphWeekCeiling,
  isFinishedSeason,
  leagueGraphWeeks,
  type SyncClock,
} from "./graph-weeks.ts";

/** The offseason clock: Sleeper reports week 0, `flooredWeek` answers 1. */
const OFFSEASON: SyncClock = { currentWeek: 1, activeSeason: "2026" };
/** Mid-season. */
const WEEK_5: SyncClock = { currentWeek: 5, activeSeason: "2026" };

describe("isFinishedSeason", () => {
  test("a season behind the active one is finished", () => {
    assert.equal(isFinishedSeason("2024", "2026"), true);
    assert.equal(isFinishedSeason("2025", "2026"), true);
  });

  test("the active season is not, nor is one ahead of it", () => {
    assert.equal(isFinishedSeason("2026", "2026"), false);
    // Sleeper answers an unknown league year with an empty list; treating that
    // as final would freeze "no leagues yet" for the year before the rollover.
    assert.equal(isFinishedSeason("2027", "2026"), false);
  });

  test("an unreadable season on either side is not finished", () => {
    // The live ceiling, which is what this did before the check existed. Extra
    // fetches are the failure you can see; the other direction stops fetching
    // the weeks a live season is still playing.
    assert.equal(isFinishedSeason("2024", null), false);
    assert.equal(isFinishedSeason(null, "2026"), false);
    assert.equal(isFinishedSeason("", "2026"), false);
    assert.equal(isFinishedSeason("nonsense", "2026"), false);
    assert.equal(isFinishedSeason("2024", "26"), false);
  });
});

describe("graphWeekCeiling", () => {
  test("a live season is bounded by the week being played", () => {
    assert.equal(graphWeekCeiling("2026", WEEK_5), 5);
    assert.equal(graphWeekCeiling("2026", OFFSEASON), 1);
  });

  test("a finished season is bounded by the whole regular season", () => {
    // The bug this module exists for: read off the *app's* week, a 2024 league
    // synced in the 2026 offseason fetched exactly one week of transactions and
    // one of matchups, and mid-season it filled in lockstep with the current
    // week rather than with its own.
    assert.equal(graphWeekCeiling("2024", OFFSEASON), LAST_REGULAR_WEEK);
    assert.equal(graphWeekCeiling("2024", WEEK_5), LAST_REGULAR_WEEK);
  });

  test("an unreadable state leaves the live ceiling", () => {
    const unknown: SyncClock = { currentWeek: 5, activeSeason: null };
    assert.equal(graphWeekCeiling("2024", unknown), 5);
  });
});

describe("collectionWeeks", () => {
  test("nothing stored backfills from week 1", () => {
    assert.deepEqual(collectionWeeks(undefined, 5), { from: 1, to: 5 });
  });

  test("a stored week re-reads the one before it", () => {
    // Late-settling waivers and trades, and the stat corrections that move a
    // closed week's points.
    assert.deepEqual(collectionWeeks(5, 7), { from: 4, to: 7 });
  });

  test("week 1 does not reach for week 0", () => {
    assert.deepEqual(collectionWeeks(1, 3), { from: 1, to: 3 });
  });

  test("a collection ahead of the ceiling is refreshed, not truncated", () => {
    assert.deepEqual(collectionWeeks(9, 5), { from: 8, to: 9 });
  });
});

describe("a past season's backfill", () => {
  test("reaches the end of its own season in one pass", () => {
    const weeks = leagueGraphWeeks("2024", OFFSEASON, {});
    assert.deepEqual(weeks.transactions, { from: 1, to: LAST_REGULAR_WEEK });
    assert.deepEqual(weeks.matchups, { from: 1, to: LAST_REGULAR_WEEK });
  });

  test("does not stall at the week the first pass stored", () => {
    // The regression in full: bounded by the app's week, a first pass stored
    // week 1, the next pass read `max(currentWeek, stored) = 1`, and the league
    // sat there permanently.
    const stalled = { transactions: 1, matchups: 1 };
    assert.equal(
      leagueGraphWeeks("2024", OFFSEASON, stalled).transactions.to,
      LAST_REGULAR_WEEK,
    );
  });
});

describe("leagueGraphWeeks", () => {
  test("gates the two collections on their own stored weeks", () => {
    // Every league stored before matchups existed has transactions through the
    // current week and no matchups at all, so one shared gate would open the
    // window past a whole unfetched season.
    const weeks = leagueGraphWeeks("2026", WEEK_5, { transactions: 5 });
    assert.deepEqual(weeks.transactions, { from: 4, to: 5 });
    assert.deepEqual(weeks.matchups, { from: 1, to: 5 });
  });
});
