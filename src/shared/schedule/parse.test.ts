import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { openingKickoff, weekGames, weekKickoffs } from "./parse.ts";

// 2026-09-10T20:20:00-04:00 and the Sunday 1 PM ET after it, as epoch ms.
const THURSDAY = 1789086000000;
const SUNDAY = 1789318800000;

/** A scoreboard row, whose teams live on `metadata` rather than at the top. */
const game = (
  over: {
    start_time?: number | null;
    home?: string | null;
    away?: string | null;
    date?: string;
  } = {},
) => ({
  start_time: over.start_time,
  date: over.date,
  metadata: { home_team: over.home, away_team: over.away },
});

describe("openingKickoff", () => {
  test("picks the earliest kickoff on the week-1 scoreboard", () => {
    const games = [
      game({ start_time: SUNDAY }),
      game({ start_time: THURSDAY }),
      game({ start_time: SUNDAY + 3 * 3600 * 1000 }),
    ];
    assert.equal(openingKickoff(games), THURSDAY);
  });

  test("a scoreboard with dates but no times is null, not a guess", () => {
    // The client's calendar table is the provisional fallback for this case;
    // inventing an hour here would dress a guess up as Sleeper's word.
    assert.equal(openingKickoff([game({ date: "2026-09-10" })]), null);
  });

  test("rejects a start_time in the wrong unit rather than believing 1970", () => {
    // A seconds epoch for 2026 lands well before the plausible-ms window.
    assert.equal(openingKickoff([game({ start_time: 1789086000 })]), null);
    assert.equal(openingKickoff([game({ start_time: 0 })]), null);
    assert.equal(openingKickoff([game({ start_time: NaN })]), null);
  });

  test("an unscheduled season is null, and so is a junk-riddled one", () => {
    // Sleeper answers `[]` for a season it has not scheduled — verified for
    // 2027 — so an empty week is the ordinary shape of "no answer" here.
    assert.equal(openingKickoff([]), null);
    assert.equal(openingKickoff([{}, game({ start_time: null })]), null);
  });
});

describe("weekGames", () => {
  test("files each side with the other named as its opponent", () => {
    assert.deepEqual(
      weekGames([game({ start_time: SUNDAY, home: "KC", away: "BUF" })]),
      new Map([
        ["KC", { opponent: "BUF", home: true, kickoff: SUNDAY }],
        ["BUF", { opponent: "KC", home: false, kickoff: SUNDAY }],
      ]),
    );
  });

  test("reads the teams off metadata, not the top level", () => {
    // The regression this whole module was rebuilt for: the schedule endpoint
    // named the teams at the top level and never carried a time, so a row read
    // that way yields no teams here at all.
    const topLevel = [
      { start_time: SUNDAY, home: "KC", away: "BUF" },
    ] as unknown as Parameters<typeof weekGames>[0];
    assert.deepEqual(weekGames(topLevel), new Map());
  });

  test("a game with no believable time still names the opponent", () => {
    // The row can say who he plays without claiming an hour Sleeper hasn't
    // published — the same split `openingKickoff` refuses to guess across.
    assert.deepEqual(
      weekGames([game({ home: "PHI", away: "DAL", date: "2026-09-10" })]),
      new Map([
        ["PHI", { opponent: "DAL", home: true, kickoff: null }],
        ["DAL", { opponent: "PHI", home: false, kickoff: null }],
      ]),
    );
  });

  test("a bye is an absent team, not an entry saying so", () => {
    const games = [game({ start_time: SUNDAY, home: "KC", away: "BUF" })];
    assert.equal(weekGames(games).has("PHI"), false);
  });

  test("keeps the half of a game the scoreboard names", () => {
    assert.deepEqual(
      weekGames([game({ start_time: THURSDAY, home: "PHI", away: null })]),
      new Map([["PHI", { opponent: null, home: true, kickoff: THURSDAY }]]),
    );
  });

  test("a dated listing supersedes an undated one, whichever came first", () => {
    // Both orderings, since the rule is about the entries and not the array:
    // an undated duplicate must never take a known instant back off a team.
    const dated = game({ start_time: THURSDAY, home: "NYG", away: "PHI" });
    const undated = game({ home: "PHI", away: "DAL", date: "2026-09-10" });
    for (const games of [
      [dated, undated],
      [undated, dated],
    ]) {
      assert.deepEqual(weekGames(games).get("PHI"), {
        opponent: "NYG",
        home: false,
        kickoff: THURSDAY,
      });
    }
  });
});

describe("weekKickoffs", () => {
  test("files each game's instant under both of its teams", () => {
    const games = [
      game({ start_time: THURSDAY, home: "PHI", away: "DAL" }),
      game({ start_time: SUNDAY, home: "KC", away: "BUF" }),
    ];
    assert.deepEqual(
      weekKickoffs(games),
      new Map([
        ["PHI", THURSDAY],
        ["DAL", THURSDAY],
        ["KC", SUNDAY],
        ["BUF", SUNDAY],
      ]),
    );
  });

  test("a game without a believable time names no team at all", () => {
    // Absent means "not known" to the lineup ordering, which holds the seat;
    // a seconds epoch believed here would read as fifty years locked.
    const games = [
      game({ home: "PHI", away: "DAL", date: "2026-09-10" }),
      game({ start_time: 1789086000, home: "KC", away: "BUF" }),
    ];
    assert.deepEqual(weekKickoffs(games), new Map());
  });

  test("a team listed twice in one week keeps its earliest instant", () => {
    const games = [
      game({ start_time: SUNDAY, home: "PHI", away: "DAL" }),
      game({ start_time: THURSDAY, home: "NYG", away: "PHI" }),
    ];
    assert.equal(weekKickoffs(games).get("PHI"), THURSDAY);
  });

  test("skips a side the scoreboard doesn't name without losing the other", () => {
    const games = [game({ start_time: THURSDAY, home: "PHI", away: null })];
    assert.deepEqual(weekKickoffs(games), new Map([["PHI", THURSDAY]]));
  });
});
