import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ManagerLeague } from "@/shared/contract";

import { weekPlayerShares } from "./week-shares.ts";
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

describe("weekPlayerShares", () => {
  test("counts the seats and the bench apart", () => {
    const a = player("a");
    const b = player("b");
    const shares = weekPlayerShares(
      [one("l1", [seat("RB", a)], [b]), one("l2", [seat("RB", b)], [a])],
      "starter",
    );

    assert.equal(shares.league_count, 2);
    const rows = new Map(shares.players.map((p) => [p.player_id, p]));
    assert.deepEqual(
      [rows.get("a")!.started, rows.get("a")!.benched],
      [1, 1],
    );
    assert.deepEqual(
      [rows.get("b")!.started, rows.get("b")!.benched],
      [1, 1],
    );
  });

  test("an empty seat is not a player", () => {
    const shares = weekPlayerShares(
      [one("l1", [seat("RB", player("a")), seat("WR", null)], [])],
      "starter",
    );
    assert.deepEqual(shares.players.map((p) => p.player_id), ["a"]);
  });

  test("one lineup is one decision per player, however often he is named", () => {
    const a = player("a");
    // A roster naming him twice, and — worse — in both arrays at once.
    const shares = weekPlayerShares(
      [one("l1", [seat("RB", a), seat("FLEX", a)], [a])],
      "starter",
    );
    const row = shares.players[0];
    assert.equal(row.started, 1);
    assert.equal(row.benched, 0);
    assert.equal(row.leagues.length, 1);
  });

  test("a league with no lineup is skipped, not counted as starting nobody", () => {
    // The denominator rule: zeroing it would deflate every share on the page.
    const shares = weekPlayerShares(
      [
        one("l1", [seat("RB", player("a"))], []),
        one("l2", [seat("RB", player("a"))], [], { opponent: null }),
      ],
      "opponent",
    );
    assert.equal(shares.league_count, 0);
    assert.deepEqual(shares.players, []);
  });

  test("the opponent side reads the opponent's own two arrays", () => {
    const mine = player("mine");
    const theirs = player("theirs");
    const shares = weekPlayerShares(
      [
        one("l1", [seat("RB", mine)], [], {
          opponent: side([seat("RB", theirs)], [player("their-bench")]),
        }),
      ],
      "opponent",
    );
    assert.equal(shares.league_count, 1);
    assert.deepEqual(
      shares.players.map((p) => p.player_id).sort(),
      ["their-bench", "theirs"],
    );
    // The manager's own starter is nowhere in an opponent fold.
    assert.equal(
      shares.players.some((p) => p.player_id === "mine"),
      false,
    );
  });

  test("a figure two leagues disagree on has no shared answer", () => {
    const shares = weekPlayerShares(
      [
        one("l1", [seat("RB", player("a", 12))], []),
        one("l2", [seat("RB", player("a", 14))], []),
      ],
      "starter",
    );
    assert.equal(shares.players[0].figure, null);
  });

  test("a figure every league agrees on survives, and null is not zero", () => {
    const agreed = weekPlayerShares(
      [
        one("l1", [seat("RB", player("a", 12))], []),
        one("l2", [seat("RB", player("a", 12))], []),
      ],
      "starter",
    );
    assert.equal(agreed.players[0].figure, 12);

    // Figureless in both is still figureless, not a disagreement.
    const blank = weekPlayerShares(
      [
        one("l1", [seat("RB", player("a", null))], []),
        one("l2", [seat("RB", player("a", null))], []),
      ],
      "starter",
    );
    assert.equal(blank.players[0].figure, null);
  });

  test("most started first, then most benched, then by name", () => {
    const shares = weekPlayerShares(
      [
        one("l1", [seat("RB", player("b"))], [player("a"), player("c")]),
        one("l2", [seat("RB", player("b"))], [player("c")]),
      ],
      "starter",
    );
    assert.deepEqual(
      shares.players.map((p) => p.player_id),
      // b started twice; c benched twice; a benched once.
      ["b", "c", "a"],
    );
  });

  test("the name falls back to the id rather than to a blank", () => {
    const shares = weekPlayerShares(
      [one("l1", [seat("RB", player("4034", 10, { name: null }))], [])],
      "starter",
    );
    assert.equal(shares.players[0].name, "4034");
  });

  test("no leagues is a league count of zero, not a divide", () => {
    const shares = weekPlayerShares([], "starter");
    assert.equal(shares.league_count, 0);
    assert.deepEqual(shares.players, []);
  });
});
