import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { openingKickoff, weekKickoffs } from "./parse.ts";

// 2026-09-10T20:20:00-04:00 and the Sunday 1 PM ET after it, as epoch ms.
const THURSDAY = 1789086000000;
const SUNDAY = 1789318800000;

describe("openingKickoff", () => {
  test("picks the earliest week-1 kickoff", () => {
    const games = [
      { week: 1, start_time: SUNDAY },
      { week: 1, start_time: THURSDAY },
      { week: 1, start_time: SUNDAY + 3 * 3600 * 1000 },
    ];
    assert.equal(openingKickoff(games), THURSDAY);
  });

  test("ignores every other week, however early its games", () => {
    const games = [
      { week: 2, start_time: THURSDAY - 1000 },
      { week: 1, start_time: SUNDAY },
    ];
    assert.equal(openingKickoff(games), SUNDAY);
  });

  test("a schedule with dates but no times is null, not a guess", () => {
    // The client's calendar table is the provisional fallback for this case;
    // inventing an hour here would dress a guess up as Sleeper's word.
    const games = [{ week: 1, date: "2026-09-10" }];
    assert.equal(openingKickoff(games), null);
  });

  test("rejects a start_time in the wrong unit rather than believing 1970", () => {
    // A seconds epoch for 2026 lands well before the plausible-ms window.
    assert.equal(openingKickoff([{ week: 1, start_time: 1789086000 }]), null);
    assert.equal(openingKickoff([{ week: 1, start_time: 0 }]), null);
    assert.equal(openingKickoff([{ week: 1, start_time: NaN }]), null);
  });

  test("an empty or junk-riddled schedule is null", () => {
    assert.equal(openingKickoff([]), null);
    assert.equal(
      openingKickoff([
        {},
        { week: null, start_time: THURSDAY },
        { week: 1, start_time: null },
      ]),
      null,
    );
  });
});

describe("weekKickoffs", () => {
  test("files each game's instant under both of its teams", () => {
    const games = [
      { week: 1, start_time: THURSDAY, home: "PHI", away: "DAL" },
      { week: 1, start_time: SUNDAY, home: "KC", away: "BUF" },
    ];
    assert.deepEqual(
      weekKickoffs(games, 1),
      new Map([
        ["PHI", THURSDAY],
        ["DAL", THURSDAY],
        ["KC", SUNDAY],
        ["BUF", SUNDAY],
      ]),
    );
  });

  test("reads only the asked week", () => {
    const games = [
      { week: 1, start_time: THURSDAY, home: "PHI", away: "DAL" },
      { week: 2, start_time: SUNDAY, home: "PHI", away: "KC" },
    ];
    assert.deepEqual(weekKickoffs(games, 2), new Map([["PHI", SUNDAY], ["KC", SUNDAY]]));
  });

  test("a game without a believable time names no team at all", () => {
    // Absent means "not known" to the lineup ordering, which holds the seat;
    // a seconds epoch believed here would read as fifty years locked.
    const games = [
      { week: 1, home: "PHI", away: "DAL", date: "2026-09-10" },
      { week: 1, start_time: 1789086000, home: "KC", away: "BUF" },
    ];
    assert.deepEqual(weekKickoffs(games, 1), new Map());
  });

  test("a team listed twice in one week keeps its earliest instant", () => {
    const games = [
      { week: 1, start_time: SUNDAY, home: "PHI", away: "DAL" },
      { week: 1, start_time: THURSDAY, home: "NYG", away: "PHI" },
    ];
    assert.equal(weekKickoffs(games, 1).get("PHI"), THURSDAY);
  });

  test("skips a side the schedule doesn't name without losing the other", () => {
    const games = [{ week: 1, start_time: THURSDAY, home: "PHI", away: null }];
    assert.deepEqual(weekKickoffs(games, 1), new Map([["PHI", THURSDAY]]));
  });
});
