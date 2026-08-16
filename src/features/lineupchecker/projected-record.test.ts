import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { projectedRecord } from "./projected-record.ts";
import { projectedOutcomes } from "./projected-result.ts";
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
  median_projection: null,
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

  test("a median league is one league and two games", () => {
    // Sleeper's `league_average_match` plays every team against the week's
    // middle as well as against their opponent, so the week holds two results.
    // `games` and `leagues` stop agreeing here, which is why they are counted
    // apart rather than one being assigned from the other.
    const record = projectedRecord([league("a")], {
      a: matchup({
        projection: { optimal: 110, current: 110, points_left: 0, kickoff_moves: null },
        opponent_projection: 100,
        median_projection: 120,
      }),
    });

    assert.deepEqual(
      { wins: record.wins, losses: record.losses, ties: record.ties },
      { wins: 1, losses: 1, ties: 0 },
    );
    assert.equal(record.games, 2);
    assert.equal(record.leagues, 1);
    assert.equal(record.pct, 0.5);
  });

  test("a bye in a median league still counts the field", () => {
    const record = projectedRecord([league("a")], {
      a: matchup({
        opponent: null,
        projection: { optimal: 130, current: 130, points_left: 0, kickoff_moves: null },
        opponent_projection: null,
        median_projection: 120,
      }),
    });

    assert.equal(record.wins, 1);
    assert.equal(record.games, 1);
    assert.equal(record.leagues, 1);
  });

  test("the plate sums exactly the marks the cards print", () => {
    // The agreement the shared `projectedOutcomes` exists to keep: a list
    // showing `W L`, `W` and `L L` is 2-3, and a plate that counted for itself
    // could disagree with the rows under it without either number looking
    // wrong.
    const matchups = {
      a: matchup({
        projection: { optimal: 110, current: 110, points_left: 0, kickoff_moves: null },
        opponent_projection: 100,
        median_projection: 120,
      }),
      b: game(120, 100),
      c: matchup({
        projection: { optimal: 80, current: 80, points_left: 0, kickoff_moves: null },
        opponent_projection: 100,
        median_projection: 90,
      }),
    };
    const rows = [league("a"), league("b"), league("c")];

    const marks = rows.flatMap((row) =>
      projectedOutcomes(matchups[row.league_id as keyof typeof matchups]).map(
        (r) => r.outcome,
      ),
    );
    const record = projectedRecord(rows, matchups);

    assert.deepEqual(marks, ["W", "L", "W", "L", "L"]);
    assert.equal(record.wins, marks.filter((m) => m === "W").length);
    assert.equal(record.losses, marks.filter((m) => m === "L").length);
    assert.equal(record.games, marks.length);
    assert.equal(record.leagues, 3);
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
