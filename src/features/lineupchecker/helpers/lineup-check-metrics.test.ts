import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupCheckLeague } from "@/shared/contract";

import {
  gapCell,
  kickoffCell,
  needsAttention,
} from "./lineup-check-metrics.ts";

function league(over: Partial<LineupCheckLeague> = {}): LineupCheckLeague {
  return {
    roster_id: 1,
    best_ball: false,
    as_of: "week",
    current_points: 120,
    optimal_points: 120,
    points_left: 0,
    start: [],
    sit: [],
    kickoff_moves: 0,
    lineup: [],
    bench: [],
    unknown_slots: [],
    ...over,
  };
}

describe("gapCell", () => {
  test("an optimal lineup says so in words, never as a zero", () => {
    // `0.0` in a column of numbers reads as a measurement; "Set" reads as the
    // answer it is.
    const cell = gapCell(league());
    assert.equal(cell.text, "Set");
    assert.equal(cell.alert, false);
  });

  test("a gap reads negative, because it is a debt", () => {
    // A bare `6.6` under "vs optimal" reads as the good direction.
    const cell = gapCell(
      league({ current_points: 113.4, optimal_points: 120, points_left: 6.6 }),
    );
    assert.equal(cell.text, "−6.6");
    assert.equal(cell.alert, true);
  });

  test("a league with no answer is an em dash, not a zero", () => {
    assert.equal(gapCell(null).text, "—");
    assert.equal(gapCell(undefined).text, "—");
    assert.equal(gapCell(null).alert, false);
  });

  test("best ball has no gap to report and does not claim one", () => {
    // Sleeper seats it after the games, so "Set" would credit a lineup nobody
    // chose and a number would be advice nobody can act on.
    const cell = gapCell(league({ best_ball: true }));
    assert.equal(cell.text, "Best ball");
    assert.equal(cell.alert, false);
  });

  test("the hover carries the units the tile has no room for", () => {
    const cell = gapCell(
      league({ current_points: 113.4, optimal_points: 120, points_left: 6.6 }),
    );
    assert.match(cell.title, /113\.4/);
    assert.match(cell.title, /120\.0/);
  });
});

describe("kickoffCell", () => {
  test("zero moves is a real answer and reads as one", () => {
    const cell = kickoffCell(league({ kickoff_moves: 0 }));
    assert.equal(cell.text, "In order");
    assert.equal(cell.alert, false);
  });

  test("null is no answer at all, and must not read as 'in order'", () => {
    // The distinction the whole contract is written to: a week with no
    // published kickoffs has not been checked, and saying "In order" would
    // claim it had.
    const cell = kickoffCell(league({ kickoff_moves: null }));
    assert.equal(cell.text, "—");
    assert.notEqual(cell.text, "In order");
  });

  test("a null in a best-ball league says why", () => {
    const cell = kickoffCell(league({ kickoff_moves: null, best_ball: true }));
    assert.match(cell.title, /best-ball/);
  });

  test("a null anywhere else blames the schedule, not the format", () => {
    const cell = kickoffCell(league({ kickoff_moves: null }));
    assert.match(cell.title, /kickoff times/);
  });

  test("moves are counted and flagged", () => {
    const cell = kickoffCell(league({ kickoff_moves: 2 }));
    assert.equal(cell.text, "2 to move");
    assert.equal(cell.alert, true);
  });

  test("one move is singular in the hover", () => {
    assert.match(kickoffCell(league({ kickoff_moves: 1 })).title, /1 starter could/);
    assert.match(kickoffCell(league({ kickoff_moves: 2 })).title, /2 starters could/);
  });
});

describe("needsAttention", () => {
  const leagues = [{ league_id: "a" }, { league_id: "b" }, { league_id: "c" }];

  test("counts leagues, not problems — a league with both is one league", () => {
    const count = needsAttention(leagues, {
      a: league({ points_left: 5, kickoff_moves: 2 }),
      b: league(),
      c: league(),
    });
    assert.equal(count, 1);
  });

  test("a seat order alone is worth a press", () => {
    const count = needsAttention(leagues, {
      a: league({ kickoff_moves: 1 }),
      b: league(),
    });
    assert.equal(count, 1);
  });

  test("a league with no answer is not a league with a problem", () => {
    // Absence is not attention: a week that could not be checked has nothing to
    // report, and counting it would send a reader looking for a move that was
    // never named.
    const count = needsAttention(leagues, {
      a: league({ kickoff_moves: null }),
    });
    assert.equal(count, 0);
  });

  test("a league missing from the payload counts as nothing", () => {
    assert.equal(needsAttention(leagues, {}), 0);
  });
});
