import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { GametimeGame, GametimeLeague, GametimeSide } from "@/shared/contract";
import {
  gameClockLabel,
  gameScoreLabel,
  leagueLiveRecord,
  leaguesInPlay,
  liveSummary,
  playersInPlay,
} from "./live-record.ts";

function side(over: Partial<GametimeSide> = {}): GametimeSide {
  return {
    roster_id: 1,
    team_name: null,
    scored: 0,
    projected: 100,
    live: 100,
    status: { done: 0, live: 0, pending: 9 },
    players_in_play: 0,
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
    // `players_in_play` alone, with `status` left at its all-pending default:
    // the count reads the field the cards print rather than the seat status,
    // which is the whole of what keeps the header and a best-ball card from
    // disagreeing on one screen.
    b: league({ mine: side({ live: 80, players_in_play: 3 }) }),
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

  test("counts a league in play by either side's players, not by its seat status", () => {
    assert.equal(leaguesInPlay(leagues, entries), 1);
    const theirs = { a: league({ opponent: side({ players_in_play: 1 }) }) };
    assert.equal(leaguesInPlay([{ league_id: "a" }], theirs), 1);
    // A lineup whose seats are live but whose count is zero is not in play:
    // the two are separate fields and only one of them is the reading.
    const seats = { a: league({ mine: side({ status: { done: 0, live: 4, pending: 5 } }) }) };
    assert.equal(leaguesInPlay([{ league_id: "a" }], seats), 0);
  });
});

describe("playersInPlay", () => {
  test("null is the zero state, and it covers a read that has not landed", () => {
    assert.equal(playersInPlay(league()), null);
    assert.equal(playersInPlay(null), null);
    assert.equal(playersInPlay(undefined), null);
  });

  test("a side with nobody on the field reads zero rather than closing the reading", () => {
    // Something *is* being watched — three of theirs — so the reading is
    // drawn, and none of yours is the answer a reader wants at that moment.
    assert.deepEqual(playersInPlay(league({ opponent: side({ players_in_play: 3 }) })), {
      mine: 0,
      theirs: 3,
    });
  });

  test("no opponent is a null second figure, never a zero", () => {
    assert.deepEqual(
      playersInPlay(league({ mine: side({ players_in_play: 2 }), opponent: null })),
      { mine: 2, theirs: null },
    );
    // And a league with no opponent and nobody in play is still the zero state.
    assert.equal(playersInPlay(league({ opponent: null })), null);
  });

  test("both sides in play read both figures", () => {
    assert.deepEqual(
      playersInPlay(
        league({ mine: side({ players_in_play: 4 }), opponent: side({ players_in_play: 3 }) }),
      ),
      { mine: 4, theirs: 3 },
    );
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
});
