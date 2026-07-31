import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { aggregateRecord } from "./record.ts";
import type { ManagerLeague } from "./types.ts";

const league = (
  record: ManagerLeague["record"],
  league_id = String(Math.random()),
): ManagerLeague => ({
  league_id,
  name: "Test League",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record,
  settings: null,
  scoring_settings: null,
});

const rec = (wins: number, losses: number, ties = 0) => ({ wins, losses, ties });

describe("aggregateRecord", () => {
  test("sums wins, losses and ties across leagues", () => {
    const total = aggregateRecord([
      league(rec(9, 4)),
      league(rec(7, 6)),
      league(rec(5, 7, 1)),
    ]);
    assert.deepEqual(
      { wins: total.wins, losses: total.losses, ties: total.ties },
      { wins: 21, losses: 17, ties: 1 },
    );
    assert.equal(total.games, 39);
    assert.equal(total.leagues, 3);
  });

  test("counts leagues holding a record, not leagues listed", () => {
    // Membership without a roster (a league left, a guillotine knockout) comes
    // back with no record; counting it would deflate the denominator's meaning.
    const total = aggregateRecord([
      league(rec(9, 4)),
      league(null),
      league(null),
    ]);
    assert.equal(total.leagues, 1);
    assert.equal(total.games, 13);
  });

  test("counts a tie as half a win", () => {
    const total = aggregateRecord([league(rec(1, 1))]);
    assert.equal(total.pct, 0.5);

    const withTie = aggregateRecord([league(rec(0, 0, 1))]);
    assert.equal(withTie.pct, 0.5);
  });

  test("a drafted-but-unplayed season has no pct, rather than .000", () => {
    // Preseason every league reports 0-0-0. A zero here would read as a season
    // of losses instead of a season that hasn't started.
    const total = aggregateRecord([league(rec(0, 0)), league(rec(0, 0))]);
    assert.equal(total.pct, null);
    assert.equal(total.games, 0);
    // The leagues still counted — they hold a team, they just haven't played.
    assert.equal(total.leagues, 2);
  });

  test("an empty list is empty, not a division by zero", () => {
    const total = aggregateRecord([]);
    assert.deepEqual(total, {
      wins: 0,
      losses: 0,
      ties: 0,
      games: 0,
      leagues: 0,
      pct: null,
    });
  });

  test("pct is the share of games won, over any number of leagues", () => {
    const total = aggregateRecord([league(rec(6, 4)), league(rec(4, 6))]);
    assert.equal(total.pct, 0.5);

    const winning = aggregateRecord([league(rec(10, 0)), league(rec(5, 5))]);
    assert.equal(winning.pct, 0.75);
  });
});
