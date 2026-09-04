import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LeaguematePayload, ManagerLeague } from "@/shared/contract";

import { leaguemateShares } from "./leaguemates.ts";

function league(id: string): ManagerLeague {
  return { league_id: id, name: `League ${id}` } as ManagerLeague;
}

function user(
  user_id: string,
  display_name: string | null,
): LeaguematePayload {
  return { user_id, display_name, avatar_url: null };
}

const A = league("a");
const B = league("b");
const C = league("c");
const ME = "me";

describe("leaguemateShares", () => {
  test("counts shared leagues, most-shared first", () => {
    const shares = leaguemateShares(
      [A, B, C],
      { a: [ME, "u1", "u2"], b: [ME, "u1"], c: [ME, "u1", "u2"] },
      { u1: user("u1", "Slim"), u2: user("u2", "Deuce") },
      ME,
    );

    assert.equal(shares.league_count, 3);
    assert.deepEqual(
      shares.mates.map((m) => [m.user_id, m.leagues.length]),
      [
        ["u1", 3],
        ["u2", 2],
      ],
    );
  });

  test("the manager is never their own leaguemate", () => {
    const shares = leaguemateShares(
      [A, B],
      { a: [ME, "u1"], b: [ME] },
      { u1: user("u1", "Slim") },
      ME,
    );

    assert.deepEqual(
      shares.mates.map((m) => m.user_id),
      ["u1"],
    );
    // League b still counts: the manager's own row is what proves it is stored,
    // and "shared with nobody" is a real answer.
    assert.equal(shares.league_count, 2);
  });

  test("a league with no member rows is skipped, not counted as empty", () => {
    const shares = leaguemateShares(
      [A, B, C],
      { a: [ME, "u1"], b: [ME, "u1"] },
      { u1: user("u1", "Slim") },
      ME,
    );

    assert.equal(shares.league_count, 2);
    assert.equal(shares.mates[0].leagues.length, 2);
  });

  test("a leaguemate with no stored name falls back to the id", () => {
    const shares = leaguemateShares([A], { a: [ME, "u9"] }, {}, ME);
    assert.equal(shares.mates[0].name, "u9");
  });

  test("a null display name falls back too, rather than rendering blank", () => {
    const shares = leaguemateShares(
      [A],
      { a: [ME, "u9"] },
      { u9: user("u9", null) },
      ME,
    );
    assert.equal(shares.mates[0].name, "u9");
  });

  test("a null self id drops nobody", () => {
    // The stored account is optional; without one, everyone in the league is a
    // leaguemate, which is honest rather than wrong.
    const shares = leaguemateShares(
      [A],
      { a: ["u1", "u2"] },
      { u1: user("u1", "Slim"), u2: user("u2", "Deuce") },
      null,
    );
    assert.equal(shares.mates.length, 2);
  });
});
