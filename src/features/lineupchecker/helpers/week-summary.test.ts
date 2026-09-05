import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupCheckLeague } from "@/shared/contract";

import {
  formatProjectedRecord,
  formatProjectedWinPct,
  weekSummary,
} from "./week-summary.ts";

function league(over: Partial<LineupCheckLeague> = {}): LineupCheckLeague {
  return {
    roster_id: 1,
    best_ball: false,
    as_of: "week",
    current_points: 120,
    opponent_points: null,
    opponent_lineup: null,
    opponent_bench: null,
    optimal_points: 120,
    points_left: 0,
    start: [],
    sit: [],
    kickoff_moves: 0,
    lineup: [],
    bench: [],
    roster_count: 10,
    roster_max: 10,
    ir_count: 0,
    ir_max: 0,
    taxi_count: 0,
    taxi_max: 0,
    unknown_slots: [],
    ...over,
  };
}

const leagues = [{ league_id: "a" }, { league_id: "b" }, { league_id: "c" }];

describe("weekSummary", () => {
  test("counts a win, a loss and a tie off the two projections", () => {
    const summary = weekSummary(leagues, {
      a: league({ current_points: 120, opponent_points: 100 }),
      b: league({ current_points: 100, opponent_points: 120 }),
      c: league({ current_points: 110, opponent_points: 110 }),
    });
    assert.deepEqual(
      { wins: summary.wins, losses: summary.losses, ties: summary.ties },
      { wins: 1, losses: 1, ties: 1 },
    );
    assert.equal(summary.leagues, 3);
  });

  test("a league with no opponent is excluded, never counted as a loss", () => {
    // A future week has no stored matchup rows by construction, and a projected
    // 0–13 in August is a claim about games nobody has been scheduled for.
    const summary = weekSummary(leagues, {
      a: league({ current_points: 120, opponent_points: null }),
      b: league({ current_points: 120, opponent_points: 100 }),
    });
    assert.equal(summary.losses, 0);
    assert.equal(summary.wins, 1);
    assert.equal(summary.leagues, 1);
  });

  test("a week with nothing projected has a null rate, not a zero", () => {
    // Zero would draw a real 0% on the dial and claim every game was lost.
    const summary = weekSummary(leagues, {});
    assert.equal(summary.winPct, null);
    assert.equal(formatProjectedWinPct(summary), "—");
    assert.equal(formatProjectedRecord(summary), "—");
  });

  test("a tie is half a win", () => {
    const summary = weekSummary(leagues, {
      a: league({ current_points: 110, opponent_points: 110 }),
      b: league({ current_points: 100, opponent_points: 120 }),
    });
    assert.equal(summary.winPct, 25);
    assert.equal(formatProjectedWinPct(summary), "25.0%");
  });

  test("the record prints ties only where there are any", () => {
    assert.equal(
      formatProjectedRecord(
        weekSummary(leagues, {
          a: league({ current_points: 120, opponent_points: 100 }),
          b: league({ current_points: 100, opponent_points: 120 }),
        }),
      ),
      "1–1",
    );
    assert.equal(
      formatProjectedRecord(
        weekSummary(leagues, {
          a: league({ current_points: 120, opponent_points: 100 }),
          b: league({ current_points: 110, opponent_points: 110 }),
        }),
      ),
      "1–0–1",
    );
  });

  test("leagues the reader has filtered out are not projected", () => {
    // The summary is taken over the list it is handed, exactly as the season's
    // is: a reader narrowed to dynasty wants their dynasty week.
    const summary = weekSummary([{ league_id: "a" }], {
      a: league({ current_points: 120, opponent_points: 100 }),
      b: league({ current_points: 100, opponent_points: 120 }),
    });
    assert.equal(summary.leagues, 1);
    assert.equal(summary.wins, 1);
  });
});
