import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { playerShares } from "./shares.ts";
import type { ManagerLeague, PlayerSummary } from "./types.ts";

const league = (league_id: string, name = `League ${league_id}`): ManagerLeague => ({
  league_id,
  name,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: null,
  scoring_settings: null,
});

const player = (player_id: string, name: string): PlayerSummary => ({
  player_id,
  name,
  position: "RB",
  team: "ATL",
});

const PLAYERS: Record<string, PlayerSummary> = {
  "1": player("1", "Bijan Robinson"),
  "2": player("2", "Ashton Jeanty"),
};

describe("playerShares", () => {
  test("counts a player once per league that holds him", () => {
    const { players } = playerShares(
      [league("a"), league("b"), league("c")],
      { a: ["1", "2"], b: ["1"], c: ["2"] },
      PLAYERS,
    );

    // Both are held twice, so the name breaks the tie.
    assert.deepEqual(
      players.map((p) => [p.name, p.leagues.length]),
      [
        ["Ashton Jeanty", 2],
        ["Bijan Robinson", 2],
      ],
    );
    const bijan = players.find((p) => p.player_id === "1")!;
    assert.deepEqual(
      bijan.leagues.map((l) => l.league_id),
      ["a", "b"],
    );
  });

  test("orders by leagues held, then by name", () => {
    const { players } = playerShares(
      [league("a"), league("b")],
      { a: ["1", "2"], b: ["2"] },
      PLAYERS,
    );
    assert.deepEqual(players.map((p) => p.name), ["Ashton Jeanty", "Bijan Robinson"]);
  });

  test("a duplicate id within one roster is still one league", () => {
    const { players } = playerShares([league("a")], { a: ["1", "1"] }, PLAYERS);
    assert.equal(players.length, 1);
    assert.equal(players[0].leagues.length, 1);
  });

  test("skips the empty and '0' ids Sleeper pads rosters with", () => {
    const { players } = playerShares([league("a")], { a: ["", "0", "1"] }, PLAYERS);
    assert.deepEqual(players.map((p) => p.player_id), ["1"]);
  });

  test("falls back to the id when the players cache doesn't know him", () => {
    const { players } = playerShares([league("a")], { a: ["9999"] }, {});
    assert.deepEqual(players[0], {
      player_id: "9999",
      name: "9999",
      position: null,
      team: null,
      leagues: [players[0].leagues[0]],
    });
  });

  test("counts an empty roster in the denominator but a missing one not at all", () => {
    // A pre-draft league is a league you own nobody in; a league whose rosters
    // aren't cached is one we can't say anything about, and counting it would
    // quietly deflate every share in the list.
    const drafted = playerShares(
      [league("a"), league("b")],
      { a: ["1"], b: [] },
      PLAYERS,
    );
    assert.equal(drafted.league_count, 2);

    const uncached = playerShares([league("a"), league("b")], { a: ["1"] }, PLAYERS);
    assert.equal(uncached.league_count, 1);
  });

  test("only the leagues passed in are counted", () => {
    // The caller filters first, so a roster whose league was filtered out is
    // neither a share nor part of the denominator.
    const { league_count, players } = playerShares(
      [league("a")],
      { a: ["1"], b: ["2"] },
      PLAYERS,
    );
    assert.equal(league_count, 1);
    assert.deepEqual(players.map((p) => p.player_id), ["1"]);
  });
});
