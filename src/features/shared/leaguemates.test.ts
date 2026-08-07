import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { leaguemateShares } from "./leaguemates.ts";
import type { LeaguematePayload as LeaguemateView } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

const SELF = "me";

const league = (league_id: string, name = `League ${league_id}`): ManagerLeague => ({
  league_id,
  name,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: null,
  roster_positions: null,
  scoring_settings: null,
});

const user = (user_id: string, display_name: string): LeaguemateView => ({
  user_id,
  display_name,
  avatar_url: null,
});

const USERS: Record<string, LeaguemateView> = {
  "1": user("1", "ballhawk"),
  "2": user("2", "airraid"),
};

describe("leaguemateShares", () => {
  test("counts a mate once per league shared with them", () => {
    const { mates } = leaguemateShares(
      [league("a"), league("b"), league("c")],
      { a: [SELF, "1", "2"], b: [SELF, "1"], c: [SELF, "2"] },
      USERS,
      SELF,
    );

    // Both share two, so the name breaks the tie.
    assert.deepEqual(
      mates.map((m) => [m.name, m.leagues.length]),
      [
        ["airraid", 2],
        ["ballhawk", 2],
      ],
    );
    const ballhawk = mates.find((m) => m.user_id === "1")!;
    assert.deepEqual(
      ballhawk.leagues.map((l) => l.league_id),
      ["a", "b"],
    );
  });

  test("the searched manager is never their own leaguemate", () => {
    const { mates } = leaguemateShares(
      [league("a")],
      { a: [SELF, "1"] },
      USERS,
      SELF,
    );
    assert.deepEqual(mates.map((m) => m.user_id), ["1"]);
  });

  test("orders by leagues shared, then by name", () => {
    const { mates } = leaguemateShares(
      [league("a"), league("b")],
      { a: [SELF, "1", "2"], b: [SELF, "2"] },
      USERS,
      SELF,
    );
    assert.deepEqual(mates.map((m) => m.name), ["airraid", "ballhawk"]);
  });

  test("a duplicate id within one member list is still one league", () => {
    const { mates } = leaguemateShares(
      [league("a")],
      { a: [SELF, "1", "1"] },
      USERS,
      SELF,
    );
    assert.equal(mates.length, 1);
    assert.equal(mates[0].leagues.length, 1);
  });

  test("falls back to the id when the member list doesn't name them", () => {
    const { mates } = leaguemateShares([league("a")], { a: [SELF, "9999"] }, {}, SELF);
    assert.deepEqual(mates[0], {
      user_id: "9999",
      name: "9999",
      avatar_url: null,
      leagues: [mates[0].leagues[0]],
    });
  });

  test("counts a solo league in the denominator but an uncached one not at all", () => {
    // A league the manager shares with nobody is still a league they're in; one
    // whose members aren't cached is one we can't say anything about, and
    // counting it would quietly deflate every share in the list.
    const solo = leaguemateShares(
      [league("a"), league("b")],
      { a: [SELF, "1"], b: [SELF] },
      USERS,
      SELF,
    );
    assert.equal(solo.league_count, 2);

    const uncached = leaguemateShares(
      [league("a"), league("b")],
      { a: [SELF, "1"] },
      USERS,
      SELF,
    );
    assert.equal(uncached.league_count, 1);
  });

  test("only the leagues passed in are counted", () => {
    // The caller filters first, so a member list whose league was filtered out
    // is neither a share nor part of the denominator.
    const { league_count, mates } = leaguemateShares(
      [league("a")],
      { a: [SELF, "1"], b: [SELF, "2"] },
      USERS,
      SELF,
    );
    assert.equal(league_count, 1);
    assert.deepEqual(mates.map((m) => m.user_id), ["1"]);
  });
});
