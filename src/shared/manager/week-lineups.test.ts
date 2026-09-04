import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { solveWeekLineup } from "./week-lineups.ts";
import type { WeekLineupLeague } from "./week-lineups.ts";
import type { WeekProjections } from "../projections/week.ts";

const SLOTS = ["QB", "RB", "WR", "FLEX", "BN", "BN"];

function league(over: Partial<WeekLineupLeague> = {}): WeekLineupLeague {
  return {
    league_id: "L1",
    roster_positions: SLOTS,
    // One point per receiving yard keeps the arithmetic in the tests obvious.
    scoring_settings: { rec_yd: 1 },
    best_ball: false,
    settings: null,
    roster_id: 1,
    starters: ["qb", "rb", "wr", "flexlow"],
    players: ["qb", "rb", "wr", "flexlow", "flexhigh", "nobody"],
    roster_players: ["qb", "rb", "wr", "flexlow", "flexhigh", "nobody"],
    reserve: null,
    taxi: null,
    as_of: "week",
    opponent: null,
    ...over,
  };
}

/** A board where `flexhigh` is worth more than the `flexlow` actually started. */
function board(): WeekProjections {
  const player = (
    id: string,
    positions: string[],
    yards: number | null,
    team: string | null = "KC",
  ) => ({
    player_id: id,
    stats: yards === null ? null : { rec_yd: yards },
    name: id.toUpperCase(),
    positions,
    team,
    game_date: yards === null ? null : "2026-10-18",
  });

  return {
    qb: player("qb", ["QB"], 10),
    rb: player("rb", ["RB"], 10),
    wr: player("wr", ["WR"], 10),
    flexlow: player("flexlow", ["WR"], 5),
    flexhigh: player("flexhigh", ["WR"], 20, "BUF"),
    // On a bye: a real row, no game, so a real projected zero.
    nobody: player("nobody", ["WR"], null),
  };
}

const NO_LOCKS = new Set<string>();

/** The other side of the same game, starting the two best players on the board. */
const OPPONENT = {
  roster_id: 2,
  starters: ["qb", "rb", "wr", "flexhigh"],
  players: ["qb", "rb", "wr", "flexhigh"],
};

describe("solveWeekLineup", () => {
  test("reports the gap between the lineup set and the best one reachable", () => {
    const solved = solveWeekLineup(league(), board(), NO_LOCKS, null);
    assert.ok(solved);
    // 10 + 10 + 10 + 5 started; swapping flexhigh (20) for flexlow (5) is +15.
    assert.equal(solved.current_points, 35);
    assert.equal(solved.optimal_points, 50);
    assert.equal(solved.points_left, 15);
    assert.deepEqual(solved.start, ["flexhigh"]);
    assert.deepEqual(solved.sit, ["flexlow"]);
  });

  test("a league with no slots on file answers null, not zero", () => {
    // A gap quoted against slots we don't have is not a smaller answer, it is a
    // wrong one — the route drops the league instead.
    assert.equal(
      solveWeekLineup(league({ roster_positions: null }), board(), NO_LOCKS, null),
      null,
    );
  });

  test("a player the feed has no row for keeps null points but is still seated", () => {
    const solved = solveWeekLineup(
      league({ players: ["qb", "rb", "wr", "flexlow", "ghost"] }),
      board(),
      NO_LOCKS,
      null,
    );
    const ghost = solved?.bench.find((p) => p.player_id === "ghost");
    assert.ok(ghost, "the unknown player is still on the bench");
    assert.equal(ghost.points, null, "null is 'no row', never a projected zero");
  });

  test("a bye-week player is a real zero rather than a null", () => {
    const solved = solveWeekLineup(league(), board(), NO_LOCKS, null);
    const bye = solved?.bench.find((p) => p.player_id === "nobody");
    assert.equal(bye?.points, 0);
  });

  test("a started player missing from the roster array is still priced", () => {
    // The two Sleeper arrays can disagree for a moment after a move; dropping
    // him would credit the lineup with one fewer player than it is fielding.
    const solved = solveWeekLineup(
      league({ players: ["rb", "wr", "flexlow"] }),
      board(),
      NO_LOCKS,
      null,
    );
    assert.equal(solved?.current_points, 35);
  });

  test("a locked player keeps his seat, and the upgrade reroutes around him", () => {
    // flexlow has played: he is still scoring, but he is no longer a choice, so
    // his FLEX seat is held exactly as it stands and he is out of the pool for
    // every other seat. That does not make the roster optimal — flexhigh can
    // still be seated, just not *there* — so the gap narrows from 15 to 10 and
    // the swap lands on WR instead. Reporting 0 here would be the failure this
    // pins: "your lineup is set" while 10 points are still gettable.
    const solved = solveWeekLineup(
      league(),
      board(),
      new Set(["flexlow"]),
      null,
    );
    assert.equal(
      solved?.lineup.find((s) => s.slot === "FLEX")?.player?.player_id,
      "flexlow",
      "the played seat is held as it stands",
    );
    assert.equal(solved?.points_left, 10);
    assert.deepEqual(solved?.start, ["flexhigh"]);
    assert.deepEqual(solved?.sit, ["wr"], "the move routes through a free seat");
  });

  test("locking every movable seat leaves nothing to recommend", () => {
    // The end state of the week: every game played, so `points_left` is 0 and
    // it is a real answer rather than an absence.
    const solved = solveWeekLineup(
      league(),
      board(),
      new Set(["qb", "rb", "wr", "flexlow"]),
      null,
    );
    assert.equal(solved?.points_left, 0);
    assert.deepEqual(solved?.start, []);
    assert.deepEqual(solved?.sit, []);
  });

  test("the lock rides through to each player on the wire", () => {
    const solved = solveWeekLineup(league(), board(), new Set(["qb"]), null);
    const qb = solved?.lineup.find((s) => s.player?.player_id === "qb");
    assert.equal(qb?.player?.locked, true);
  });
});

describe("solveWeekLineup and kickoff order", () => {
  // WR in the strict seat kicks off late; WR in the flex kicks off early. The
  // ordering wants those swapped so the flex — which more players are eligible
  // for — stays open longest.
  const KICKOFFS = new Map([
    ["KC", Date.UTC(2026, 9, 18, 17, 0)],
    ["BUF", Date.UTC(2026, 9, 18, 20, 25)],
  ]);

  test("null kickoffs mean no answer, never 'already in order'", () => {
    const solved = solveWeekLineup(league(), board(), NO_LOCKS, null);
    assert.equal(solved?.kickoff_moves, null);
    assert.ok(solved?.lineup.every((seat) => seat.move_to === null));
  });

  test("a lineup already seated for kickoff reports zero moves, not null", () => {
    // `wr` (KC, early) holds the strict WR seat and `flexhigh` (BUF, late) holds
    // FLEX — which is the order: the late game keeps the flexible seat open.
    // Zero is a real and good answer; the card prints "in order" for it.
    const solved = solveWeekLineup(
      league({ starters: ["qb", "rb", "wr", "flexhigh"] }),
      board(),
      NO_LOCKS,
      KICKOFFS,
    );
    assert.equal(solved?.kickoff_moves, 0);
  });

  test("a later kickoff in a strict seat is asked to trade with the flex", () => {
    const solved = solveWeekLineup(
      // Backwards: `flexhigh` (BUF, late) is stuck in the strict WR seat while
      // `wr` (KC, early) spends the flex. The early game should take the seat
      // only one position can fill, and the late game should keep the choice.
      league({ starters: ["qb", "rb", "flexhigh", "wr"] }),
      board(),
      NO_LOCKS,
      KICKOFFS,
    );
    assert.equal(solved?.kickoff_moves, 2);
    const marks = new Map(
      solved?.lineup
        .filter((s) => s.move_to)
        .map((s) => [s.player?.player_id, s.move_to]),
    );
    assert.deepEqual(marks, new Map([["flexhigh", "FLEX"], ["wr", "WR"]]));
  });

  test("kickoffs within the hour buffer generate no move", () => {
    // The Sunday 4:05/4:25 case: two kickoffs, one decision. Asking a manager
    // to trade seats over twenty minutes is a press that buys nothing.
    const close = new Map([
      ["KC", Date.UTC(2026, 9, 18, 20, 5)],
      ["BUF", Date.UTC(2026, 9, 18, 20, 25)],
    ]);
    const solved = solveWeekLineup(
      league({ starters: ["qb", "rb", "flexhigh", "wr"] }),
      board(),
      NO_LOCKS,
      close,
    );
    assert.equal(solved?.kickoff_moves, 0);
  });
});

describe("solveWeekLineup in a best-ball league", () => {
  test("reports no gap and no seat order, because there is no lineup to set", () => {
    // Sleeper seats a best-ball lineup itself, from the whole roster, after the
    // games — so a gap against the `starters` array is advice nobody can act on
    // and a seat order is a choice nobody makes.
    const solved = solveWeekLineup(
      league({ best_ball: true }),
      board(),
      NO_LOCKS,
      new Map([["KC", 1], ["BUF", 2]]),
    );
    assert.equal(solved?.points_left, 0);
    assert.equal(solved?.kickoff_moves, null);
    assert.deepEqual(solved?.start, []);
    assert.deepEqual(solved?.sit, []);
  });
});

describe("solveWeekLineup against a scheduled opponent", () => {
  test("projects the opponent's lineup as set, on this league's scoring", () => {
    const solved = solveWeekLineup(
      league({ opponent: OPPONENT }),
      board(),
      NO_LOCKS,
      null,
    );
    // 10 + 10 + 10 + 20: what the other roster is actually starting, not the
    // best it could start.
    assert.equal(solved?.opponent_points, 50);
    assert.equal(solved?.current_points, 35);
  });

  test("answers null with no opponent, never a zero", () => {
    // A zero here is a roster projected to score nothing, which the card would
    // draw as a win. No opponent is no answer.
    const solved = solveWeekLineup(league(), board(), NO_LOCKS, null);
    assert.equal(solved?.opponent_points, null);
  });

  test("prices both sides through the same recognised slots", () => {
    // A slot this build doesn't know is dropped from the manager's lineup by
    // `compareLineup`. Summing the opponent's starters instead would leave
    // theirs whole and read as a loss caused by the slot name alone.
    const solved = solveWeekLineup(
      league({
        roster_positions: ["QB", "RB", "WR", "WEIRD_SLOT", "BN"],
        starters: ["qb", "rb", "wr", "flexlow"],
        opponent: { ...OPPONENT, starters: ["qb", "rb", "wr", "flexhigh"] },
      }),
      board(),
      NO_LOCKS,
      null,
    );
    assert.deepEqual(solved?.unknown_slots, ["WEIRD_SLOT"]);
    // Three seats each, the fourth dropped from both.
    assert.equal(solved?.current_points, 30);
    assert.equal(solved?.opponent_points, 30);
  });

  test("a best-ball opponent is projected on the lineup Sleeper will seat", () => {
    // Sleeper seats a best-ball lineup after the games, so the opponent's real
    // projection is their optimal one — the same rule that makes the manager's
    // own gap zero.
    const solved = solveWeekLineup(
      league({
        best_ball: true,
        opponent: { ...OPPONENT, starters: ["qb", "rb", "wr", "flexlow"], players: ["qb", "rb", "wr", "flexlow", "flexhigh"] },
      }),
      board(),
      NO_LOCKS,
      null,
    );
    // flexhigh (20) is seated over the flexlow (5) that was nominally started.
    assert.equal(solved?.opponent_points, 50);
  });
});

describe("solveWeekLineup and the roster census", () => {
  test("counts the roster against its own slots, IR and taxi apart", () => {
    // Six seats less the IR and the TAXI is four roster spots; the two parked
    // players do not occupy any of them.
    const solved = solveWeekLineup(
      league({
        roster_positions: ["QB", "RB", "WR", "FLEX", "BN", "IR", "TAXI"],
        roster_players: ["qb", "rb", "wr", "flexlow", "flexhigh", "nobody"],
        reserve: ["flexhigh"],
        taxi: ["nobody"],
      }),
      board(),
      NO_LOCKS,
      null,
    );
    assert.equal(solved?.roster_count, 4);
    assert.equal(solved?.roster_max, 5);
    assert.equal(solved?.ir_count, 1);
    assert.equal(solved?.ir_max, 1);
    assert.equal(solved?.taxi_count, 1);
    assert.equal(solved?.taxi_max, 1);
  });

  test("a bench spot is a roster spot", () => {
    // `BN` counts where `IR` and `TAXI` do not: a bench player is held against
    // the roster limit, which is exactly the arithmetic Sleeper refuses an add
    // on.
    const solved = solveWeekLineup(
      league({ roster_positions: ["QB", "RB", "WR", "FLEX", "BN", "BN"] }),
      board(),
      NO_LOCKS,
      null,
    );
    assert.equal(solved?.roster_max, 6);
  });

  test("Sleeper's slot padding is not a player", () => {
    // The arrays are stored verbatim, `""` and `"0"` included, so a raw
    // `.length` would report a roster two deeper than it is.
    const solved = solveWeekLineup(
      league({ roster_players: ["qb", "0", "rb", "", "wr"] }),
      board(),
      NO_LOCKS,
      null,
    );
    assert.equal(solved?.roster_count, 3);
  });

  test("settings state a limit the slots do not", () => {
    // Some leagues express the two spare squads only in settings, and some only
    // as seats. Settings win where both are on file.
    const solved = solveWeekLineup(
      league({
        roster_positions: ["QB", "RB", "WR", "FLEX", "BN", "IR"],
        settings: { reserve_slots: 3, taxi_slots: 4 },
      }),
      board(),
      NO_LOCKS,
      null,
    );
    assert.equal(solved?.ir_max, 3);
    assert.equal(solved?.taxi_max, 4);
  });

  test("a league with no taxi squad has none — a real zero, not an absence", () => {
    // Sleeper omits the key entirely, and the seats say the same thing. Zero is
    // the honest answer and is what lets the tile stay quiet about it.
    const solved = solveWeekLineup(league(), board(), NO_LOCKS, null);
    assert.equal(solved?.taxi_max, 0);
    assert.equal(solved?.ir_max, 0);
  });
});
