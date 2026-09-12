import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BENCH_SLOT,
  breakdownLeagueCount,
  playerBreakdown,
} from "./player-breakdown.ts";
import type { BreakdownGroupKey } from "./player-breakdown.ts";
import type {
  WeekLineupEntry,
  WeekSharePlayer,
  WeekShareSide,
} from "../../shared/week-shares.ts";
import type { ManagerLeague } from "@/shared/contract";

const player = (id: string): WeekSharePlayer => ({
  player_id: id,
  name: id,
  positions: ["WR"],
  team: "CIN",
  figure: 12,
});

const league = (id: string, name: string): ManagerLeague =>
  ({ league_id: id, name }) as ManagerLeague;

const side = (
  teamName: string | null,
  lineup: readonly (readonly [string, string])[],
  bench: readonly string[],
): WeekShareSide => ({
  team_name: teamName,
  lineup: lineup.map(([slot, id]) => ({ slot, player: id ? player(id) : null })),
  bench: bench.map(player),
});

const entry = (
  id: string,
  name: string,
  mine: WeekShareSide,
  opponent: WeekShareSide | null,
): WeekLineupEntry => ({
  league: league(id, name),
  mine,
  opponent,
  set_by_manager: true,
});

/** One league per group, in the order the groups are drawn. */
const FIVE: WeekLineupEntry[] = [
  entry("L1", "Dynasty Degens", side(null, [["WR1", "chase"]], []), side("Corn Squad", [], [])),
  entry("L2", "Redraft Rivals", side(null, [], ["chase"]), side("Big Nickel", [], [])),
  entry("L3", "The Gauntlet", side(null, [], []), side("Hail Marys", [["WR2", "chase"]], [])),
  entry("L4", "Sunday Service", side(null, [], []), side("Turf Toe", [], ["chase"])),
  entry("L5", "Bench Mob", side(null, [], []), side("Play Action", [], [])),
];

const keys = (entries: readonly WeekLineupEntry[], id = "chase"): BreakdownGroupKey[] =>
  playerBreakdown(id, entries).map((g) => g.key);

describe("playerBreakdown", () => {
  test("each league lands in exactly one group, in the drawn order", () => {
    const groups = playerBreakdown("chase", FIVE);
    assert.deepEqual(keys(FIVE), ["start", "bench", "opp-start", "opp-bench", "none"]);
    assert.deepEqual(
      groups.map((g) => g.rows.map((r) => r.league_id)),
      [["L1"], ["L2"], ["L3"], ["L4"], ["L5"]],
    );
  });

  test("every entry is placed, so the five groups partition the leagues", () => {
    const placed = playerBreakdown("chase", FIVE).flatMap((g) =>
      g.rows.map((r) => r.league_id),
    );
    assert.equal(placed.length, FIVE.length);
    assert.equal(new Set(placed).size, FIVE.length);
  });

  test("an empty group is dropped rather than drawn over nothing", () => {
    // Held in every league, so nothing can reach the last three.
    const all = FIVE.map((e) =>
      entry(e.league.league_id, e.league.name, side(null, [["WR1", "chase"]], []), e.opponent),
    );
    assert.deepEqual(keys(all), ["start"]);
  });

  test("the slot is the seat he sat in, and a bench is BN", () => {
    const rows = playerBreakdown("chase", FIVE).flatMap((g) => g.rows);
    assert.deepEqual(
      rows.map((r) => r.slot),
      ["WR1", BENCH_SLOT, "WR2", BENCH_SLOT, null],
    );
  });

  test("a league he is in neither side of has no slot at all, never a dash", () => {
    const [group] = playerBreakdown("chase", [FIVE[4]]);
    assert.equal(group.key, "none");
    assert.equal(group.rows[0].slot, null);
  });

  test("the rival is the opposing manager in every group, the reader's in none", () => {
    const rows = playerBreakdown("chase", FIVE).flatMap((g) => g.rows);
    assert.deepEqual(
      rows.map((r) => r.rival),
      ["Corn Squad", "Big Nickel", "Hail Marys", "Turf Toe", "Play Action"],
    );
  });

  test("an unnamed opposing side leaves the rival null rather than inventing one", () => {
    const [group] = playerBreakdown(
      "chase",
      [entry("L1", "Dynasty Degens", side(null, [["WR1", "chase"]], []), side(null, [], []))],
    );
    assert.equal(group.rows[0].rival, null);
  });

  test("a league with no opposing side falls to `none` rather than to an opposing group", () => {
    // Absent is not empty: nobody who could be asked has him.
    assert.deepEqual(keys([entry("L9", "Solo", side(null, [], []), null)]), ["none"]);
  });

  test("a league with no opposing side still reaches the reader's own groups", () => {
    assert.deepEqual(
      keys([entry("L9", "Solo", side(null, [["WR1", "chase"]], []), null)]),
      ["start"],
    );
  });

  test("the manager's own side is asked first, so one league is claimed once", () => {
    // Sleeper's arrays can name him twice; the sides must not both claim it.
    const both = entry(
      "L1",
      "Dynasty Degens",
      side(null, [["WR1", "chase"]], []),
      side("Corn Squad", [["WR2", "chase"]], []),
    );
    const groups = playerBreakdown("chase", [both]);
    assert.deepEqual(
      groups.map((g) => g.key),
      ["start"],
    );
    assert.equal(groups[0].rows[0].slot, "WR1");
  });

  test("a starting seat beats a bench entry on the same side", () => {
    const twice = entry(
      "L1",
      "Dynasty Degens",
      side(null, [["FLEX", "chase"]], ["chase"]),
      null,
    );
    const groups = playerBreakdown("chase", [twice]);
    assert.deepEqual(groups.map((g) => g.key), ["start"]);
    assert.equal(groups[0].rows[0].slot, "FLEX");
  });

  test("an empty starting slot is not a player, so it claims nobody", () => {
    const empty: WeekLineupEntry = {
      league: league("L1", "Dynasty Degens"),
      mine: { team_name: null, lineup: [{ slot: "WR1", player: null }], bench: [] },
      opponent: null,
      set_by_manager: true,
    };
    assert.deepEqual(keys([empty]), ["none"]);
  });

  test("the league is named by its own name, and by its id where it has none", () => {
    const rows = playerBreakdown("chase", [
      entry("L1", "Dynasty Degens", side(null, [["WR1", "chase"]], []), null),
      entry("L2", "", side(null, [["WR1", "chase"]], []), null),
    ])[0].rows;
    assert.deepEqual(rows.map((r) => r.league), ["Dynasty Degens", "L2"]);
  });

  test("order inside a group is the entry list's, which is the grid's", () => {
    const three = ["L3", "L1", "L2"].map((id) =>
      entry(id, id, side(null, [["WR1", "chase"]], []), null),
    );
    assert.deepEqual(
      playerBreakdown("chase", three)[0].rows.map((r) => r.league_id),
      ["L3", "L1", "L2"],
    );
  });

  test("a player nobody has puts every league in `none`", () => {
    const groups = playerBreakdown("nobody", FIVE);
    assert.deepEqual(groups.map((g) => g.key), ["none"]);
    assert.equal(groups[0].rows.length, 5);
  });

  test("nothing to walk is no groups at all", () => {
    assert.deepEqual(playerBreakdown("chase", []), []);
  });
});

describe("breakdownLeagueCount", () => {
  test("the leagues the walk placed, which is the entries it was handed", () => {
    assert.equal(breakdownLeagueCount(FIVE), 5);
    assert.equal(breakdownLeagueCount([]), 0);
  });
});
