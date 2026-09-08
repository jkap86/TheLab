import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  LeagueRosterEntry,
  ManagerLeague,
  PlayerSummary,
} from "@/shared/contract";

import {
  leaguematePlayerRolls,
  leaguematePlayers,
  modeRolls,
  playerModeCounts,
  rosterIndex,
  rosterMatcher,
} from "./leaguemate-rosters.ts";

/** Only the field the folds read; the rest is the card's business. */
function league(id: string): ManagerLeague {
  return { league_id: id, name: `League ${id}` } as ManagerLeague;
}

function roster(
  roster_id: number,
  user_id: string | null,
  players: string[],
): LeagueRosterEntry {
  return { roster_id, user_id, players };
}

const NAMES: Record<string, PlayerSummary> = {
  p1: { player_id: "p1", name: "Chase", position: "WR", team: "CIN" },
  p2: { player_id: "p2", name: "Bowers", position: "TE", team: "LV" },
  p3: { player_id: "p3", name: "Achane", position: "RB", team: "MIA" },
};

const ME = "me";
const MATE = "u1";

/**
 * Three leagues:
 *  - `a` — the manager holds p1, the mate holds p2 and p3, an orphan holds p9.
 *  - `b` — the mate holds p2 only; nobody holds p1 or p3.
 *  - `c` — a league whose rosters were never stored (absent from the map).
 */
const ROSTERS: Record<string, LeagueRosterEntry[]> = {
  a: [
    roster(1, ME, ["p1", "", "0"]),
    roster(2, MATE, ["p2", "p3"]),
    roster(3, null, ["p9"]),
  ],
  b: [roster(1, ME, ["p2"]), roster(2, MATE, ["p2"])],
};

const LEAGUES = [league("a"), league("b"), league("c")];

describe("leaguematePlayers", () => {
  test("counts a person's own players over the shared set", () => {
    const out = leaguematePlayers(LEAGUES, MATE, ROSTERS, NAMES, ME);
    // `c` has no stored rosters, so it is not in the denominator — the
    // difference between "they hold nobody there" and "nobody has looked".
    assert.equal(out.league_count, 2);
    assert.deepEqual(
      out.players.map((p) => [p.name, p.held]),
      [
        ["Bowers", 2],
        ["Achane", 1],
      ],
    );
  });

  test("an unnamed id falls back to itself rather than to a blank", () => {
    const out = leaguematePlayers(LEAGUES, MATE, ROSTERS, {}, ME);
    assert.equal(out.players[0]?.name, "p2");
  });

  test("Sleeper's slot padding is never a player", () => {
    const out = leaguematePlayers(LEAGUES, ME, ROSTERS, NAMES, ME);
    assert.deepEqual(
      out.players.map((p) => p.player_id),
      ["p2", "p1"],
    );
  });

  test("an orphan team is nobody's", () => {
    // p9 is on a roster with no owner, so it is on nobody's board.
    for (const id of [ME, MATE]) {
      const out = leaguematePlayers(LEAGUES, id, ROSTERS, NAMES, ME);
      assert.equal(
        out.players.some((p) => p.player_id === "p9"),
        false,
      );
    }
  });

  test("a league they field no roster in is not in the denominator", () => {
    const rosters = { ...ROSTERS, d: [roster(1, ME, ["p1"])] };
    const out = leaguematePlayers(
      [...LEAGUES, league("d")],
      MATE,
      rosters,
      NAMES,
      ME,
    );
    // `d` is stored and the manager is in it; the mate is not, so counting it
    // would say they hold nobody in a league that is not theirs.
    assert.equal(out.league_count, 2);
  });

  test("one league is one share however many rosters name him", () => {
    const rosters = {
      a: [roster(1, MATE, ["p1"]), roster(2, MATE, ["p1", "p2"])],
    };
    const out = leaguematePlayers([league("a")], MATE, rosters, NAMES, ME);
    assert.deepEqual(
      out.players.map((p) => [p.player_id, p.held]),
      // Sorted by hold count, ties on the name — "Bowers" before "Chase".
      [
        ["p2", 1],
        ["p1", 1],
      ],
    );
  });

  test("`mine` is the manager's own hold anywhere in the counted set", () => {
    const out = leaguematePlayers(LEAGUES, MATE, ROSTERS, NAMES, ME);
    // The manager holds p2 in `b`, which is a league shared with them.
    assert.equal(out.players.find((p) => p.player_id === "p2")?.mine, true);
    assert.equal(out.players.find((p) => p.player_id === "p3")?.mine, false);
  });

  test("the scopes narrow the list and leave the denominator alone", () => {
    const both = leaguematePlayers(LEAGUES, MATE, ROSTERS, NAMES, ME);
    const twice = leaguematePlayers(
      LEAGUES,
      MATE,
      ROSTERS,
      NAMES,
      ME,
      "shared2",
    );
    const mine = leaguematePlayers(LEAGUES, MATE, ROSTERS, NAMES, ME, "mine");
    assert.deepEqual(
      twice.players.map((p) => p.player_id),
      ["p2"],
    );
    assert.deepEqual(
      mine.players.map((p) => p.player_id),
      ["p2"],
    );
    // A scope is a way of reading the board, not a smaller board: the pip's
    // denominator must not move when one is pressed.
    for (const out of [twice, mine]) {
      assert.equal(out.league_count, both.league_count);
    }
  });
});

describe("playerModeCounts", () => {
  test("the three are exclusive and skip what nobody stored", () => {
    // p1: the manager's in `a`, nobody's in `b`, `c` unstored.
    assert.deepEqual(playerModeCounts(LEAGUES, "p1", ROSTERS, ME), {
      owned: 1,
      taken: 0,
      available: 1,
    });
    // p3: the mate's in `a`, free in `b`.
    assert.deepEqual(playerModeCounts(LEAGUES, "p3", ROSTERS, ME), {
      owned: 0,
      taken: 1,
      available: 1,
    });
    // p2: the mate's in `a`, the manager's in `b` — owned wins its league.
    assert.deepEqual(playerModeCounts(LEAGUES, "p2", ROSTERS, ME), {
      owned: 1,
      taken: 1,
      available: 0,
    });
  });

  test("a league nobody has stored is in none of the three", () => {
    // The sum is the leagues that answered, which is what makes it honest to
    // print beside a panel counting more leagues than that.
    const counts = playerModeCounts(LEAGUES, "p1", ROSTERS, ME);
    assert.equal(counts.owned + counts.taken + counts.available, 2);
  });

  test("a player held only by an orphan team is free in no league", () => {
    // Held, so not available; held by nobody, so not taken. It falls out of
    // all three rather than being counted as free.
    assert.deepEqual(playerModeCounts([league("a")], "p9", ROSTERS, ME), {
      owned: 0,
      taken: 0,
      available: 0,
    });
  });

  test("Sleeper's padding is never counted", () => {
    for (const id of ["", "0"]) {
      assert.deepEqual(playerModeCounts(LEAGUES, id, ROSTERS, ME), {
        owned: 0,
        taken: 0,
        available: 0,
      });
    }
  });

  test("with no manager resolved yet, nothing is owned", () => {
    // `selfId` is null until the leagues stream answers. Reading that as
    // "the manager holds nobody" is right; reading it as "everybody else does"
    // would be a narrowing built out of a payload that has not landed.
    assert.deepEqual(playerModeCounts(LEAGUES, "p1", ROSTERS, null), {
      owned: 0,
      taken: 1,
      available: 1,
    });
  });
});

describe("modeRolls", () => {
  test("everyone holds what taken does, plus the manager's own", () => {
    const { taken, everyone } = modeRolls(ROSTERS, ME);
    assert.deepEqual([...everyone.a].sort(), ["p1", "p2", "p3", "p9"]);
    // p1 is the manager's and p9 is an orphan's — neither is *taken*.
    assert.deepEqual([...taken.a].sort(), ["p2", "p3"]);
  });

  test("a league that stored an empty board keeps its key", () => {
    // Everybody is available there, which is a different answer from the
    // league nobody has read — and the key is the only thing that says so.
    const { everyone } = modeRolls({ a: [roster(1, ME, [])] }, ME);
    assert.deepEqual(everyone, { a: [] });
  });

  test("a league nobody stored has no key at all", () => {
    const { everyone } = modeRolls(ROSTERS, ME);
    assert.equal("c" in everyone, false);
  });
});

describe("leaguematePlayerRolls", () => {
  test("names a pair per rostered player, and nothing for an orphan", () => {
    const rolls = leaguematePlayerRolls(ROSTERS);
    assert.deepEqual(rolls.a.sort(), ["me:p1", "u1:p2", "u1:p3"]);
    assert.deepEqual(rolls.b.sort(), ["me:p2", "u1:p2"]);
  });
});

describe("rosterIndex", () => {
  test("one entry per person, deduped across leagues", () => {
    const index = rosterIndex(LEAGUES, ROSTERS);
    assert.deepEqual([...(index.get(MATE) ?? [])].sort(), ["p2", "p3"]);
    assert.deepEqual([...(index.get(ME) ?? [])].sort(), ["p1", "p2"]);
    // An orphan team has nobody to index it under.
    assert.equal(index.has("null"), false);
    assert.equal(index.size, 2);
  });
});

describe("rosterMatcher", () => {
  test("matches a name on that person's board, case-insensitively", () => {
    const matches = rosterMatcher(LEAGUES, ROSTERS, NAMES);
    // The needle arrives lower-cased, as the drawer hands it over.
    assert.equal(matches(MATE, "bow"), true);
    assert.equal(matches(MATE, "achane"), true);
    // Chase is the manager's, not the mate's.
    assert.equal(matches(MATE, "chase"), false);
    assert.equal(matches(ME, "chase"), true);
  });

  test("an id with no stored name is a token, not a searchable name", () => {
    const matches = rosterMatcher(LEAGUES, ROSTERS, {});
    assert.equal(matches(MATE, "bow"), false);
    // Nor does the raw id match: the chip draws it, the search does not read it.
    assert.equal(matches(MATE, "p2"), false);
  });

  test("a person with no roster in the counted set matches nothing", () => {
    const matches = rosterMatcher(LEAGUES, ROSTERS, NAMES);
    assert.equal(matches("nobody", "bow"), false);
  });

  test("the index is built on the first call, not on construction", () => {
    // A rosters map that counts how often it is walked: constructing the
    // matcher must not touch it, and two calls must walk it once.
    let walks = 0;
    const counted = new Proxy(ROSTERS, {
      get(target, key, receiver) {
        walks++;
        return Reflect.get(target, key, receiver);
      },
    });
    const matches = rosterMatcher(LEAGUES, counted, NAMES);
    assert.equal(walks, 0);
    matches(MATE, "bow");
    const afterFirst = walks;
    assert.ok(afterFirst > 0);
    matches(MATE, "achane");
    assert.equal(walks, afterFirst);
  });
});
