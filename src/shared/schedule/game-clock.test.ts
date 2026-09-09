import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SleeperScoreGame } from "../sleeper/types/sleeper.types.ts";
import {
  clockSignature,
  gameClocks,
  gamePhase,
  parseClock,
  parseQuarter,
  phaseCounts,
  remainingShare,
} from "./game-clock.ts";

const KICKOFF = Date.UTC(2026, 8, 13, 17, 0, 0);

function game(over: Partial<SleeperScoreGame> & { metadata?: SleeperScoreGame["metadata"] } = {}): SleeperScoreGame {
  return {
    game_id: "202610105",
    status: "pre_game",
    start_time: KICKOFF,
    ...over,
    metadata: {
      home_team: "CAR",
      away_team: "CHI",
      has_started: false,
      is_in_progress: false,
      is_over: false,
      is_overtime: false,
      quarter: "",
      quarter_num: "",
      ...(over.metadata ?? {}),
    },
  };
}

describe("gamePhase", () => {
  test("a row that has not started is pre, whatever its clock says", () => {
    // The next game to kick off carries `15:00` before it starts.
    assert.equal(gamePhase(game({ metadata: { time_remaining: "15:00" } })), "pre");
  });

  test("is_over wins over everything", () => {
    assert.equal(
      gamePhase(game({ status: "in_game", metadata: { is_in_progress: true, is_over: true } })),
      "final",
    );
  });

  test("a complete status is final even without the boolean", () => {
    assert.equal(gamePhase(game({ status: "complete", metadata: { is_over: null } })), "final");
  });

  test("in progress, or started and not over, is live", () => {
    assert.equal(gamePhase(game({ metadata: { is_in_progress: true } })), "live");
    assert.equal(gamePhase(game({ metadata: { has_started: true } })), "live");
  });

  test("an unreadable row is pre", () => {
    assert.equal(gamePhase({} as SleeperScoreGame), "pre");
    assert.equal(gamePhase({ metadata: null }), "pre");
  });
});

describe("parseClock / parseQuarter", () => {
  test("mm:ss", () => {
    assert.equal(parseClock("05:32"), 332);
    assert.equal(parseClock("15:00"), 900);
    assert.equal(parseClock("0:07"), 7);
    assert.equal(parseClock(""), null);
    assert.equal(parseClock("99:99"), null);
    assert.equal(parseClock(null), null);
  });

  test("a quarter is 1–4, as a number or a numeric string, never the empty string", () => {
    assert.equal(parseQuarter(3), 3);
    assert.equal(parseQuarter("2"), 2);
    assert.equal(parseQuarter(""), null);
    assert.equal(parseQuarter(5), null);
    assert.equal(parseQuarter(null), null);
  });
});

describe("remainingShare", () => {
  test("pre is the whole game and final is none of it", () => {
    assert.equal(remainingShare(game()), 1);
    assert.equal(
      remainingShare(game({ status: "complete", metadata: { is_over: true, quarter_num: 4, time_remaining: "00:00" } })),
      0,
    );
  });

  test("quarter and clock: seconds left in regulation over 3,600", () => {
    const q3 = game({ metadata: { is_in_progress: true, quarter_num: 3, time_remaining: "05:32" } });
    assert.equal(remainingShare(q3), (900 + 332) / 3600);
    const half = game({ metadata: { is_in_progress: true, quarter_num: 2, time_remaining: "00:00" } });
    assert.equal(remainingShare(half), 0.5);
    const opening = game({ metadata: { is_in_progress: true, quarter_num: 1, time_remaining: "15:00" } });
    assert.equal(remainingShare(opening), 1);
  });

  test("overtime is nothing left, whatever the clock", () => {
    const ot = game({ metadata: { is_in_progress: true, is_overtime: true, quarter_num: 4, time_remaining: "07:00" } });
    assert.equal(remainingShare(ot), 0);
  });

  test("the quarter flags stand in for a missing clock, counting a started quarter as spent", () => {
    const flags = game({
      metadata: {
        is_in_progress: true,
        has1st_quarter_started: true,
        has2nd_quarter_started: true,
        has3rd_quarter_started: true,
        time_remaining: null,
        quarter_num: "",
      },
    });
    assert.equal(remainingShare(flags), 0.25);
  });

  test("a running game that says nothing else is half", () => {
    assert.equal(remainingShare(game({ metadata: { is_in_progress: true } })), 0.5);
  });
});

describe("gameClocks", () => {
  test("files both sides with the score from each side's own view", () => {
    const clocks = gameClocks([
      game({
        metadata: {
          is_in_progress: true,
          quarter_num: 4,
          time_remaining: "02:10",
          home_score: 17,
          away_score: 21,
        },
      }),
    ]);
    const car = clocks.get("CAR");
    const chi = clocks.get("CHI");
    assert.ok(car && chi);
    assert.equal(car.phase, "live");
    assert.equal(car.quarter, 4);
    assert.equal(car.clock, "02:10");
    assert.equal(car.home, true);
    assert.equal(car.opponent, "CHI");
    assert.deepEqual(car.score, { team: 17, opponent: 21 });
    assert.deepEqual(chi.score, { team: 21, opponent: 17 });
    assert.equal(chi.home, false);
    assert.equal(car.kickoff, KICKOFF);
    assert.equal(car.remaining, 130 / 3600);
  });

  test("a game that has not started carries no score and no clock", () => {
    const clocks = gameClocks([game({ metadata: { home_score: 0, away_score: 0, time_remaining: "15:00" } })]);
    const car = clocks.get("CAR");
    assert.ok(car);
    assert.equal(car.phase, "pre");
    assert.equal(car.score, null);
    assert.equal(car.clock, null);
    assert.equal(car.quarter, null);
    assert.equal(car.remaining, 1);
  });

  test("a team listed twice keeps the listing that is being played", () => {
    const clocks = gameClocks([
      game({ game_id: "a" }),
      game({ game_id: "b", metadata: { is_in_progress: true, quarter_num: 1, time_remaining: "10:00" } }),
    ]);
    assert.equal(clocks.get("CAR")?.game_id, "b");
  });

  test("an unnamed side is skipped and a nameless row files nothing", () => {
    const clocks = gameClocks([
      game({ metadata: { home_team: "", away_team: "CHI" } }),
      { metadata: null },
    ]);
    assert.deepEqual([...clocks.keys()], ["CHI"]);
    assert.equal(clocks.get("CHI")?.opponent, null);
  });
});

describe("clockSignature / phaseCounts", () => {
  test("two boards that price identically compare equal, and a play moves it", () => {
    const a = gameClocks([game({ metadata: { is_in_progress: true, quarter_num: 2, time_remaining: "03:00", home_score: 7, away_score: 3 } })]);
    const b = gameClocks([game({ metadata: { is_in_progress: true, quarter_num: 2, time_remaining: "03:00", home_score: 7, away_score: 3 } })]);
    const c = gameClocks([game({ metadata: { is_in_progress: true, quarter_num: 2, time_remaining: "02:55", home_score: 7, away_score: 3 } })]);
    assert.equal(clockSignature(a), clockSignature(b));
    assert.notEqual(clockSignature(a), clockSignature(c));
  });

  test("counts games rather than sides", () => {
    const clocks = gameClocks([
      game({ game_id: "1" }),
      game({ game_id: "2", metadata: { home_team: "BUF", away_team: "HOU", is_in_progress: true } }),
      game({ game_id: "3", status: "complete", metadata: { home_team: "KC", away_team: "DEN", is_over: true } }),
    ]);
    assert.deepEqual(phaseCounts(clocks), { pre: 1, live: 1, final: 1 });
  });
});
