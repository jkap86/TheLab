import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupCheckLeague } from "@/shared/contract";

import {
  attentionByReason,
  gapCell,
  kickoffCell,
  needsAttention,
  rosterCell,
  superflexCell,
} from "./lineup-check-metrics.ts";

function league(over: Partial<LineupCheckLeague> = {}): LineupCheckLeague {
  return {
    roster_id: 1,
    best_ball: false,
    as_of: "week",
    current_points: 120,
    opponent_points: null,
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

describe("gapCell", () => {
  test("an optimal lineup says so in words, never as a zero", () => {
    // `0.0` in a column of numbers reads as a measurement; "Set" reads as the
    // answer it is.
    const cell = gapCell(league());
    assert.equal(cell.text, "Set");
    assert.equal(cell.state, "clear");
  });

  test("a gap reads negative, because it is a debt", () => {
    // A bare `6.6` under "vs optimal" reads as the good direction.
    const cell = gapCell(
      league({ current_points: 113.4, optimal_points: 120, points_left: 6.6 }),
    );
    assert.equal(cell.text, "−6.6");
    assert.equal(cell.state, "alert");
  });

  test("a league with no answer is an em dash, not a zero", () => {
    assert.equal(gapCell(null).text, "—");
    assert.equal(gapCell(undefined).text, "—");
    assert.equal(gapCell(null).state, "none");
  });

  test("best ball has no gap to report and does not claim one", () => {
    // Sleeper seats it after the games, so "Set" would credit a lineup nobody
    // chose and a number would be advice nobody can act on.
    const cell = gapCell(league({ best_ball: true }));
    assert.equal(cell.text, "Best ball");
    // Nothing was checked, so it is an absence rather than a checkmark.
    assert.equal(cell.state, "none");
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
    assert.equal(cell.state, "clear");
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
    assert.equal(cell.state, "alert");
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

/** One seat, as the solve ships it. */
function seat(
  slot: string,
  positions: string[] | null,
  name = "SOMEBODY",
): LineupCheckLeague["lineup"][number] {
  return {
    slot,
    player:
      positions === null
        ? null
        : {
            player_id: name.toLowerCase(),
            name,
            positions,
            points: 10,
            team: "KC",
            kickoff: null,
            locked: false,
          },
    move_to: null,
  };
}

describe("superflexCell", () => {
  test("a league with no superflex seat has nothing to check", () => {
    const cell = superflexCell(
      league({ lineup: [seat("QB", ["QB"]), seat("RB", ["RB"])] }),
    );
    assert.equal(cell.text, "—");
    assert.equal(cell.state, "none");
    assert.match(cell.title, /No superflex slot/);
  });

  test("best ball seats nobody, so there is no decision to flag", () => {
    const cell = superflexCell(
      league({ best_ball: true, lineup: [seat("SUPER_FLEX", ["RB"])] }),
    );
    assert.equal(cell.state, "none");
  });

  test("a quarterback in every superflex seat is clear", () => {
    const cell = superflexCell(
      league({ lineup: [seat("QB", ["QB"]), seat("SUPER_FLEX", ["QB"], "MAHOMES")] }),
    );
    assert.equal(cell.text, "QB seated");
    assert.equal(cell.state, "clear");
  });

  test("a non-QB in the seat is flagged whether or not a QB is benched", () => {
    // Flagged unconditionally, and deliberately: what it says is that the
    // roster is short a startable quarterback, which is a trade rather than a
    // lineup move. The gap tile answers the narrower question.
    const cell = superflexCell(
      league({
        lineup: [seat("SUPER_FLEX", ["RB"], "SAQUON")],
        bench: [],
      }),
    );
    assert.equal(cell.text, "1 non-QB");
    assert.equal(cell.state, "alert");
    assert.match(cell.title, /SAQUON at SUPER_FLEX/);
  });

  test("two seats spent count as two", () => {
    const cell = superflexCell(
      league({
        lineup: [seat("SUPER_FLEX", ["WR"], "A"), seat("SUPER_FLEX", ["RB"], "B")],
      }),
    );
    assert.equal(cell.text, "2 non-QB");
  });

  test("an empty superflex seat belongs to the gap check, not here", () => {
    // Counting it twice would put one league on two reasons for one fault.
    const cell = superflexCell(league({ lineup: [seat("SUPER_FLEX", null)] }));
    assert.equal(cell.text, "QB seated");
    assert.equal(cell.state, "clear");
  });

  test("a multi-position player who is a QB seats the slot", () => {
    const cell = superflexCell(
      league({ lineup: [seat("SUPER_FLEX", ["QB", "WR"], "TAYSOM")] }),
    );
    assert.equal(cell.state, "clear");
  });
});

describe("rosterCell", () => {
  test("no limit on file is an em dash, never an empty roster", () => {
    const cell = rosterCell(league({ roster_max: null, roster_count: 0 }));
    assert.equal(cell.text, "—");
    assert.equal(cell.state, "none");
  });

  test("a full roster says so, and it is a clear rather than a count", () => {
    const cell = rosterCell(league({ roster_count: 10, roster_max: 10 }));
    assert.equal(cell.text, "Full");
    assert.equal(cell.state, "clear");
  });

  test("an open spot is a count, not an alert", () => {
    // The whole reason the fourth state exists: an open spot is a waiver claim
    // to make, and the error tone would send a reader to fix a league that is
    // fine.
    const cell = rosterCell(league({ roster_count: 8, roster_max: 10 }));
    assert.equal(cell.text, "2 open");
    assert.equal(cell.state, "count");
  });

  test("over the limit is an alert and says what Sleeper will refuse", () => {
    const cell = rosterCell(league({ roster_count: 11, roster_max: 10 }));
    assert.equal(cell.text, "1 over");
    assert.equal(cell.state, "alert");
    assert.match(cell.title, /refuse an add/);
  });

  test("IR over its own allowance is an alert of its own", () => {
    // The common real case: an ineligible player parked on IR, on a roster that
    // is otherwise legal.
    const cell = rosterCell(
      league({ roster_count: 10, roster_max: 10, ir_count: 4, ir_max: 3 }),
    );
    assert.equal(cell.text, "IR 4/3");
    assert.equal(cell.state, "alert");
  });

  test("the roster figure wins when both are wrong, and the title carries the rest", () => {
    const cell = rosterCell(
      league({ roster_count: 12, roster_max: 10, ir_count: 4, ir_max: 3 }),
    );
    assert.equal(cell.text, "2 over");
    assert.match(cell.title, /IR 4\/3/);
  });

  test("a league with no taxi squad is not over its taxi limit", () => {
    // `taxi_max: 0` is a real zero — a league that has none — and nothing is
    // parked there, so there is nothing to report.
    const cell = rosterCell(league({ taxi_count: 0, taxi_max: 0 }));
    assert.equal(cell.state, "clear");
  });
});

describe("attentionByReason", () => {
  const leagues = [{ league_id: "a" }, { league_id: "b" }, { league_id: "c" }];

  test("the rows do not sum to the league count, and that is the point", () => {
    // One league off for two reasons is one league and two rows — which is why
    // the window prints the count separately rather than letting a reader add
    // the column up.
    const checked = {
      a: league({ points_left: 5, kickoff_moves: 2 }),
      b: league({ roster_count: 11, roster_max: 10 }),
      c: league(),
    };
    assert.deepEqual(attentionByReason(leagues, checked), {
      points: 1,
      kickoff: 1,
      superflex: 0,
      roster: 1,
    });
    assert.equal(needsAttention(leagues, checked), 2);
  });

  test("an open roster spot is not a reason", () => {
    const checked = { a: league({ roster_count: 8, roster_max: 10 }) };
    assert.equal(attentionByReason(leagues, checked).roster, 0);
    assert.equal(needsAttention(leagues, checked), 0);
  });

  test("a spent superflex seat is a reason on its own", () => {
    const checked = { a: league({ lineup: [seat("SUPER_FLEX", ["RB"])] }) };
    assert.equal(attentionByReason(leagues, checked).superflex, 1);
    assert.equal(needsAttention(leagues, checked), 1);
  });

  test("leagues missing from the payload count as nothing", () => {
    assert.deepEqual(attentionByReason(leagues, {}), {
      points: 0,
      kickoff: 0,
      superflex: 0,
      roster: 0,
    });
  });
});
