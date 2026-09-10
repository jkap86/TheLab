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

  test("a managed league's in-play count is its seats, and no more", () => {
    // qb (BUF, live) and rb2 (DAL, live) are the running seats; bench2 (DAL)
    // is running too and is deliberately *not* counted — in a managed league
    // the lineup as set is what will be scored, so the seats are the whole
    // population.
    const solved = solveGametimeLeague(league(), BOARDS)!;
    assert.equal(solved.mine.status.live, 2);
    assert.equal(solved.mine.players_in_play, 2);
  });

  test("the in-play count follows the phases rather than the stats feed", () => {
    // A scoreboard nobody could read reads a stat line as a game that has at
    // least started, which is the same reading the projection is priced by —
    // so the count and the figure beside it on the card degrade together.
    const solved = solveGametimeLeague(league(), { ...BOARDS, clocks: null })!;
    assert.equal(solved.mine.players_in_play, 2); // qb and rb1 have lines
    // And a stats feed that is down costs the count nothing: the phases are
    // the scoreboard's.
    assert.equal(
      solveGametimeLeague(league(), { ...BOARDS, stats: null })!.mine.players_in_play,
      2,
    );
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
    // The test's own name was the specification and the assertion under it was
    // the bug: charging a player the elapsed clock with no feed to say what he
    // has scored prices him on the arithmetic that he has scored *nothing*,
    // which is a wrong number rather than a missing one — and one that falls
    // further as the afternoon wears on. The page's note ("showing the
    // projections until Sleeper answers") is what the numbers now do.
    const solved = solveGametimeLeague(league(), { ...BOARDS, stats: null })!;
    for (const seat of solved.mine.lineup) assert.equal(seat.player?.scored, null);
    const seats = Object.fromEntries(solved.mine.lineup.map((s) => [s.player!.player_id, s.player!]));
    assert.equal(seats.qb.live, 10); // half played, and still the projection whole
    assert.equal(seats.rb1.live, 10); // final, and still the projection whole
    assert.equal(seats.wr1.live, 15); // not kicked off — unchanged either way
    assert.equal(seats.flex.live, 0); // a bye is a projected zero either way
    // The status counts are the scoreboard's and are untouched by a stats feed.
    assert.deepEqual(solved.mine.status, { done: 2, live: 2, pending: 1 });
  });

  test("a stats feed down prices the projection whole in every quarter", () => {
    // The elapsed clock is only ever spent against what the feed says has been
    // realised; with no feed there is nothing to spend it against, whatever the
    // clock reads.
    for (const [quarter, remaining] of [
      ["pre", 1],
      ["q1", 0.8],
      ["q2", 0.55],
      ["q3", 0.3],
      ["q4", 0.05],
      ["final", 0],
    ] as const) {
      const clocks = new Map(CLOCKS);
      clocks.set(
        "BUF",
        clock(
          quarter === "pre"
            ? { phase: "pre", remaining: 1 }
            : quarter === "final"
              ? { phase: "final", remaining: 0 }
              : { phase: "live", remaining },
        ),
      );
      const solved = solveGametimeLeague(league(), { ...BOARDS, stats: null, clocks })!;
      const qb = solved.mine.lineup[0].player!;
      assert.equal(qb.scored, null, quarter);
      assert.equal(qb.live, 10, quarter);
    }
  });

  test("a healthy stats feed with no row for one player is still a real zero", () => {
    // The distinction the whole degraded path turns on: `rb2`'s game is
    // running and the feed carries no line for him, which is nothing scored so
    // far rather than nothing known.
    const solved = solveGametimeLeague(league(), BOARDS)!;
    const rb2 = solved.mine.lineup.find((s) => s.player?.player_id === "rb2")!.player!;
    assert.equal(rb2.scored, 0);
    assert.equal(rb2.live, 6); // 0 + 8 × 0.75 — the clock does apply
  });

  test("the two feeds fail independently", () => {
    // A scoreboard nobody could read costs the clocks and nothing else; a
    // stats feed nobody could read costs the realised half and nothing else.
    const noClocks = solveGametimeLeague(league(), { ...BOARDS, clocks: null })!;
    assert.equal(noClocks.mine.lineup[0].player!.scored, 5);
    const noStats = solveGametimeLeague(league(), { ...BOARDS, stats: null })!;
    assert.equal(noStats.mine.lineup[0].player!.scored, null);
    const neither = solveGametimeLeague(league(), { ...BOARDS, stats: null, clocks: null })!;
    assert.equal(neither.mine.lineup[0].player!.scored, null);
    assert.equal(neither.mine.lineup[0].player!.live, 10);
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

/**
 * The three shapes `readWeekFeeds` hands the solve as the scoreboard read goes
 * wrong and comes back.
 *
 * The layer above is what decides which shape a failed read produces — a stale
 * map on `clocks` for the wire and **null on `pricingClocks`** for this — and
 * that one line is pinned in `gametime/live-wiring.test.ts`, since `feeds.ts`
 * reaches Sleeper and cannot be loaded here. What is tested here is the half
 * that matters to a reader: that the fallback the solve takes when it is handed
 * null is the safe one, and that nothing about a *healthy* clock changes on
 * either side of the outage.
 */
describe("solveGametimeLeague, a scoreboard going out and coming back", () => {
  /** A healthy read: the same map on both fields. */
  const HEALTHY = { projections: PROJECTIONS, stats: STATS, clocks: CLOCKS };
  /**
   * A failed read with a cached map held: the wire still shows `Q2 15:00` on
   * Buffalo, and the solve is handed nothing rather than that instant.
   */
  const STALE = { projections: PROJECTIONS, stats: STATS, clocks: null };

  test("a healthy clock prices against the clock", () => {
    const seats = Object.fromEntries(
      solveGametimeLeague(league(), HEALTHY)!.mine.lineup.map((s) => [s.player!.player_id, s.player!]),
    );
    assert.equal(seats.qb.live, 10); // 5 + 10 × 0.5
    assert.equal(seats.rb2.live, 6); // 0 + 8 × 0.75
    assert.equal(seats.wr1.live, 15); // not kicked off
  });

  test("a failed read does not go on dividing a dead clock into the roster", () => {
    // The whole failure: Buffalo was at halftime when the scoreboard stopped
    // answering, and priced from that stale instant the quarterback would read
    // 10.0 for the rest of the afternoon while his stat line climbed.
    const seats = Object.fromEntries(
      solveGametimeLeague(league(), STALE)!.mine.lineup.map((s) => [s.player!.player_id, s.player!]),
    );
    // A stat line means his game has at least started, and half is the reading
    // with the least possible error against a clock nobody can see.
    assert.equal(seats.qb.scored, 5);
    assert.equal(seats.qb.live, 10); // 5 + 10 × 0.5 — the *fallback* half, not the clock's
    // A player with a line whose real clock said `final` is now read as half
    // played, which under-reads rather than over-reads.
    assert.equal(seats.rb1.scored, 12);
    assert.equal(seats.rb1.live, 17); // 12 + 10 × 0.5
    // And no line means not started: the projection whole, never a zero.
    assert.equal(seats.wr1.scored, null);
    assert.equal(seats.wr1.live, 15);
    assert.equal(seats.rb2.scored, null); // no line and no clock to make it a zero
    assert.equal(seats.rb2.live, 8);
  });

  test("recovery puts every figure back exactly where it was", () => {
    const before = solveGametimeLeague(league(), HEALTHY)!;
    solveGametimeLeague(league(), STALE);
    const after = solveGametimeLeague(league(), HEALTHY)!;
    assert.deepEqual(after.mine, before.mine);
  });

  test("the status counts go to the unknown reading rather than to a bye", () => {
    // With no clocks nothing can be called done: a stat line is `live` and no
    // line is `pending`, which is what the checker's own fallback does.
    assert.deepEqual(solveGametimeLeague(league(), STALE)!.mine.status, {
      done: 0,
      live: 2,
      pending: 3,
    });
  });
});

/**
 * A best-ball league whose `starters` array is deliberately the *wrong*
 * lineup, which is what a real one looks like: Sleeper leaves whatever the
 * draft produced there and seats the team itself, from the whole roster, after
 * the games are played.
 */
describe("solveGametimeLeague, best ball", () => {
  const BB_PROJECTIONS: WeekProjections = {
    // Seated by `starters` and beaten by somebody on the bench, at every seat.
    qb_bad: row("qb_bad", "MIA", { pass_yd: 150 }, ["QB"]), // 6.0
    qb_good: row("qb_good", "MIA", { pass_yd: 400 }, ["QB"]), // 16.0
    rb_bad: row("rb_bad", "MIA", { rush_yd: 30 }, ["RB"]), // 3.0
    rb_good: row("rb_good", "MIA", { rush_yd: 140 }, ["RB"]), // 14.0
    wr_bad: row("wr_bad", "MIA", { rec_yd: 20, rec: 2 }, ["WR"]), // 4.0
    wr_good: row("wr_good", "MIA", { rec_yd: 110, rec: 9 }, ["WR"]), // 20.0
    te_bad: row("te_bad", "MIA", { rec_yd: 10, rec: 1 }, ["TE"]), // 2.0
    te_good: row("te_good", "MIA", { rec_yd: 70, rec: 7 }, ["TE"]), // 14.0
    // Flex-only fodder: a receiver who beats the benched wide-out but not the good one.
    wr_flex: row("wr_flex", "MIA", { rec_yd: 60, rec: 5 }, ["WR"]), // 11.0
  };
  const ALL = Object.keys(BB_PROJECTIONS);

  const bb = (over: Partial<WeekLineupLeague> = {}): WeekLineupLeague =>
    league({
      best_ball: true,
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN", "BN", "BN", "BN"],
      starters: ["qb_bad", "rb_bad", "wr_bad", "te_bad", "wr_flex"],
      players: ALL,
      ...over,
    });

  const BB_BOARDS = { projections: BB_PROJECTIONS, stats: null, clocks: null };

  test("the lineup is solved from the whole roster, not read off `starters`", () => {
    const solved = solveGametimeLeague(bb(), BB_BOARDS)!;
    assert.deepEqual(
      solved.mine.lineup.map((seat) => [seat.slot, seat.player?.player_id]),
      [
        ["QB", "qb_good"],
        ["RB", "rb_good"],
        ["WR", "wr_good"],
        ["TE", "te_good"],
        ["FLEX", "wr_flex"],
      ],
    );
    // 16 + 14 + 20 + 14 + 11 — the best five, not the five in the array.
    assert.equal(solved.mine.live, 75);
    // And the seats still add up to the plate, which is the contract's own
    // invariant and the reason all three totals read one lineup.
    const sum = solved.mine.lineup.reduce((acc, s) => acc + (s.player?.live ?? 0), 0);
    assert.equal(Number(sum.toFixed(2)), solved.mine.live);
  });

  test("flex eligibility is the solver's, and nobody fills two seats", () => {
    const solved = solveGametimeLeague(bb(), BB_BOARDS)!;
    const seated = solved.mine.lineup.map((s) => s.player?.player_id);
    assert.equal(new Set(seated).size, seated.length);
    // The flex takes the best player no strict seat wanted — the third
    // receiver, not a second copy of the best one.
    assert.equal(solved.mine.lineup[4].player?.player_id, "wr_flex");
  });

  test("a superflex seat takes a quarterback when he is the best one left", () => {
    const solved = solveGametimeLeague(
      bb({
        roster_positions: ["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN", "BN", "BN"],
      }),
      BB_BOARDS,
    )!;
    // A superflex seats a quarterback *or* a skill player, so it takes the
    // best of them: with the spare QB at 6.0 the third receiver's 11.0 wins.
    assert.equal(solved.mine.lineup[4].player?.player_id, "wr_flex");

    const richer: WeekProjections = {
      ...BB_PROJECTIONS,
      qb_bad: row("qb_bad", "MIA", { pass_yd: 700 }, ["QB"]), // 28.0
    };
    const withQb = solveGametimeLeague(
      bb({ roster_positions: ["QB", "RB", "WR", "TE", "SUPER_FLEX", "BN", "BN", "BN"] }),
      { ...BB_BOARDS, projections: richer },
    )!;
    // Two quarterbacks now beat the receiver, so both are seated — the better
    // of them in the stricter slot, which is the solver's own canonical order.
    const seated = withQb.mine.lineup.map((s) => s.player?.player_id);
    assert.equal(seated[0], "qb_bad");
    assert.equal(seated[4], "qb_good");
  });

  test("a bench player replaces a nominal starter, and the loser is on the bench", () => {
    const solved = solveGametimeLeague(bb(), BB_BOARDS)!;
    const bench = solved.mine.bench.map((p) => p.player_id);
    for (const nominal of ["qb_bad", "rb_bad", "wr_bad", "te_bad"]) {
      assert.ok(bench.includes(nominal), nominal);
    }
    assert.equal(bench.length + solved.mine.lineup.length, ALL.length);
  });

  test("the seating follows the live figures once games are played", () => {
    // The reading this is seated by: Sleeper will seat the lineup by what each
    // player *finally* scores, and `live` is this app's estimate of that. A
    // benched receiver who has already outscored the projected starter takes
    // the seat, which the pre-kickoff lineup would not have given him.
    const clocks = new Map<string, GameClock>([
      ["MIA", clock({ phase: "final", remaining: 0 })],
    ]);
    const stats: WeekProjections = {
      wr_bad: row("wr_bad", "MIA", { rec_yd: 200, rec: 12 }, ["WR"]), // 32.0 final
      wr_good: row("wr_good", "MIA", { rec_yd: 10, rec: 1 }, ["WR"]), // 2.0 final
    };
    const solved = solveGametimeLeague(bb(), { projections: BB_PROJECTIONS, stats, clocks })!;
    assert.equal(solved.mine.lineup[2].player?.player_id, "wr_bad");
  });

  test("the in-play count is the whole roster, where a managed league's is its seats", () => {
    // Sleeper seats a best-ball team after the games, so a bench player whose
    // game is running is one it may yet seat and the count says so. The same
    // roster read as managed counts the five seats alone — which is the
    // distinction the field exists for, and the one `status` cannot make.
    const clocks = new Map<string, GameClock>([
      ["MIA", clock({ phase: "live", remaining: 0.5, quarter: 2, clock: "10:00" })],
    ]);
    const boards = { ...BB_BOARDS, clocks };
    assert.equal(solveGametimeLeague(bb(), boards)!.mine.players_in_play, ALL.length);
    assert.equal(solveGametimeLeague(bb(), boards)!.mine.status.live, 5);
    assert.equal(solveGametimeLeague(bb({ best_ball: false }), boards)!.mine.players_in_play, 5);
  });

  test("a managed league with the same roster is still seated as set", () => {
    const solved = solveGametimeLeague(bb({ best_ball: false }), BB_BOARDS)!;
    assert.deepEqual(
      solved.mine.lineup.map((seat) => seat.player?.player_id),
      ["qb_bad", "rb_bad", "wr_bad", "te_bad", "wr_flex"],
    );
    assert.equal(solved.mine.live, 26);
  });

  test("the opponent and the median are solved the same way", () => {
    const solved = solveGametimeLeague(
      bb({
        opponent: { roster_id: 2, team_name: "Them", starters: ["qb_bad"], players: ALL },
        median_rosters: [
          { roster_id: 1, starters: [], players: ALL },
          { roster_id: 2, starters: ["qb_bad"], players: ALL },
          { roster_id: 3, starters: ["te_bad"], players: ALL },
        ],
      }),
      BB_BOARDS,
    )!;
    // Same roster, same solver: the opponent's nominal one-man lineup is the
    // best five as well.
    assert.equal(solved.opponent!.live, 75);
    assert.deepEqual(solved.median, { scored: 0, projected: 75, live: 75 });
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
