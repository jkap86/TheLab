import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assembleWeekProjections, dayLockedPlayers } from "./week.ts";
import type { SleeperProjection } from "../sleeper/types/sleeper.types.ts";

/** A projected row — a real game, with stats and a team. */
function projected(
  player_id: string,
  over: Partial<SleeperProjection> = {},
): SleeperProjection {
  return {
    player_id,
    season: "2026",
    week: 7,
    season_type: "regular",
    category: "proj",
    company: "rotowire",
    team: "KC",
    opponent: "BUF",
    game_id: "2026-07-KC-BUF",
    date: "2026-10-18",
    last_modified: 1,
    stats: { pass_yd: 250, pass_td: 2 },
    player: { first_name: "Pat", last_name: "Mahomes", fantasy_positions: ["QB"] },
    ...over,
  };
}

/**
 * The feed's "no game this week": a null `game_id`, a null team and date, and
 * ADP placeholders where the stats would be.
 */
function noGame(
  player_id: string,
  over: Partial<SleeperProjection> = {},
): SleeperProjection {
  return projected(player_id, {
    game_id: null,
    team: null,
    date: null,
    stats: { adp_dd_ppr: 41.2 },
    ...over,
  });
}

describe("assembleWeekProjections", () => {
  test("a projected row keeps its stats, team and game date", () => {
    // The three fields the rest-of-season fold discards, and the whole reason
    // this module exists rather than reusing it.
    const board = assembleWeekProjections([projected("p1")]);
    assert.deepEqual(board.p1.stats, { pass_yd: 250, pass_td: 2 });
    assert.equal(board.p1.team, "KC");
    assert.equal(board.p1.game_date, "2026-10-18");
  });

  test("a no-game row keeps the player, with null stats rather than placeholders", () => {
    // He must stay in the pool — he can be *started*, and dropping a player a
    // lineup is actually starting would overstate what that lineup projects.
    // But his ADP placeholders are not a projection of anything.
    const board = assembleWeekProjections([noGame("p1")]);
    assert.ok(board.p1, "the player is on the board");
    assert.equal(board.p1.stats, null);
    assert.equal(board.p1.team, null);
    assert.equal(board.p1.game_date, null);
  });

  test("identity is read from a row with no projection at all", () => {
    // Without positions a player is eligible for no slot and cannot be seated
    // even on the bench, so identity is the one thing read from any row.
    const board = assembleWeekProjections([
      noGame("p1", {
        player: { first_name: "Sam", last_name: "Bench", fantasy_positions: ["WR"] },
      }),
    ]);
    assert.equal(board.p1.name, "Sam Bench");
    assert.deepEqual(board.p1.positions, ["WR"]);
  });

  test("a real projection wins over a no-game row, whichever arrives first", () => {
    const before = assembleWeekProjections([noGame("p1"), projected("p1")]);
    const after = assembleWeekProjections([projected("p1"), noGame("p1")]);
    for (const board of [before, after]) {
      assert.deepEqual(board.p1.stats, { pass_yd: 250, pass_td: 2 });
      assert.equal(board.p1.team, "KC");
    }
  });

  test("rows with no usable player id are skipped", () => {
    const board = assembleWeekProjections([
      projected(""),
      { ...projected("p1"), player_id: undefined as unknown as string },
      projected("p2"),
    ]);
    assert.deepEqual(Object.keys(board), ["p2"]);
  });

  test("a player the feed names but describes not at all still seats nowhere", () => {
    const board = assembleWeekProjections([projected("p1", { player: null })]);
    assert.equal(board.p1.name, null);
    assert.deepEqual(board.p1.positions, []);
  });
});

describe("dayLockedPlayers", () => {
  const board = assembleWeekProjections([
    projected("sunday", { date: "2026-10-18" }),
    projected("thursday", { date: "2026-10-15" }),
    noGame("bye"),
  ]);

  test("a game before today is settled", () => {
    assert.deepEqual([...dayLockedPlayers(board, "2026-10-18")], ["thursday"]);
  });

  test("a game earlier *today* is not settled here", () => {
    // Strictly before, deliberately: within the day it is the schedule's
    // kickoff instants that answer, and locking on the date alone would settle
    // a whole Sunday roster before a ball was snapped.
    assert.equal(dayLockedPlayers(board, "2026-10-18").has("sunday"), false);
  });

  test("a player with no game is never day-locked", () => {
    // A bye is not a played game; `locks` may still settle him by kickoff if
    // the schedule somehow names his team, and that is the union's business.
    assert.equal(dayLockedPlayers(board, "2026-12-01").has("bye"), false);
  });

  test("the whole week settles once it is behind us", () => {
    assert.deepEqual(
      [...dayLockedPlayers(board, "2026-10-20")].sort(),
      ["sunday", "thursday"],
    );
  });
});
