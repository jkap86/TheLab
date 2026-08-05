import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MONTH_ABBREVIATIONS,
  formatRangeDate,
  formatRangeMonth,
  shiftDays,
  shiftMonths,
  todayIso,
} from "./date-range.ts";

/**
 * The date vocabulary both range controls share — the ADP drawer's window over
 * crawled drafts and the trades page's window over completed trades.
 *
 * What is worth pinning here is that the arithmetic is *calendar* arithmetic and
 * not clock arithmetic: the shifts run in UTC so no zone and no daylight-saving
 * boundary can move a day, and the month shift clamps rather than rolling over,
 * because a "last 12 months" window that starts in the wrong month is a whole
 * month of drafts. Every function takes the date it works from, so none of this
 * needs a clock.
 */

describe("todayIso", () => {
  test("writes the local date, zero-padded", () => {
    // Built from the local-time constructor and read back as local, so the
    // assertion holds in whatever zone the test runs in — which is the point of
    // this one being local at all: it anchors what a *reader* means by "today".
    assert.equal(todayIso(new Date(2026, 7, 5)), "2026-08-05");
    assert.equal(todayIso(new Date(2026, 0, 1)), "2026-01-01");
    assert.equal(todayIso(new Date(2026, 11, 31)), "2026-12-31");
  });

  test("a late-evening local instant is still that local day", () => {
    // The failure this guards is reading the UTC date instead: west of UTC, an
    // evening here is already tomorrow there, and the window would silently
    // start a day early.
    assert.equal(todayIso(new Date(2026, 7, 5, 23, 59, 59)), "2026-08-05");
    assert.equal(todayIso(new Date(2026, 7, 5, 0, 0, 0)), "2026-08-05");
  });
});

describe("shiftDays", () => {
  test("counts whole days in either direction", () => {
    assert.equal(shiftDays("2026-06-15", 1), "2026-06-16");
    assert.equal(shiftDays("2026-06-15", -1), "2026-06-14");
    assert.equal(shiftDays("2026-06-15", 0), "2026-06-15");
    assert.equal(shiftDays("2026-06-15", -30), "2026-05-16");
  });

  test("crosses month and year boundaries", () => {
    assert.equal(shiftDays("2026-01-01", -1), "2025-12-31");
    assert.equal(shiftDays("2026-12-31", 1), "2027-01-01");
    assert.equal(shiftDays("2026-01-15", -30), "2025-12-16");
  });

  test("knows which Februaries have 29 days", () => {
    assert.equal(shiftDays("2024-02-28", 1), "2024-02-29");
    assert.equal(shiftDays("2024-02-29", 1), "2024-03-01");
    assert.equal(shiftDays("2025-02-28", 1), "2025-03-01");
  });

  test("a daylight-saving boundary is still one day", () => {
    // Shifted in UTC precisely so no zone can move the boundary: a 23-hour local
    // day would otherwise land a "last 30 days" bound on the wrong date for
    // readers in half the world, and only twice a year.
    assert.equal(shiftDays("2026-03-08", 1), "2026-03-09", "US spring forward");
    assert.equal(shiftDays("2026-11-01", 1), "2026-11-02", "US fall back");
    assert.equal(shiftDays("2026-03-29", 1), "2026-03-30", "EU spring forward");
  });
});

describe("shiftMonths", () => {
  test("keeps the day of the month where the target month has one", () => {
    assert.equal(shiftMonths("2026-08-05", -12), "2025-08-05");
    assert.equal(shiftMonths("2026-08-05", -1), "2026-07-05");
    assert.equal(shiftMonths("2026-08-05", 5), "2027-01-05");
    assert.equal(shiftMonths("2026-08-05", 0), "2026-08-05");
  });

  test("clamps to the month's last day rather than rolling into the next one", () => {
    // Day 31 has no counterpart in a 30-day month. Rolling forward would start a
    // "last 12 months" window on the 1st of the *following* month, which is a
    // whole month of drafts missing from the board.
    assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
    assert.equal(shiftMonths("2024-03-31", -1), "2024-02-29");
    assert.equal(shiftMonths("2026-05-31", 1), "2026-06-30");
    assert.equal(shiftMonths("2026-01-31", 1), "2026-02-28");
  });

  test("a leap day shifted a year lands on the 28th, not on March", () => {
    assert.equal(shiftMonths("2024-02-29", 12), "2025-02-28");
  });
});

describe("the labels", () => {
  test("a date reads as month, day, year with no padding on the day", () => {
    assert.equal(formatRangeDate("2026-06-01"), "Jun 1, 2026");
    assert.equal(formatRangeDate("2026-12-25"), "Dec 25, 2026");
    assert.equal(formatRangeDate("2026-01-09"), "Jan 9, 2026");
  });

  test("a month reads as month and year", () => {
    assert.equal(formatRangeMonth("2026-06"), "Jun 2026");
    assert.equal(formatRangeMonth("2025-01"), "Jan 2025");
    assert.equal(formatRangeMonth("2025-12"), "Dec 2025");
  });

  test("both ends of the table are reachable, and it has twelve entries", () => {
    // Spelled out rather than left to `Intl` so a date reads the same in every
    // locale — one table behind every label, which only works while it is whole.
    assert.equal(MONTH_ABBREVIATIONS.length, 12);
    assert.equal(formatRangeDate("2026-01-01"), "Jan 1, 2026");
    assert.equal(formatRangeDate("2026-12-31"), "Dec 31, 2026");
  });
});
