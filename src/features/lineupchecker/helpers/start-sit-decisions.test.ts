import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  LineupCheckLeague,
  LineupCheckPlayer,
  LineupCheckSeat,
  ManagerLeague,
} from "@/shared/contract";

import { decisionsFor, relFor, seatTakes } from "./start-sit-decisions.ts";
import type { WeekLineupEntry } from "./starter-shares.ts";

const ONE_QB = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN", "BN"];
const SUPERFLEX = [...ONE_QB, "SUPER_FLEX"];

function player(
  id: string,
  positions: string[],
  points: number | null = 10,
): LineupCheckPlayer {
  return {
    player_id: id,
    name: id.toUpperCase(),
    positions,
    points,
    team: "BAL",
    kickoff: null,
    locked: false,
  };
}

function seat(slot: string, p: LineupCheckPlayer | null): LineupCheckSeat {
  return { slot, player: p, move_to: null };
}

function league(id: string, rosterPositions: string[]): ManagerLeague {
  return {
    league_id: id,
    name: `League ${id}`,
    roster_positions: rosterPositions,
  } as unknown as ManagerLeague;
}

function entry(
  lineup: LineupCheckSeat[],
  bench: LineupCheckPlayer[],
  over: Partial<LineupCheckLeague> = {},
): LineupCheckLeague {
  return { lineup, bench, ...over } as unknown as LineupCheckLeague;
}

function one(
  id: string,
  rosterPositions: string[],
  lineup: LineupCheckSeat[],
  bench: LineupCheckPlayer[],
  over: Partial<LineupCheckLeague> = {},
): WeekLineupEntry {
  return { league: league(id, rosterPositions), entry: entry(lineup, bench, over) };
}

describe("seatTakes", () => {
  test("reads the app's own slot vocabulary", () => {
    assert.deepEqual(seatTakes("QB"), ["QB"]);
    assert.deepEqual(seatTakes("FLEX"), ["RB", "WR", "TE"]);
    assert.deepEqual(seatTakes("SUPER_FLEX"), ["QB", "RB", "WR", "TE"]);
  });

  test("a seat this build does not know takes nobody", () => {
    // The conservative answer, and the one that keeps a pairing from being
    // listed against a seat that would refuse it.
    assert.deepEqual(seatTakes("OP"), []);
    assert.deepEqual(seatTakes("BN"), []);
  });
});

describe("relFor", () => {
  test("a seat that takes the position is direct", () => {
    assert.deepEqual(relFor("RB", ["RB"], ONE_QB), { direct: true, via: null });
    assert.deepEqual(relFor("FLEX", ["TE"], ONE_QB), { direct: true, via: null });
  });

  test("a WR is never a candidate for a QB-only seat in a one-QB league", () => {
    // The claim this module exists to refuse: there is no seat in this lineup
    // that takes both a quarterback and a receiver.
    assert.equal(relFor("QB", ["WR"], ONE_QB), null);
  });

  test("the superflex route is what makes that pairing legal, and only there", () => {
    assert.deepEqual(relFor("QB", ["WR"], SUPERFLEX), {
      direct: false,
      via: "SUPER_FLEX",
    });
  });

  test("the flex route is tested before the superflex one", () => {
    // Both would serve in a superflex league; naming SUPER_FLEX would tell the
    // reader the mechanism changed when only the league did.
    assert.deepEqual(relFor("RB", ["TE"], SUPERFLEX), {
      direct: false,
      via: "FLEX",
    });
    // And the same swap in a league with no superflex seat reads identically.
    assert.deepEqual(relFor("RB", ["TE"], ONE_QB), {
      direct: false,
      via: "FLEX",
    });
  });

  test("the bridge has to be a seat the league actually starts", () => {
    // Same two positions, a lineup with no flex of any kind: no route.
    assert.equal(relFor("RB", ["TE"], ["QB", "RB", "WR", "TE", "BN"]), null);
    // And a bench slot is not a bridge — a chain through BN is both players
    // sitting, which is not a swap.
    assert.equal(relFor("QB", ["WR"], ["QB", "WR", "BN", "BN"]), null);
  });

  test("a player's whole position list is asked, not his first", () => {
    // A tight end who is also a quarterback is legal in a QB seat directly.
    assert.deepEqual(relFor("QB", ["TE", "QB"], ONE_QB), {
      direct: true,
      via: null,
    });
  });

  test("an unknown seat and an unsynced lineup both refuse rather than guess", () => {
    assert.equal(relFor("OP", ["QB"], SUPERFLEX), null);
    assert.equal(relFor("RB", ["TE"], null), null);
  });
});

describe("decisionsFor", () => {
  const qb = player("qb1", ["QB"], 20);
  const rb = player("rb1", ["RB"], 15);
  const te = player("te1", ["TE"], 9);
  const wr = player("wr1", ["WR"], 12);

  test("a started subject is paired with the bench his seat would take", () => {
    const groups = decisionsFor(
      "rb1",
      [one("a", ONE_QB, [seat("RB", rb), seat("QB", qb)], [te, wr])],
      "starter",
    );

    // The quarterback is a starter, not a counterpart; the two bench players
    // both reach the RB seat through the flex this league carries.
    assert.deepEqual(
      groups.map((g) => g.player_id).sort(),
      ["te1", "wr1"],
    );
    const teGroup = groups.find((g) => g.player_id === "te1")!;
    assert.equal(teGroup.starts, 1);
    assert.equal(teGroup.sits, 0);
    assert.deepEqual(teGroup.rows[0].route, { direct: false, via: "FLEX" });
    // 15 − 9: the lineup got this one right.
    assert.equal(teGroup.rows[0].delta, 6);
    assert.equal(teGroup.rows[0].lost, false);
  });

  test("a benched subject is judged against the seat the other player holds", () => {
    const bench = player("rb2", ["RB"], 18);
    const groups = decisionsFor(
      "rb2",
      [one("a", ONE_QB, [seat("RB", rb), seat("QB", qb)], [bench])],
      "starter",
    );

    // The QB seat cannot hold a running back and this league has no superflex,
    // so the quarterback is not a pairing at all.
    assert.deepEqual(groups.map((g) => g.player_id), ["rb1"]);
    const row = groups[0].rows[0];
    assert.equal(row.started, false);
    assert.equal(row.seat, "RB");
    // 15 started over an 18 on the bench: points left behind.
    assert.equal(row.delta, -3);
    assert.equal(row.lost, true);
  });

  test("a counterpart against an illegal seat is never listed", () => {
    // A receiver on the bench of a one-QB league: the quarterback in the QB
    // seat was not chosen over him, because no lineup here could seat him
    // there. The prototype's first revision listed exactly this.
    const groups = decisionsFor(
      "qb1",
      [one("a", ONE_QB, [seat("QB", qb)], [wr, te])],
      "starter",
    );
    assert.deepEqual(groups, []);

    // Add a superflex seat and the same pairing becomes real, through it.
    const sf = decisionsFor(
      "qb1",
      [one("a", SUPERFLEX, [seat("QB", qb)], [wr, te])],
      "starter",
    );
    assert.deepEqual(sf.map((g) => g.player_id).sort(), ["te1", "wr1"]);
    assert.deepEqual(sf[0].rows[0].route, { direct: false, via: "SUPER_FLEX" });
  });

  test("one counterpart is one group across leagues, one row per league", () => {
    const groups = decisionsFor(
      "rb1",
      [
        one("a", ONE_QB, [seat("RB", rb)], [te]),
        one("b", ONE_QB, [seat("RB", rb)], [te]),
      ],
      "starter",
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].rows.length, 2);
    assert.equal(groups[0].starts, 2);
    assert.deepEqual(
      groups[0].rows.map((r) => r.league_id),
      ["a", "b"],
    );
  });

  test("a pairing named twice in one lineup is one row, not two", () => {
    // A bench listing the same id twice is one decision read twice.
    const groups = decisionsFor(
      "rb1",
      [one("a", ONE_QB, [seat("RB", rb)], [te, te])],
      "starter",
    );
    assert.equal(groups[0].rows.length, 1);
    assert.equal(groups[0].starts, 1);
  });

  test("an unprojected player has no delta, and no delta is not a loss", () => {
    const blank = player("x", ["TE"], null);
    const groups = decisionsFor(
      "rb1",
      [one("a", ONE_QB, [seat("RB", rb)], [blank])],
      "starter",
    );
    assert.equal(groups[0].rows[0].delta, null);
    assert.equal(groups[0].rows[0].lost, false);
  });

  test("a repeated slot is numbered; a single one is not", () => {
    const rb2 = player("rb2", ["RB"], 14);
    const groups = decisionsFor(
      "rb2",
      [one("a", ONE_QB, [seat("RB", rb), seat("RB", rb2), seat("TE", te)], [wr])],
      "starter",
    );
    const row = groups.find((g) => g.player_id === "wr1")!.rows[0];
    assert.equal(row.seat, "RB");
    assert.equal(row.seat_index, 2);

    // The tight end's seat is the only TE in this lineup, so it is not numbered.
    const teGroups = decisionsFor(
      "wr1",
      [one("a", ONE_QB, [seat("TE", te)], [wr])],
      "starter",
    );
    assert.equal(teGroups[0].rows[0].seat_index, null);
  });

  test("the opponent side reads the opponent's lineup, and null is not empty", () => {
    const opp = one("a", ONE_QB, [seat("RB", rb)], [te], {
      opponent_lineup: [seat("RB", player("orb", ["RB"], 11))],
      opponent_bench: [player("ote", ["TE"], 7)],
    });
    const groups = decisionsFor("orb", [opp], "opponent");
    assert.deepEqual(groups.map((g) => g.player_id), ["ote"]);

    // A week with no opponent contributes nothing rather than an empty lineup.
    const none = one("a", ONE_QB, [seat("RB", rb)], [te], {
      opponent_lineup: null,
      opponent_bench: null,
    });
    assert.deepEqual(decisionsFor("orb", [none], "opponent"), []);
  });

  test("a league the subject is not on contributes nothing", () => {
    const groups = decisionsFor(
      "nobody",
      [one("a", ONE_QB, [seat("RB", rb)], [te])],
      "starter",
    );
    assert.deepEqual(groups, []);
  });

  test("a projection two leagues disagree on has no shared answer", () => {
    const cheap = player("te1", ["TE"], 9);
    const dear = player("te1", ["TE"], 11);
    const groups = decisionsFor(
      "rb1",
      [
        one("a", ONE_QB, [seat("RB", rb)], [cheap]),
        one("b", ONE_QB, [seat("RB", rb)], [dear]),
      ],
      "starter",
    );
    assert.equal(groups[0].points, null);
    // The per-league deltas are unaffected: each is computed inside one lineup.
    assert.deepEqual(groups[0].rows.map((r) => r.delta), [6, 4]);
  });
});
