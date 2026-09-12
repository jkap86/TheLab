import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupCheckIrPlayer, LineupCheckLeague } from "@/shared/contract";

import {
  attentionByReason,
  gapCell,
  irMarkFor,
  irMoves,
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
    ir: { reserve: [], stashable: [], unknown: 0 },
    unknown_slots: [],
    ...over,
  };
}

/** One player as the IR reading judged him. */
function irPlayer(
  id: string,
  status: string | null,
  eligible: boolean | null,
  name: string | null = id.toUpperCase(),
  locked = false,
): LineupCheckIrPlayer {
  return { player_id: id, name, status, eligible, locked };
}

/** A checked IR reading over the given lists. */
function ir(
  over: Partial<NonNullable<LineupCheckLeague["ir"]>> = {},
): NonNullable<LineupCheckLeague["ir"]> {
  return { reserve: [], stashable: [], unknown: 0, ...over };
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

  test("an open spot is an alert, the same as being over", () => {
    // Under and over are both a trip to Sleeper, and the page counts leagues to
    // open. A seat left empty scores nothing every week it stays empty.
    const cell = rosterCell(league({ roster_count: 8, roster_max: 10 }));
    assert.equal(cell.text, "2 open");
    assert.equal(cell.state, "alert");
  });

  test("over the limit is an alert and says what Sleeper will refuse", () => {
    const cell = rosterCell(league({ roster_count: 11, roster_max: 10 }));
    assert.equal(cell.text, "1 over");
    assert.equal(cell.state, "alert");
    assert.match(cell.title, /refuse an add/);
  });

  test("IR over its allowance is one more player to move off it", () => {
    // Four players the league admits on a three-slot IR: nobody is ineligible,
    // and one still has to come off. Counted as a move rather than printed as
    // a ratio, so it reads in the same grammar as `1 over` above and fits the
    // phone tile that `4/3` at `--fs-17` does not; the ratio is in the title.
    const parked = ["a", "b", "c", "d"].map((id) => irPlayer(id, "IR", true));
    const cell = rosterCell(
      league({
        roster_count: 10,
        roster_max: 10,
        ir_count: 4,
        ir_max: 3,
        ir: ir({ reserve: parked }),
      }),
    );
    assert.equal(cell.text, "1 off IR");
    assert.equal(cell.figure, "1");
    assert.equal(cell.unit, "off IR");
    assert.equal(cell.state, "alert");
    assert.match(cell.title, /over its allowance \(4\/3\)/);
    assert.doesNotMatch(cell.title, /not IR-eligible/);
  });

  test("the IR move comes first, and the title carries the overage", () => {
    // Twelve on a ten-spot roster *and* a healthy player on IR: Sleeper refuses
    // the fixing drop until IR is legal, so the IR move leads and the title
    // says what the roster is once he is back on it.
    const cell = rosterCell(
      league({
        roster_count: 12,
        roster_max: 10,
        ir_count: 4,
        ir_max: 3,
        ir: ir({
          reserve: [irPlayer("fit", null, false), ...["a", "b", "c"].map((id) => irPlayer(id, "IR", true))],
        }),
      }),
    );
    assert.equal(cell.text, "1 off IR");
    assert.match(cell.title, /IR 4\/3/);
    assert.match(cell.title, /13 of 10 and 3 must then be dropped/);
  });

  test("a healthy player on IR must come off, and the title names him", () => {
    const cell = rosterCell(
      league({
        roster_count: 10,
        roster_max: 10,
        ir_count: 1,
        ir_max: 2,
        ir: ir({ reserve: [irPlayer("mahomes", null, false, "MAHOMES")] }),
      }),
    );
    assert.equal(cell.text, "1 off IR");
    assert.equal(cell.state, "alert");
    assert.match(cell.title, /MAHOMES \(healthy\) is not IR-eligible/);
    assert.match(cell.title, /refuses transactions until he is off IR/);
    // Activated onto a full roster, somebody has to go.
    assert.match(cell.title, /11 of 10 and 1 must then be dropped/);
  });

  test("an ineligible IR player whose slot a bench player can take is a swap", () => {
    const cell = rosterCell(
      league({
        roster_count: 10,
        roster_max: 10,
        ir_count: 1,
        ir_max: 1,
        ir: ir({
          reserve: [irPlayer("fit", null, false)],
          stashable: [irPlayer("cmc", "Out", true)],
        }),
      }),
    );
    assert.equal(cell.text, "1 off IR");
    assert.match(cell.title, /and 1 on \(CMC \(Out\)\)/);
    assert.match(cell.title, /10 of 10, full/);
  });

  test("an empty IR slot with an eligible bench player is a stash", () => {
    const cell = rosterCell(
      league({
        roster_count: 10,
        roster_max: 10,
        ir_count: 0,
        ir_max: 1,
        ir: ir({ stashable: [irPlayer("chubb", "Out", true)] }),
      }),
    );
    assert.equal(cell.text, "1 to IR");
    assert.equal(cell.figure, "1");
    assert.equal(cell.unit, "to IR");
    assert.equal(cell.state, "alert");
    assert.match(cell.title, /1 IR slot open — 1 player eligible: CHUBB \(Out\)/);
    // The stash is what opens the spot; the title says so.
    assert.match(cell.title, /9 of 10 with 1 spot open/);
  });

  test("more eligible than slots says so", () => {
    const cell = rosterCell(
      league({
        ir_count: 0,
        ir_max: 1,
        ir: ir({ stashable: ["a", "b", "c"].map((id) => irPlayer(id, "Out", true)) }),
      }),
    );
    assert.equal(cell.text, "1 to IR");
    assert.match(cell.title, /3 players eligible/);
  });

  test("a stash is offered before a drop is demanded", () => {
    // Eleven on ten with an Out player and an empty IR slot: parking him is
    // the fix that loses nobody, so it leads the overage.
    const cell = rosterCell(
      league({
        roster_count: 11,
        roster_max: 10,
        ir_count: 0,
        ir_max: 1,
        ir: ir({ stashable: [irPlayer("out", "Out", true)] }),
      }),
    );
    assert.equal(cell.text, "1 to IR");
    assert.match(cell.title, /10 of 10, full/);
  });

  test("ineligible and over the allowance: the larger count wins, and both are said", () => {
    const cell = rosterCell(
      league({
        ir_count: 5,
        ir_max: 3,
        ir: ir({
          reserve: [irPlayer("fit", null, false), ...["a", "b", "c", "d"].map((id) => irPlayer(id, "IR", true))],
        }),
      }),
    );
    assert.equal(cell.text, "2 off IR");
    assert.match(cell.title, /FIT \(healthy\) is not IR-eligible, and IR is over its allowance \(5\/3\) — 2 must come off/);
  });

  test("a stash that outruns the free slots is capped by them", () => {
    const cell = rosterCell(
      league({
        ir_count: 2,
        ir_max: 3,
        ir: ir({
          reserve: [irPlayer("x", null, false), irPlayer("y", "Questionable", false)],
          stashable: ["a", "b", "c", "d", "e"].map((id) => irPlayer(id, "Out", true)),
        }),
      }),
    );
    assert.equal(cell.text, "2 off IR");
    assert.match(cell.title, /5 eligible for 3 slots/);
  });

  test("an unchecked IR keeps the census answer and says what it could not check", () => {
    // `Full` is a true count of a real roster; the IR half's absence is a
    // sentence in the title, never an em dash over a measured figure.
    const cell = rosterCell(league({ ir: null, ir_count: 0, ir_max: 2 }));
    assert.equal(cell.text, "Full");
    assert.equal(cell.state, "clear");
    assert.match(cell.title, /IR eligibility could not be checked/);
  });

  test("an unchecked IR in a league with no IR slots has nothing to say about it", () => {
    const cell = rosterCell(league({ ir: null, ir_count: 0, ir_max: 0 }));
    assert.equal(cell.state, "clear");
    assert.doesNotMatch(cell.title, /could not be checked/);
  });

  test("unread statuses are counted in the title and the tile still answers", () => {
    const cell = rosterCell(league({ ir_max: 2, ir: ir({ unknown: 2 }) }));
    assert.equal(cell.state, "clear");
    assert.match(cell.title, /2 player statuses unread/);
  });

  test("over the allowance with no eligibility read is still a player off", () => {
    const cell = rosterCell(league({ ir: null, ir_count: 4, ir_max: 3 }));
    assert.equal(cell.text, "1 off IR");
    assert.match(cell.title, /IR eligibility could not be checked/);
  });

  test("a locked player is not a stash, and the title says the room is there", () => {
    // An `Out` starter whose game has kicked off is a move Sleeper would
    // refuse this week, so the empty slot beside him is not `1 to IR` — but a
    // `Full` that said nothing about him would read as nothing to do.
    const cell = rosterCell(
      league({
        ir_count: 0,
        ir_max: 1,
        ir: ir({ stashable: [irPlayer("out", "Out", true, "OUT", true)] }),
      }),
    );
    assert.equal(cell.text, "Full");
    assert.equal(cell.state, "clear");
    assert.match(cell.title, /1 IR-eligible player locked this week/);
  });

  test("an unlocked candidate is stashed and a locked one is counted beside him", () => {
    const cell = rosterCell(
      league({
        ir_count: 0,
        ir_max: 2,
        ir: ir({
          stashable: [
            irPlayer("free", "Out", true),
            irPlayer("gone", "Out", true, "GONE", true),
          ],
        }),
      }),
    );
    assert.equal(cell.text, "1 to IR");
    assert.match(cell.title, /1 player eligible: FREE \(Out\)/);
    assert.match(cell.title, /1 IR-eligible player locked this week/);
  });

  test("taxi over its own allowance keeps its own arm", () => {
    const cell = rosterCell(league({ taxi_count: 3, taxi_max: 1 }));
    assert.equal(cell.text, "2 over taxi");
    assert.equal(cell.unit, "over taxi");
    assert.match(cell.title, /must come off/);
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

  test("an open roster spot is a reason, exactly as being over is", () => {
    const checked = { a: league({ roster_count: 8, roster_max: 10 }) };
    assert.equal(attentionByReason(leagues, checked).roster, 1);
    assert.equal(needsAttention(leagues, checked), 1);
  });

  test("only a full, legal roster is quiet", () => {
    const checked = { a: league({ roster_count: 10, roster_max: 10 }) };
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

  test("an IR move is a Roster-slots reason, not a fifth one", () => {
    const checked = {
      a: league({
        ir_count: 1,
        ir_max: 2,
        ir: ir({ reserve: [irPlayer("fit", null, false)] }),
      }),
      b: league({ ir_count: 0, ir_max: 1, ir: ir({ stashable: [irPlayer("out", "Out", true)] }) }),
    };
    assert.deepEqual(attentionByReason(leagues, checked), {
      points: 0,
      kickoff: 0,
      superflex: 0,
      roster: 2,
    });
    assert.equal(needsAttention(leagues, checked), 2);
  });
});

describe("irMoves", () => {
  test("no IR allowance on file is no reading", () => {
    assert.equal(irMoves(league({ ir_max: null })), null);
  });

  test("the four numbers on a worked case", () => {
    const moves = irMoves(
      league({
        roster_count: 10,
        roster_max: 10,
        ir_count: 1,
        ir_max: 2,
        ir: ir({
          reserve: [irPlayer("fit", null, false)],
          stashable: ["a", "b", "c"].map((id) => irPlayer(id, "Out", true)),
        }),
      }),
    )!;
    assert.equal(moves.checked, true);
    assert.equal(moves.off, 1);
    // Two slots, nobody left on them once he is off.
    assert.equal(moves.free, 2);
    assert.equal(moves.stash, 2);
    // Ten, plus one activated, less two parked.
    assert.equal(moves.after, 9);
  });

  test("an unchecked reading still counts the overflow, and nothing else", () => {
    const moves = irMoves(league({ ir: null, ir_count: 4, ir_max: 3 }))!;
    assert.equal(moves.checked, false);
    assert.equal(moves.off, 1);
    assert.deepEqual(moves.candidates, []);
    assert.deepEqual(moves.ineligible, []);
    assert.equal(moves.unknown, 0);
  });

  test("free floors at zero, so a league with no slots stashes nobody", () => {
    const candidates = ["a", "b", "c"].map((id) => irPlayer(id, "Out", true));
    const none = irMoves(league({ ir_count: 0, ir_max: 0, ir: ir({ stashable: candidates }) }))!;
    assert.equal(none.free, 0);
    assert.equal(none.stash, 0);
    // Over the allowance with the overflow coming off leaves no slot either.
    const over = irMoves(
      league({
        ir_count: 5,
        ir_max: 3,
        ir: ir({ reserve: ["a", "b", "c", "d", "e"].map((id) => irPlayer(id, "IR", true)), stashable: candidates }),
      }),
    )!;
    assert.equal(over.off, 2);
    assert.equal(over.free, 0);
    assert.equal(over.stash, 0);
  });
});

describe("irMarkFor", () => {
  const moves = irMoves(
    league({
      ir_count: 2,
      ir_max: 3,
      ir: ir({
        reserve: [irPlayer("fit", null, false), irPlayer("hurt", "IR", true), irPlayer("ghost", null, null)],
        stashable: [irPlayer("out", "Out", true)],
      }),
    }),
  );

  test("a player on IR wears IR, and off IR where the league does not admit him", () => {
    assert.equal(irMarkFor("fit", moves), "off");
    assert.equal(irMarkFor("hurt", moves), "on");
    // Unjudged is still on IR; it is not a verdict either way.
    assert.equal(irMarkFor("ghost", moves), "on");
  });

  test("a candidate wears the move only while there is a slot for one", () => {
    assert.equal(irMarkFor("out", moves), "to");
    const full = irMoves(
      league({ ir_count: 1, ir_max: 1, ir: ir({ reserve: [irPlayer("hurt", "IR", true)], stashable: [irPlayer("out", "Out", true)] }) }),
    );
    assert.equal(irMarkFor("out", full), null);
  });

  test("a locked candidate wears nothing, whatever the room", () => {
    const withLock = irMoves(
      league({
        ir_count: 0,
        ir_max: 2,
        ir: ir({ stashable: [irPlayer("out", "Out", true, "OUT", true), irPlayer("free", "Out", true)] }),
      }),
    );
    assert.equal(irMarkFor("out", withLock), null);
    assert.equal(irMarkFor("free", withLock), "to");
    assert.equal(withLock?.lockedOut, 1);
  });

  test("anybody else, and any row with no reading, wears nothing", () => {
    assert.equal(irMarkFor("qb", moves), null);
    assert.equal(irMarkFor("fit", null), null);
  });
});

/**
 * The phone's split and the desktop's scope line.
 *
 * Pinned as the whole quartet per arm rather than as a relation between the
 * fields, because there is no relation: `text` is the reading with room for it
 * and `figure`/`unit` is the same reading without, and the two are written side
 * by side precisely so no rule has to turn one into the other. What a test can
 * catch is one of them being edited and the other left.
 */
describe("a tile's two shapes", () => {
  test("the gap splits into a numeral and its unit, and names its scope", () => {
    const cell = gapCell(league({ current_points: 120, optimal_points: 126.6, points_left: 6.6 }));
    assert.equal(cell.text, "−6.6");
    assert.equal(cell.figure, "−6.6");
    // The one unit the desktop leaves off — see the arm's own note.
    assert.equal(cell.unit, "pts");
    assert.equal(cell.scope, "Best reachable");
  });

  test("a cleared check has no figure, because the mark is the figure", () => {
    // `text` survives as the mark's accessible name and `unit` is what the
    // phone prints under it; neither may go, and the numeral is what does.
    for (const cell of [
      gapCell(league()),
      kickoffCell(league({ kickoff_moves: 0 })),
      superflexCell(league({ lineup: [seat("SUPER_FLEX", ["QB"])] })),
      rosterCell(league({ roster_count: 10, roster_max: 10 })),
    ]) {
      assert.equal(cell.state, "clear");
      assert.equal(cell.figure, "");
      assert.notEqual(cell.unit, "");
      assert.notEqual(cell.text, "");
    }
  });

  test("a league nothing could be read for names no scope at all", () => {
    // Empty rather than the population it *would* have measured: a line saying
    // what was checked is a claim that something was.
    for (const cell of [
      gapCell(undefined),
      kickoffCell(undefined),
      superflexCell(undefined),
      rosterCell(league({ roster_max: null })),
    ]) {
      assert.equal(cell.state, "none");
      assert.equal(cell.figure, "—");
      assert.equal(cell.scope, "");
    }
  });

  test("the two absences a kickoff tile has are told apart on the scope line", () => {
    // Both draw an em dash. Only the scope says which — a best-ball league has
    // no seat order to set, where an ordinary one is waiting on Sleeper.
    assert.equal(kickoffCell(league({ best_ball: true, kickoff_moves: null })).scope, "Sleeper seats it");
    assert.equal(kickoffCell(league({ kickoff_moves: null })).scope, "No kickoff times");
  });

  test("superflex names the population its figure counts a subset of", () => {
    // `1 non-QB` reads very differently against one seat than against three,
    // and the seats are the one thing a reader cannot see from the tile.
    const one = superflexCell(league({ lineup: [seat("SUPER_FLEX", ["RB"])] }));
    assert.equal(one.figure, "1");
    assert.equal(one.unit, "non-QB");
    assert.equal(one.scope, "1 QB seat");

    const two = superflexCell(
      league({ lineup: [seat("SUPER_FLEX", ["RB"]), seat("SUPER_FLEX", ["QB"])] }),
    );
    assert.equal(two.scope, "2 QB seats");
  });

  test("the roster scope is the population, not the figure", () => {
    // Every roster arm is read against the same pair, so no arm restates it.
    for (const cell of [
      rosterCell(league({ roster_count: 8, roster_max: 10 })),
      rosterCell(league({ roster_count: 11, roster_max: 10 })),
      rosterCell(league({ roster_count: 10, roster_max: 10 })),
      rosterCell(
        league({ ir_count: 1, ir_max: 2, ir: ir({ reserve: [irPlayer("fit", null, false)] }) }),
      ),
      rosterCell(
        league({ ir_count: 0, ir_max: 1, ir: ir({ stashable: [irPlayer("out", "Out", true)] }) }),
      ),
    ]) {
      assert.equal(cell.scope, `${cell.scope.split(" ")[0]} of 10 held`);
    }
    assert.equal(rosterCell(league({ roster_count: 8, roster_max: 10 })).scope, "8 of 10 held");
  });

  test("best ball draws a dash and says why underneath", () => {
    // `Best ball` at `--fs-17` is wider than the phone tile, so the words go
    // to the unit line and the figure is the dash every no-answer draws.
    const cell = gapCell(league({ best_ball: true }));
    assert.equal(cell.text, "Best ball");
    assert.equal(cell.figure, "—");
    assert.equal(cell.unit, "best ball");
    assert.equal(cell.scope, "Sleeper seats it");
  });
});
