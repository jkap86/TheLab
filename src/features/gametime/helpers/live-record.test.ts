import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { GametimeGame, GametimeLeague, GametimeSide } from "@/shared/contract";
import {
  gameClockLabel,
  gameScoreLabel,
  leagueLiveRecord,
  leaguesInPlay,
  liveSummary,
  statusScope,
} from "./live-record.ts";

function side(over: Partial<GametimeSide> = {}): GametimeSide {
  return {
    roster_id: 1,
    team_name: null,
    scored: 0,
    projected: 100,
    live: 100,
    status: { done: 0, live: 0, pending: 9 },
    lineup: [],
    bench: [],
    ...over,
  };
}

function league(over: Partial<GametimeLeague> = {}): GametimeLeague {
  return {
    roster_id: 1,
    best_ball: false,
    as_of: "week",
    mine: side(),
    opponent: side({ roster_id: 2, live: 90 }),
    median: null,
    unknown_slots: [],
    ...over,
  };
}

describe("leagueLiveRecord", () => {
  test("reads the live projections, and gates on the opponent", () => {
    assert.deepEqual(leagueLiveRecord(league())?.games, [{ against: "opponent", result: "win" }]);
    assert.equal(leagueLiveRecord(league({ opponent: null })), null);
    assert.equal(leagueLiveRecord(null), null);
  });

  test("a median league is two games", () => {
    const record = leagueLiveRecord(league({ median: { scored: 0, projected: 105, live: 105 } }));
    assert.deepEqual(record?.games.map((g) => g.result), ["win", "loss"]);
    assert.equal(record?.median, true);
  });
});

describe("liveSummary / leaguesInPlay", () => {
  const entries = {
    a: league(),
    b: league({ mine: side({ live: 80, status: { done: 2, live: 3, pending: 4 } }) }),
    c: league({ opponent: null }),
  };
  const leagues = [{ league_id: "a" }, { league_id: "b" }, { league_id: "c" }, { league_id: "d" }];

  test("sums the records over the leagues on screen", () => {
    const summary = liveSummary(leagues, entries);
    assert.equal(summary.leagues, 2);
    assert.equal(summary.wins, 1);
    assert.equal(summary.losses, 1);
    assert.equal(summary.winPct, 50);
  });

  test("counts a league in play by either side's running starters", () => {
    assert.equal(leaguesInPlay(leagues, entries), 1);
    const theirs = { a: league({ opponent: side({ status: { done: 0, live: 1, pending: 8 } }) }) };
    assert.equal(leaguesInPlay([{ league_id: "a" }], theirs), 1);
  });
});

describe("gameClockLabel", () => {
  const game = (over: Partial<GametimeGame>): GametimeGame => ({
    phase: "live",
    remaining: 0.5,
    quarter: 2,
    clock: "07:12",
    overtime: false,
    kickoff: null,
    opponent: null,
    home: true,
    score: null,
    ...over,
  });

  test("the four states", () => {
    assert.deepEqual(gameClockLabel(game({})), { text: "Q2 07:12", live: true });
    assert.deepEqual(gameClockLabel(game({ quarter: 2, clock: "00:00" })), { text: "Half", live: true });
    assert.deepEqual(gameClockLabel(game({ overtime: true, clock: "04:12" })), { text: "OT 04:12", live: true });
    assert.deepEqual(gameClockLabel(game({ quarter: null, clock: null })), { text: "Live", live: true });
    assert.deepEqual(gameClockLabel(game({ phase: "final" })), { text: "Final", live: false });
    assert.deepEqual(gameClockLabel(null), { text: "", live: false });
  });

  test("a game to come prints its kickoff, and nothing without one", () => {
    const pre = gameClockLabel(game({ phase: "pre", kickoff: Date.UTC(2026, 8, 13, 17) }));
    assert.equal(pre.live, false);
    assert.ok(pre.text.length > 0);
    assert.deepEqual(gameClockLabel(game({ phase: "pre", kickoff: null })), { text: "", live: false });
  });

  test("the score reads from the seat's side", () => {
    assert.equal(gameScoreLabel(game({ score: { team: 21, opponent: 17 } })), "21–17");
    assert.equal(gameScoreLabel(game({})), null);
    assert.equal(gameScoreLabel(null), null);
  });

  test("the status scope", () => {
    assert.equal(statusScope({ done: 3, live: 4, pending: 2 }), "3 done · 2 to play");
  });
});
