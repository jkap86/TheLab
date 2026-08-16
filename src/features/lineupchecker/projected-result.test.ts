import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { projectedOutcome, projectedOutcomes } from "./projected-result.ts";
import type { LeagueMatchupPayload } from "./types.ts";

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

/** A week projecting `current` for this roster, against the bars given. */
const week = (
  current: number | null,
  bars: { opponent?: number | null; median?: number | null } = {},
): LeagueMatchupPayload =>
  matchup({
    projection:
      current === null
        ? null
        : { optimal: current, current, points_left: 0, kickoff_moves: null },
    opponent_projection: bars.opponent ?? null,
    median_projection: bars.median ?? null,
  });

describe("projectedOutcome", () => {
  test("reads which side of the bar the projection falls on", () => {
    assert.equal(projectedOutcome(120, 100), "W");
    assert.equal(projectedOutcome(90, 100), "L");
    assert.equal(projectedOutcome(100, 100), "T");
  });

  test("a projected zero is a real number, not a missing one", () => {
    // The case a truthiness test gets wrong: an undrafted roster projects
    // nothing and loses to anyone who has drafted, which is a result.
    assert.equal(projectedOutcome(0, 100), "L");
    assert.equal(projectedOutcome(0, 0), "T");
    assert.equal(projectedOutcome(100, 0), "W");
  });

  test("a missing number on either side is no result at all", () => {
    assert.equal(projectedOutcome(null, 100), null);
    assert.equal(projectedOutcome(undefined, 100), null);
    assert.equal(projectedOutcome(120, null), null);
    assert.equal(projectedOutcome(120, undefined), null);
  });
});

describe("projectedOutcomes", () => {
  test("an ordinary league is one result, against the opponent", () => {
    assert.deepEqual(projectedOutcomes(week(120, { opponent: 100 })), [
      { against: "opponent", outcome: "W" },
    ]);
  });

  test("a median league is two results, the opponent's first", () => {
    // The order is the only thing that says which mark is which — nothing on
    // the plate is written to explain the pair.
    assert.deepEqual(
      projectedOutcomes(week(110, { opponent: 100, median: 120 })),
      [
        { against: "opponent", outcome: "W" },
        { against: "median", outcome: "L" },
      ],
    );
  });

  test("the two results are independent, so all four pairings are reachable", () => {
    const outcomes = (mine: number) =>
      projectedOutcomes(week(mine, { opponent: 100, median: 120 })).map(
        (r) => r.outcome,
      );

    assert.deepEqual(outcomes(130), ["W", "W"]);
    assert.deepEqual(outcomes(110), ["W", "L"]);
    assert.deepEqual(outcomes(90), ["L", "L"]);
    assert.deepEqual(
      projectedOutcomes(week(110, { opponent: 120, median: 100 })).map(
        (r) => r.outcome,
      ),
      ["L", "W"],
    );
  });

  test("a bye in a median league is still a game against the field", () => {
    // The reason the marks are read off the matchup rather than off
    // `matchupState`: an odd-sized median league byes somebody every week, and
    // that manager still has the field to beat.
    assert.deepEqual(
      projectedOutcomes(
        matchup({ opponent: null, opponent_projection: null, median_projection: 100 }),
      ),
      [{ against: "median", outcome: "W" }],
    );
  });

  test("a bye without a median is no result", () => {
    assert.deepEqual(
      projectedOutcomes(matchup({ opponent: null, opponent_projection: null })),
      [],
    );
  });

  test("an unprojectable league contributes nothing, median or not", () => {
    // One side missing is as fatal as both: a result needs two numbers, and a
    // league with no slots or scoring on file has neither.
    assert.deepEqual(projectedOutcomes(week(null, { opponent: 100, median: 110 })), []);
  });

  test("a league with no stored matchup is no result", () => {
    // Absent is not empty — the crawler simply has not reached this week for it.
    assert.deepEqual(projectedOutcomes(undefined), []);
  });
});
