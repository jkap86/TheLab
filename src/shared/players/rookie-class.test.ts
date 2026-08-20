import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CURRENT_ROOKIE_CLASS, rookieClassIds } from "./rookie-class.ts";
import { toPlayerSummary } from "./summary.ts";
import type { PlayerNameRow } from "./summary.ts";

/**
 * The rookie class as a derivation over the players read, rather than as a
 * second query.
 *
 * The rule it has to keep is the one the SQL kept — `years_exp = 0`, where a
 * null is *not* a match — and it is worth asserting here rather than in the
 * database because that predicate is now TypeScript: a `!player.years_exp`
 * written by accident would fold every unfilled `years_exp` into the class, and
 * a wrong *inclusion* shifts every rung of the pick ladder below it.
 */

const row = (player_id: string, name: string): PlayerNameRow => ({
  player_id,
  full_name: name,
  first_name: null,
  last_name: null,
  position: "WR",
  team: "CIN",
});

const player = (id: string, name: string, years_exp: number | null) => ({
  ...toPlayerSummary(row(id, name)),
  years_exp,
});

const BOARD = {
  rookie: player("rookie", "First Year", 0),
  second: player("second", "Second Year", 1),
  veteran: player("veteran", "Long Time", 9),
  unknown: player("unknown", "Nothing On File", null),
};

describe("rookieClassIds", () => {
  test("names exactly the players with no completed season", () => {
    assert.deepEqual([...rookieClassIds(BOARD)], ["rookie"]);
  });

  test("a null years_exp is not a rookie and not a veteran — it is unknown", () => {
    // Sleeper leaves it null for a team defence and a long tail of players.
    // Counting one in would invent a rung; the honest answer is to leave it out.
    assert.equal(rookieClassIds(BOARD).has("unknown"), false);
  });

  test("a second-year player is not in the class", () => {
    assert.equal(rookieClassIds(BOARD).has("second"), false);
    assert.equal(rookieClassIds(BOARD).has("veteran"), false);
  });

  test("the current class is the default", () => {
    assert.deepEqual(
      [...rookieClassIds(BOARD, CURRENT_ROOKIE_CLASS)],
      [...rookieClassIds(BOARD)],
    );
  });

  test("a named season answers empty rather than guessing", () => {
    // The seam: nothing stored names a past class, so the honest answer is no
    // ladder at all — see the module note.
    assert.equal(rookieClassIds(BOARD, { kind: "season", season: "2024" }).size, 0);
  });

  test("an empty board has an empty class", () => {
    assert.equal(rookieClassIds({}).size, 0);
  });

  test("it answers over exactly the players it was given", () => {
    // The old query was narrowed by id for this reason: a board can only rank
    // rookies it averaged, and a player the read didn't return cannot be one.
    const ids = rookieClassIds({ rookie: BOARD.rookie });
    assert.deepEqual([...ids], ["rookie"]);
  });
});

describe("the consolidated read answers both questions identically", () => {
  test("the class matches what a `years_exp = 0` query would have returned", () => {
    // What the second query used to do, spelled out: the same predicate against
    // the same rows. If these two ever disagree, `/api/adp`'s `rookie` flag has
    // moved and the pick ladder with it.
    const asSqlWouldHave = new Set(
      Object.values(BOARD)
        .filter((p) => p.years_exp === 0)
        .map((p) => p.player_id),
    );
    assert.deepEqual(rookieClassIds(BOARD), asSqlWouldHave);
  });

  test("the display half is untouched by the extra column", () => {
    // The other half of "the response is identical": the summary fields the
    // payload reads come off the same mapping as before, and `years_exp` rides
    // beside them rather than through them.
    for (const [id, entry] of Object.entries(BOARD)) {
      const { years_exp, ...summary } = entry;
      assert.deepEqual(summary, toPlayerSummary(row(id, summary.name)));
      assert.equal(typeof years_exp, entry.years_exp === null ? "object" : "number");
    }
  });
});
