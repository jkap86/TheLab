import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupCheckLeague } from "@/shared/contract";

import {
  formatProjectedRecord,
  formatProjectedWinPct,
  formatRecord,
  leagueWeekRecord,
  weekSummary,
} from "./week-summary.ts";

function league(over: Partial<LineupCheckLeague> = {}): LineupCheckLeague {
  return {
    roster_id: 1,
    best_ball: false,
    as_of: "week",
    current_points: 120,
    opponent_points: null,
    median_points: null,
    opponent_lineup: null,
    opponent_bench: null,
    opponent_optimal_points: null,
    opponent_team_name: null,
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

describe("leagueWeekRecord", () => {
  test("a league with no median is one game", () => {
    const record = leagueWeekRecord(
      league({ current_points: 120, opponent_points: 100 }),
    );
    assert.deepEqual(record, {
      wins: 1,
      losses: 0,
      ties: 0,
      games: 1,
      median: false,
    });
  });

  test("a league that runs a median is two games, one per opponent", () => {
    // 2–0, 1–1 and 0–2 are the three readings Sleeper's own standings give a
    // median league for a week, and the head-to-head and the median are each
    // one of the two.
    assert.deepEqual(
      leagueWeekRecord(
        league({ current_points: 120, opponent_points: 100, median_points: 110 }),
      ),
      { wins: 2, losses: 0, ties: 0, games: 2, median: true },
    );
    assert.deepEqual(
      leagueWeekRecord(
        league({ current_points: 120, opponent_points: 130, median_points: 110 }),
      ),
      { wins: 1, losses: 1, ties: 0, games: 2, median: true },
    );
    assert.deepEqual(
      leagueWeekRecord(
        league({ current_points: 100, opponent_points: 130, median_points: 110 }),
      ),
      { wins: 0, losses: 2, ties: 0, games: 2, median: true },
    );
  });

  test("a dead heat against the median is a tie, not a loss", () => {
    assert.deepEqual(
      leagueWeekRecord(
        league({ current_points: 110, opponent_points: 100, median_points: 110 }),
      ),
      { wins: 1, losses: 0, ties: 1, games: 2, median: true },
    );
  });

  test("a median with no head-to-head is no record at all", () => {
    // The median is solved off live rosters, so it answers for a future week
    // nobody has been scheduled for; counted alone it would project a result
    // for a game that does not exist yet.
    assert.equal(
      leagueWeekRecord(
        league({ current_points: 120, opponent_points: null, median_points: 110 }),
      ),
      null,
    );
    assert.equal(leagueWeekRecord(undefined), null);
    assert.equal(leagueWeekRecord(null), null);
  });

  test("the record prints ties only where there are any", () => {
    assert.equal(formatRecord({ wins: 2, losses: 0, ties: 0 }), "2–0");
    assert.equal(formatRecord({ wins: 1, losses: 0, ties: 1 }), "1–0–1");
  });
});

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

  test("a median league counts two games toward the week's record", () => {
    // The card reads `2–0` for that league; a plate reading `1–0` over it
    // would be the same week counted two ways.
    const summary = weekSummary(leagues, {
      a: league({ current_points: 120, opponent_points: 100, median_points: 110 }),
      b: league({ current_points: 100, opponent_points: 120 }),
    });
    assert.deepEqual(
      {
        leagues: summary.leagues,
        games: summary.games,
        wins: summary.wins,
        losses: summary.losses,
      },
      { leagues: 2, games: 3, wins: 2, losses: 1 },
    );
    assert.equal(formatProjectedRecord(summary), "2–1");
    // The rate is over games, so the median game weighs the same as any other.
    assert.equal(summary.winPct, (2 / 3) * 100);
  });

  test("a median league with no opponent projects nothing, median included", () => {
    const summary = weekSummary(leagues, {
      a: league({ current_points: 120, opponent_points: null, median_points: 110 }),
    });
    assert.equal(summary.games, 0);
    assert.equal(summary.winPct, null);
    assert.equal(formatProjectedRecord(summary), "—");
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
