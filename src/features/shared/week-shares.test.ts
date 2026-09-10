import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/contract";

import { weekSubjectRolls, weekTwoSidedShares } from "./week-shares.ts";
import type {
  WeekLineupEntry,
  WeekSharePlayer,
  WeekShareSeat,
  WeekShareSide,
} from "./week-shares.ts";

/**
 * The fixtures are the **normalised** side rather than either tool's payload,
 * which is the whole point of the fold taking one: what is under test is the
 * counting, and a fixture shaped like the checker's wire would be a test that
 * passed for gametime by accident.
 */
function player(
  id: string,
  figure: number | null = 10,
  over: Partial<WeekSharePlayer> = {},
): WeekSharePlayer {
  return {
    player_id: id,
    name: id.toUpperCase(),
    positions: ["RB"],
    team: "BAL",
    figure,
    ...over,
  };
}

const seat = (slot: string, p: WeekSharePlayer | null): WeekShareSeat => ({
  slot,
  player: p,
});

function one(
  id: string,
  lineup: WeekShareSeat[],
  bench: WeekSharePlayer[],
  over: Partial<Omit<WeekLineupEntry, "league" | "mine">> = {},
): WeekLineupEntry {
  return {
    league: { league_id: id, name: `League ${id}` } as unknown as ManagerLeague,
    mine: { lineup, bench },
    opponent: null,
    set_by_manager: true,
    ...over,
  };
}

const side = (
  lineup: WeekShareSeat[],
  bench: WeekSharePlayer[],
): WeekShareSide => ({ lineup, bench });

describe("weekTwoSidedShares", () => {
  test("counts the seats and the bench apart, on the manager's side", () => {
    const a = player("a");
    const b = player("b");
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", a)], [b]),
      one("l2", [seat("RB", b)], [a]),
    ]);

    assert.equal(shares.starter_league_count, 2);
    const rows = new Map(shares.players.map((p) => [p.player_id, p]));
    assert.deepEqual([rows.get("a")!.started, rows.get("a")!.benched], [1, 1]);
    assert.deepEqual([rows.get("b")!.started, rows.get("b")!.benched], [1, 1]);
  });

  test("an empty seat is not a player", () => {
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", player("a")), seat("WR", null)], []),
    ]);
    assert.deepEqual(
      shares.players.map((p) => p.player_id),
      ["a"],
    );
  });

  test("one lineup is one decision per player, however often he is named", () => {
    const a = player("a");
    // A roster naming him twice, and — worse — in both arrays at once.
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", a), seat("FLEX", a)], [a]),
    ]);
    const row = shares.players[0];
    assert.equal(row.started, 1);
    assert.equal(row.benched, 0);
    assert.equal(row.leagues.start.length, 1);
  });

  test("the two sides are counted apart, in one row", () => {
    // The whole of what the merge buys: one row, four numbers.
    const shared = player("shared");
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", shared)], [], {
        opponent: side([seat("RB", player("theirs"))], [player("their-bench")]),
      }),
      one("l2", [seat("RB", player("mine"))], [], {
        opponent: side([], [shared]),
      }),
    ]);

    const rows = new Map(shares.players.map((p) => [p.player_id, p]));
    const row = rows.get("shared")!;
    assert.deepEqual(
      [row.started, row.benched, row.oppStarted, row.oppBenched],
      [1, 0, 0, 1],
    );
    // Every player either side fielded is on the list exactly once.
    assert.deepEqual(
      shares.players.map((p) => p.player_id).sort(),
      ["mine", "shared", "their-bench", "theirs"],
    );
  });

  test("the two denominators are counted apart, and the opposing one is lower", () => {
    // A league with no opponent contributes to one and not the other, which is
    // why both cross the wire: two of the four columns are scaled by each.
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", player("a"))], [], {
        opponent: side([seat("RB", player("b"))], []),
      }),
      one("l2", [seat("RB", player("a"))], []),
    ]);
    assert.equal(shares.starter_league_count, 2);
    assert.equal(shares.opponent_league_count, 1);
  });

  test("a league neither side answered for is skipped, not counted as fielding nobody", () => {
    // The denominator rule: zeroing it would deflate every share on the panel.
    const shares = weekTwoSidedShares([]);
    assert.equal(shares.starter_league_count, 0);
    assert.equal(shares.opponent_league_count, 0);
    assert.deepEqual(shares.players, []);
  });

  test("the leagues behind each reading are kept apart", () => {
    const a = player("a");
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", a)], []),
      one("l2", [], [a]),
      one("l3", [seat("RB", player("x"))], [], { opponent: side([], [a]) }),
    ]);
    const row = shares.players.find((p) => p.player_id === "a")!;
    assert.deepEqual(row.leagues.start.map((l) => l.league_id), ["l1"]);
    assert.deepEqual(row.leagues.bench.map((l) => l.league_id), ["l2"]);
    assert.deepEqual(row.leagues["opp-start"], []);
    assert.deepEqual(row.leagues["opp-bench"].map((l) => l.league_id), ["l3"]);
  });

  test("a figure two leagues disagree on has no shared answer", () => {
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", player("a", 12))], []),
      one("l2", [seat("RB", player("a", 14))], []),
    ]);
    assert.equal(shares.players[0].figure, null);
  });

  test("the sides disagreeing about a figure is still a disagreement", () => {
    // It is a fact about the player rather than about which roster he is on.
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", player("a", 12))], []),
      one("l2", [seat("RB", player("x"))], [], {
        opponent: side([seat("RB", player("a", 14))], []),
      }),
    ]);
    const row = shares.players.find((p) => p.player_id === "a")!;
    assert.equal(row.figure, null);
  });

  test("a figure every league agrees on survives, and null is not zero", () => {
    const agreed = weekTwoSidedShares([
      one("l1", [seat("RB", player("a", 12))], []),
      one("l2", [seat("RB", player("a", 12))], []),
    ]);
    assert.equal(agreed.players[0].figure, 12);

    // Figureless in both is still figureless, not a disagreement.
    const blank = weekTwoSidedShares([
      one("l1", [seat("RB", player("a", null))], []),
      one("l2", [seat("RB", player("a", null))], []),
    ]);
    assert.equal(blank.players[0].figure, null);
  });

  test("most started first, then most benched, then the opposing pair, then by name", () => {
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", player("b"))], [player("a"), player("c")]),
      one("l2", [seat("RB", player("b"))], [player("c")]),
    ]);
    assert.deepEqual(
      shares.players.map((p) => p.player_id),
      // b started twice; c benched twice; a benched once.
      ["b", "c", "a"],
    );
  });

  test("the name falls back to the id rather than to a blank", () => {
    const shares = weekTwoSidedShares([
      one("l1", [seat("RB", player("4034", 10, { name: null }))], []),
    ]);
    assert.equal(shares.players[0].name, "4034");
  });
});

describe("weekSubjectRolls", () => {
  test("four readings and a resting one, each its own population", () => {
    const rolls = weekSubjectRolls([
      one("l1", [seat("RB", player("a"))], [player("b")], {
        opponent: side([seat("RB", player("c"))], [player("d")]),
      }),
    ]);

    assert.deepEqual(rolls.start.l1, ["a"]);
    assert.deepEqual(rolls.bench.l1, ["b"]);
    assert.deepEqual(rolls["opp-start"].l1, ["c"]);
    assert.deepEqual(rolls["opp-bench"].l1, ["d"]);
    // The resting reading: everybody either side fielded.
    assert.deepEqual(rolls.either.l1.sort(), ["a", "b", "c", "d"]);
  });

  test("a league with no opponent has no row in the two opposing maps", () => {
    // Which `matchesSubjects` reads as "this league does not hold them" — a
    // different state from the map not having arrived at all.
    const rolls = weekSubjectRolls([
      one("l1", [seat("RB", player("a"))], []),
    ]);
    assert.deepEqual(rolls.start.l1, ["a"]);
    assert.equal("l1" in rolls["opp-start"], false);
    assert.equal("l1" in rolls["opp-bench"], false);
    assert.deepEqual(rolls.either.l1, ["a"]);
  });

  test("a side that fielded nobody is an empty row, not an absent one", () => {
    // It answered; it just had nobody in it. Absent would read the same to
    // `holds` here, but the two are different facts and only one is stated.
    const rolls = weekSubjectRolls([one("l1", [], [])]);
    assert.deepEqual(rolls.start.l1, []);
    assert.deepEqual(rolls.either.l1, []);
  });
});
