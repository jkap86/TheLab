import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague, PlayerShareSummary } from "@/shared/contract";

import { playerShares } from "./shares.ts";

/** Only the field the fold reads; the rest is the card's business. */
function league(id: string): ManagerLeague {
  return { league_id: id, name: `League ${id}` } as ManagerLeague;
}

function summary(
  player_id: string,
  name: string,
  position: string | null = "RB",
  team: string | null = "ATL",
  extra: Partial<PlayerShareSummary> = {},
): PlayerShareSummary {
  return {
    player_id,
    name,
    position,
    team,
    age: null,
    draft_class: null,
    ktc_value: null,
    ...extra,
  };
}

const A = league("a");
const B = league("b");
const C = league("c");

describe("playerShares", () => {
  test("counts the leagues holding each player, most-held first", () => {
    const shares = playerShares(
      [A, B, C],
      { a: ["p1", "p2"], b: ["p1"], c: ["p1", "p2"] },
      { p1: summary("p1", "Bijan"), p2: summary("p2", "Puka") },
    );

    assert.equal(shares.league_count, 3);
    assert.deepEqual(
      shares.players.map((p) => [p.player_id, p.leagues.length]),
      [
        ["p1", 3],
        ["p2", 2],
      ],
    );
    // The leagues themselves ride along, in the order they were given.
    assert.deepEqual(
      shares.players[1].leagues.map((l) => l.league_id),
      ["a", "c"],
    );
  });

  test("a league with no stored roster is skipped, not counted as holding nobody", () => {
    // Three leagues on the page, one of them never synced. The share is 2 of 2,
    // not 2 of 3 — deflating every share by an unread league would be the
    // quietest possible way to be wrong.
    const shares = playerShares(
      [A, B, C],
      { a: ["p1"], b: ["p1"] },
      { p1: summary("p1", "Bijan") },
    );

    assert.equal(shares.league_count, 2);
    assert.equal(shares.players[0].leagues.length, 2);
  });

  test("Sleeper's slot padding is not a player", () => {
    const shares = playerShares(
      [A, B],
      { a: ["", "0", "p1"], b: ["0", ""] },
      { p1: summary("p1", "Bijan") },
    );

    // One row, not three — and in particular no phantom held in every league.
    assert.deepEqual(
      shares.players.map((p) => p.player_id),
      ["p1"],
    );
    assert.equal(shares.league_count, 2);
  });

  test("a roster naming the same player twice is one share", () => {
    const shares = playerShares(
      [A],
      { a: ["p1", "p1"] },
      { p1: summary("p1", "Bijan") },
    );
    assert.equal(shares.players[0].leagues.length, 1);
  });

  test("ties break by name, and an unknown id keeps the id as its name", () => {
    const shares = playerShares(
      [A],
      { a: ["p2", "p1", "zz-unknown"] },
      { p1: summary("p1", "Bucky"), p2: summary("p2", "Amon-Ra") },
    );

    // All three are held once; the order is alphabetical, and the unmatched id
    // sorts as itself rather than as a blank.
    assert.deepEqual(
      shares.players.map((p) => p.name),
      ["Amon-Ra", "Bucky", "zz-unknown"],
    );
    const unknown = shares.players[2];
    assert.equal(unknown.position, null);
    assert.equal(unknown.team, null);
  });

  test("no leagues is an empty board rather than a division by nothing", () => {
    const shares = playerShares([], {}, {});
    assert.equal(shares.league_count, 0);
    assert.deepEqual(shares.players, []);
  });
});
