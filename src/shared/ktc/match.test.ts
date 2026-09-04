import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeName, resolveSleeperIds } from "./match.ts";
import type { KtcPlayer } from "./types.ts";
import type { MatchablePlayer } from "../players/queries.ts";

/**
 * Name matching decides whether a KTC value ever reaches a Sleeper player, and
 * a wrong match is worse than none — so these pin both the recall (the tiers
 * that should hit) and the refusals (ambiguity must stay unresolved).
 */

const sleeper = (over: Partial<MatchablePlayer>): MatchablePlayer => ({
  player_id: "1",
  full_name: null,
  first_name: null,
  last_name: null,
  position: "WR",
  team: "CIN",
  active: true,
  birth_year: null,
  ...over,
});

const ktc = (over: Partial<KtcPlayer>): KtcPlayer => ({
  playerID: 1,
  playerName: "Player Name",
  slug: "player-name",
  position: "WR",
  team: "CIN",
  ...over,
});

/** Unix seconds for Jan 2 of `year`, as KTC serves birthdays. */
const birthday = (year: number) => String(Date.UTC(year, 0, 2) / 1000);

describe("normalizeName", () => {
  test("strips punctuation, accents and case", () => {
    assert.equal(normalizeName("Ja'Marr Chase"), "jamarr chase");
    assert.equal(normalizeName("Amon-Ra St. Brown"), "amon ra st brown");
  });

  test("drops generational suffixes so both sources agree", () => {
    assert.equal(normalizeName("Odell Beckham Jr."), normalizeName("Odell Beckham"));
    assert.equal(normalizeName("Michael Pittman Jr"), "michael pittman");
    assert.equal(normalizeName("Robert Griffin III"), "robert griffin");
  });

  test("collapses whitespace and handles empty input", () => {
    assert.equal(normalizeName("  Two   Spaces  "), "two spaces");
    assert.equal(normalizeName(""), "");
  });
});

describe("resolveSleeperIds", () => {
  test("tier 1: unique normalized name + position", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Ja'Marr Chase" })],
      [sleeper({ player_id: "4034", full_name: "JaMarr Chase" })],
    );
    assert.equal(ids.get(7), "4034");
  });

  test("falls back to first + last name when full_name is absent", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Puka Nacua" })],
      [sleeper({ player_id: "99", first_name: "Puka", last_name: "Nacua" })],
    );
    assert.equal(ids.get(7), "99");
  });

  test("does not match across positions", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Josh Allen", position: "QB" })],
      [sleeper({ player_id: "1", full_name: "Josh Allen", position: "LB" })],
    );
    assert.equal(ids.size, 0);
  });

  test("tier 2: breaks a same-name collision to the only active player", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Mike Williams" })],
      [
        sleeper({ player_id: "old", full_name: "Mike Williams", active: false, team: null }),
        sleeper({ player_id: "new", full_name: "Mike Williams", active: true }),
      ],
    );
    assert.equal(ids.get(7), "new");
  });

  test("tier 2: falls back to the only rostered player when both are active", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Mike Williams" })],
      [
        sleeper({ player_id: "fa", full_name: "Mike Williams", team: null }),
        sleeper({ player_id: "rostered", full_name: "Mike Williams", team: "NYJ" }),
      ],
    );
    assert.equal(ids.get(7), "rostered");
  });

  test("refuses to guess when a collision stays ambiguous", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Mike Williams" })],
      [
        sleeper({ player_id: "a", full_name: "Mike Williams", team: "NYJ" }),
        sleeper({ player_id: "b", full_name: "Mike Williams", team: "LAC" }),
      ],
    );
    assert.equal(ids.size, 0, "a wrong id is worse than a null one");
  });

  test("tier 3: recovers a nickname mismatch via last name + birth year", () => {
    const ids = resolveSleeperIds(
      [
        ktc({
          playerID: 7,
          playerName: "Gabe Davis",
          birthday: birthday(1999),
        }),
      ],
      [
        sleeper({
          player_id: "6803",
          full_name: "Gabriel Davis",
          birth_year: 1999,
        }),
      ],
    );
    assert.equal(ids.get(7), "6803");
  });

  test("tier 3 does not fire when the birth year disagrees", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Gabe Davis", birthday: birthday(1990) })],
      [sleeper({ player_id: "6803", full_name: "Gabriel Davis", birth_year: 1999 })],
    );
    assert.equal(ids.size, 0);
  });

  test("accepts a numeric birthday as well as a string", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Gabe Davis", birthday: Number(birthday(1999)) })],
      [sleeper({ player_id: "6803", full_name: "Gabriel Davis", birth_year: 1999 })],
    );
    assert.equal(ids.get(7), "6803");
  });

  test("ignores an unusable birthday instead of throwing", () => {
    for (const bad of ["", "not-a-number", 0, -1, null]) {
      const ids = resolveSleeperIds(
        [ktc({ playerID: 7, playerName: "Gabe Davis", birthday: bad as never })],
        [sleeper({ player_id: "6803", full_name: "Gabriel Davis", birth_year: 1999 })],
      );
      assert.equal(ids.size, 0, `expected no match for birthday ${String(bad)}`);
    }
  });

  test("returns an empty map when the players cache is empty", () => {
    const ids = resolveSleeperIds([ktc({ playerID: 7 })], []);
    assert.equal(ids.size, 0);
  });

  test("skips draft picks, which carry no numeric playerID", () => {
    const pick = { ...ktc({}), playerID: undefined as never, position: "RDP" };
    const ids = resolveSleeperIds([pick], [sleeper({})]);
    assert.equal(ids.size, 0);
  });
});

/**
 * The redraft board's two positions, which the dynasty board has neither of and
 * which Sleeper spells differently. Left unmapped they are the great majority
 * of everything that fails to match, and two of the seats a redraft lineup
 * fills.
 */
describe("resolveSleeperIds — the redraft board's own positions", () => {
  test("a kicker matches across KTC's 'PK' and Sleeper's 'K'", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Brandon Aubrey", position: "PK" })],
      [sleeper({ player_id: "8259", full_name: "Brandon Aubrey", position: "K" })],
    );
    assert.equal(ids.get(7), "8259");
  });

  // Sleeper has no `full_name` for a defence; the first/last fallback builds
  // exactly the name KTC prints.
  test("a defence matches across 'DST' and 'DEF', built from first + last", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Philadelphia Eagles", position: "DST" })],
      [
        sleeper({
          player_id: "PHI",
          first_name: "Philadelphia",
          last_name: "Eagles",
          position: "DEF",
        }),
      ],
    );
    assert.equal(ids.get(7), "PHI");
  });

  test("the rename does not let a position through that KTC shares with Sleeper", () => {
    const ids = resolveSleeperIds(
      [ktc({ playerID: 7, playerName: "Brandon Aubrey", position: "PK" })],
      [sleeper({ player_id: "x", full_name: "Brandon Aubrey", position: "WR" })],
    );
    assert.equal(ids.size, 0);
  });
});
