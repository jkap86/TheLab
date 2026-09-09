import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { WeekProjections } from "../projections/week.ts";
import type { GameClock } from "../schedule/game-clock.ts";
import { gameBoard, solveGametimeLeague } from "./gametime.ts";
import type { WeekLineupLeague } from "./week-lineups.ts";

const SCORING = { pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, rec: 1 };

function league(over: Partial<WeekLineupLeague> = {}): WeekLineupLeague {
  return {
    league_id: "L1",
    roster_positions: ["QB", "RB", "RB", "WR", "FLEX", "BN", "BN"],
    scoring_settings: SCORING,
    best_ball: false,
    settings: null,
    roster_id: 1,
    starters: ["qb", "rb1", "rb2", "wr1", "flex"],
    players: ["qb", "rb1", "rb2", "wr1", "flex", "bench1", "bench2"],
    roster_players: null,
    reserve: null,
    taxi: null,
    as_of: "week",
    opponent: null,
    median_rosters: null,
    ...over,
  };
}

function row(
  id: string,
  team: string | null,
  stats: Record<string, number> | null,
  positions = ["RB"],
): WeekProjections[string] {
  return { player_id: id, stats, name: id.toUpperCase(), positions, team, game_date: team ? "2026-09-13" : null };
}

const PROJECTIONS: WeekProjections = {
  qb: row("qb", "BUF", { pass_yd: 250 }, ["QB"]), // 10.0
  rb1: row("rb1", "KC", { rush_yd: 100 }), // 10.0
  rb2: row("rb2", "DAL", { rush_yd: 80 }), // 8.0
  wr1: row("wr1", "MIA", { rec_yd: 90, rec: 6 }, ["WR"]), // 15.0
  flex: row("flex", null, null), // bye: a real projected zero
  bench1: row("bench1", "KC", { rush_yd: 50 }), // 5.0
  bench2: row("bench2", "DAL", { rec_yd: 40, rec: 4 }, ["WR"]), // 8.0
};

const STATS: WeekProjections = {
  qb: row("qb", "BUF", { pass_yd: 125 }, ["QB"]), // 5.0 so far
  rb1: row("rb1", "KC", { rush_yd: 120 }), // 12.0, final
  bench1: row("bench1", "KC", { rush_yd: 20 }), // 2.0, final
  // rb2 (DAL): running, no line yet → a real zero
};

function clock(over: Partial<GameClock>): GameClock {
  return {
    game_id: "g",
    phase: "pre",
    remaining: 1,
    quarter: null,
    clock: null,
    overtime: false,
    kickoff: Date.UTC(2026, 8, 13, 17),
    opponent: null,
    home: true,
    score: null,
    ...over,
  };
}

const CLOCKS = new Map<string, GameClock>([
  ["BUF", clock({ phase: "live", remaining: 0.5, quarter: 2, clock: "15:00", score: { team: 7, opponent: 3 } })],
  ["KC", clock({ phase: "final", remaining: 0, score: { team: 24, opponent: 17 } })],
  ["DAL", clock({ phase: "live", remaining: 0.75, quarter: 1, clock: "07:30", score: { team: 0, opponent: 0 } })],
  ["MIA", clock({ phase: "pre", remaining: 1 })],
]);

const BOARDS = { projections: PROJECTIONS, stats: STATS, clocks: CLOCKS };

describe("solveGametimeLeague", () => {
  test("a live projection is scored plus projected times the share of the game left", () => {
    const solved = solveGametimeLeague(league(), BOARDS);
    assert.ok(solved);
    const seats = Object.fromEntries(solved.mine.lineup.map((s) => [s.player!.player_id, s.player!]));

    // Half played: 5 so far + 10 × 0.5.
    assert.equal(seats.qb.scored, 5);
    assert.equal(seats.qb.projected, 10);
    assert.equal(seats.qb.live, 10);

    // Final: what he scored is what he scores.
    assert.equal(seats.rb1.scored, 12);
    assert.equal(seats.rb1.live, 12);

    // Running with no line yet: a real zero so far, most of the projection left.
    assert.equal(seats.rb2.scored, 0);
    assert.equal(seats.rb2.live, 6);

    // Not kicked off: nothing scored *yet*, the projection whole.
    assert.equal(seats.wr1.scored, null);
    assert.equal(seats.wr1.live, 15);

    // A bye: a projected zero, nothing to have scored.
    assert.equal(seats.flex.scored, null);
    assert.equal(seats.flex.projected, 0);
    assert.equal(seats.flex.live, 0);
  });

  test("the side totals are the sums of the seats, and the seats add up to the plate", () => {
    const solved = solveGametimeLeague(league(), BOARDS)!;
    assert.equal(solved.mine.scored, 17);
    assert.equal(solved.mine.projected, 43);
    assert.equal(solved.mine.live, 43);
    const sum = solved.mine.lineup.reduce((acc, s) => acc + (s.player?.live ?? 0), 0);
    assert.equal(Number(sum.toFixed(2)), solved.mine.live);
  });

  test("the status counts starters by phase, with an empty seat and a bye as done", () => {
    const solved = solveGametimeLeague(league({ starters: ["qb", "rb1", "0", "wr1", "flex"] }), BOARDS)!;
    assert.deepEqual(solved.mine.status, { done: 3, live: 1, pending: 1 });
    assert.equal(solved.mine.lineup[2].player, null);
  });

  test("the bench is everyone unseated, live projection first", () => {
    const solved = solveGametimeLeague(league(), BOARDS)!;
    assert.deepEqual(
      solved.mine.bench.map((p) => [p.player_id, p.live]),
      [
        ["bench2", 6], // 0 scored (running), 8 × 0.75
        ["bench1", 2], // final
      ],
    );
  });

  test("an unrecognised slot drops the same index from the starters", () => {
    const solved = solveGametimeLeague(
      league({ roster_positions: ["QB", "MYSTERY", "RB", "BN"], starters: ["qb", "rb1", "rb2"] }),
      BOARDS,
    )!;
    assert.deepEqual(solved.unknown_slots, ["MYSTERY"]);
    assert.deepEqual(solved.mine.lineup.map((s) => [s.slot, s.player?.player_id]), [
      ["QB", "qb"],
      ["RB", "rb2"],
    ]);
    // rb1 was dropped with its slot, so he is unseated and on the bench.
    assert.ok(solved.mine.bench.some((p) => p.player_id === "rb1"));
  });

  test("no slots on file is no answer", () => {
    assert.equal(solveGametimeLeague(league({ roster_positions: null }), BOARDS), null);
  });

  test("a stats feed that could not be read leaves every scored null and prices the projection whole", () => {
    const solved = solveGametimeLeague(league(), { ...BOARDS, stats: null })!;
    for (const seat of solved.mine.lineup) assert.equal(seat.player?.scored, null);
    const qb = solved.mine.lineup[0].player!;
    assert.equal(qb.live, 5); // 10 × 0.5 — the clock still applies
  });

  test("a scoreboard that could not be read prices a line as half played and the rest whole", () => {
    const solved = solveGametimeLeague(league(), { ...BOARDS, clocks: null })!;
    const seats = Object.fromEntries(solved.mine.lineup.map((s) => [s.player!.player_id, s.player!]));
    assert.equal(seats.qb.live, 10); // 5 + 10 × 0.5
    assert.equal(seats.wr1.live, 15); // no line: the projection whole
    assert.equal(seats.rb2.scored, null); // no line, no clock: nothing to say
    // A line means started; no line means not — and nothing is a bye without a scoreboard to say so.
    assert.deepEqual(solved.mine.status, { done: 0, live: 2, pending: 3 });
  });

  test("the opponent is priced the same way, and null where there is none", () => {
    const solved = solveGametimeLeague(
      league({
        opponent: { roster_id: 2, team_name: "Them", starters: ["bench1", "bench2", "0", "0", "0"], players: ["bench1", "bench2"] },
      }),
      BOARDS,
    )!;
    assert.ok(solved.opponent);
    assert.equal(solved.opponent.team_name, "Them");
    assert.equal(solved.opponent.scored, 2);
    assert.equal(solved.opponent.live, 8);
    assert.equal(solveGametimeLeague(league(), BOARDS)!.opponent, null);
  });

  test("the median substitutes the manager's own side and takes the middle of each figure", () => {
    const solved = solveGametimeLeague(
      league({
        median_rosters: [
          { roster_id: 1, starters: ["0", "0", "0", "0", "0"], players: [] }, // substituted, not re-solved
          { roster_id: 2, starters: ["bench1", "0", "0", "0", "0"], players: ["bench1"] }, // live 2
          { roster_id: 3, starters: ["bench2", "0", "0", "0", "0"], players: ["bench2"] }, // live 6
        ],
      }),
      BOARDS,
    )!;
    assert.deepEqual(solved.median, { scored: 2, projected: 8, live: 6 });
    assert.equal(solveGametimeLeague(league({ median_rosters: [{ roster_id: 1, starters: [], players: [] }] }), BOARDS)!.median, null);
  });
});

describe("gameBoard", () => {
  test("restates every clock by team and answers empty for no scoreboard", () => {
    const board = gameBoard(CLOCKS);
    assert.deepEqual(Object.keys(board).sort(), ["BUF", "DAL", "KC", "MIA"]);
    assert.equal(board.BUF.phase, "live");
    assert.equal(board.BUF.quarter, 2);
    assert.deepEqual(board.BUF.score, { team: 7, opponent: 3 });
    assert.equal(board.MIA.phase, "pre");
    assert.deepEqual(gameBoard(null), {});
  });
});
