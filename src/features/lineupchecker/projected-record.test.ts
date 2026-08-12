import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { projectedRecord } from "./projected-record.ts";
import type { LeagueMatchupPayload } from "./types.ts";

const league = (league_id: string) => ({ league_id });

const matchup = (
  over: Partial<LeagueMatchupPayload> = {},
): LeagueMatchupPayload => ({
  roster_id: 1,
  opponent: {
    roster_id: 2,
    user_id: "u2",
    display_name: "Rival",
    team_name: null,
    avatar_url: null,
  },
  projection: { optimal: 120, current: 110, points_left: 10, kickoff_moves: null },
  opponent_projection: 100,
  ...over,
});

/** A matchup whose own projection is `current`, against `opponent_projection`. */
const game = (current: number, opponent: number): LeagueMatchupPayload =>
  matchup({
    projection: { optimal: current, current, points_left: 0, kickoff_moves: null },
    opponent_projection: opponent,
  });

describe("projectedRecord", () => {
  test("counts a league by which side projects higher", () => {
    const record = projectedRecord([league("a"), league("b"), league("c")], {
      a: game(120, 100),
      b: game(90, 100),
      c: game(100, 100),
    });

    assert.deepEqual(
      { wins: record.wins, losses: record.losses, ties: record.ties },
      { wins: 1, losses: 1, ties: 1 },
    );
    assert.equal(record.games, 3);
    assert.equal(record.leagues, 3);
  });

  test("a bye is not a game, so it lands in neither column", () => {
    // An odd-sized league byes somebody every week: there is nobody to beat, so
    // counting it either way would invent a result.
    const record = projectedRecord([league("a"), league("b")], {
      a: game(120, 100),
      b: matchup({ opponent: null, opponent_projection: null }),
    });

    assert.equal(record.wins, 1);
    assert.equal(record.games, 1);
    assert.equal(record.leagues, 1);
  });

  test("a league with no stored matchup contributes nothing", () => {
    // Absent is not empty — the crawler simply has not reached this week for it.
    const record = projectedRecord([league("a"), league("unsynced")], {
      a: game(120, 100),
    });

    assert.equal(record.games, 1);
    assert.equal(record.leagues, 1);
  });

  test("an unprojectable league contributes nothing, on either side", () => {
    // No slots or scoring on file, or nothing stored for the week. One side
    // missing is as fatal as both: a result needs two numbers.
    const record = projectedRecord([league("a"), league("b"), league("c")], {
      a: game(120, 100),
      b: matchup({ projection: null }),
      c: matchup({ opponent_projection: null }),
    });

    assert.equal(record.games, 1);
    assert.equal(record.leagues, 1);
  });

  test("a projected zero is a real number, not a missing one", () => {
    // A roster nobody has drafted projects nothing and loses to anyone who has
    // — which is a result, where an absent projection is not.
    const record = projectedRecord([league("a"), league("b")], {
      a: game(0, 100),
      b: game(0, 0),
    });

    assert.equal(record.losses, 1);
    assert.equal(record.ties, 1);
    assert.equal(record.games, 2);
  });

  test("nothing projected has no pct, rather than .000", () => {
    // The preseason rule the season record keeps: a win percentage over no games
    // is a claim about a week nobody has played.
    const record = projectedRecord([league("a")], {
      a: matchup({ projection: null, opponent_projection: null }),
    });

    assert.equal(record.pct, null);
    assert.equal(record.games, 0);
    assert.equal(record.leagues, 0);
  });

  test("an empty list is empty, not a division by zero", () => {
    assert.deepEqual(projectedRecord([], {}), {
      wins: 0,
      losses: 0,
      ties: 0,
      games: 0,
      leagues: 0,
      pct: null,
    });
  });

  test("a tie counts as half a win, as it does in a season record", () => {
    const record = projectedRecord([league("a"), league("b")], {
      a: game(120, 100),
      b: game(100, 100),
    });
    assert.equal(record.pct, 0.75);
  });

  test("counts over the leagues given, not over every matchup sent", () => {
    // The numerator is what is on screen and the denominator is what it was
    // counted from — so a matchup for a league this list is not showing is not a
    // result on this list.
    const record = projectedRecord([league("a")], {
      a: game(120, 100),
      b: game(90, 100),
    });

    assert.equal(record.games, 1);
    assert.equal(record.wins, 1);
    assert.equal(record.losses, 0);
  });
});
