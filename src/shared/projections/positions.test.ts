import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupPosition } from "../contract/lineups.ts";
import { FANTASY_POSITIONS, isFantasyPosition, playsPosition } from "./positions.ts";
import { SLOT_POSITIONS } from "./slots.ts";

/**
 * The position axis against the solver's own table.
 *
 * This is the seam the contract's {@link LineupPosition} union is checked at,
 * and it is the one nothing else can check: a position the solver learns and
 * this union does not is a column a reader can never ask for, and one named in
 * the union that no slot admits is a narrowing that can never seat anybody —
 * both of which render a perfectly ordinary panel.
 */

/**
 * The union, written out. It has to be spelled somewhere for a test to compare
 * against, and spelling it *here* is the point: the `Record` is exhaustive, so
 * a position added to the contract does not compile until it is listed, and the
 * assertion below is then what says whether the solver agrees.
 */
const DECLARED: Record<LineupPosition, true> = {
  QB: true,
  RB: true,
  WR: true,
  TE: true,
  K: true,
  DEF: true,
  DL: true,
  LB: true,
  DB: true,
};

describe("FANTASY_POSITIONS", () => {
  test("names exactly the positions some starting slot admits", () => {
    assert.deepEqual(
      [...FANTASY_POSITIONS].sort(),
      Object.keys(DECLARED).sort(),
    );
  });

  test("is the solver's table walked in its own declaration order", () => {
    // Offence by depth, then the kicker and the team unit, then the two
    // individual-defender families — which is how the keys are laid out on
    // screen. A flex contributes nothing new by construction.
    assert.deepEqual(
      [...FANTASY_POSITIONS],
      ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"],
    );
  });

  test("every position is admitted by at least one slot", () => {
    for (const position of FANTASY_POSITIONS) {
      assert.ok(
        Object.values(SLOT_POSITIONS).some((admits) =>
          admits.includes(position),
        ),
        `${position} is offerable but no slot seats it`,
      );
    }
  });

  test("nothing outside the table reads as a position", () => {
    assert.equal(isFantasyPosition("QB"), true);
    assert.equal(isFantasyPosition("qb"), false);
    assert.equal(isFantasyPosition("FLEX"), false);
    assert.equal(isFantasyPosition("PUNTER"), false);
  });
});

describe("playsPosition", () => {
  test("matches on any of the player's positions, not the first", () => {
    // Sleeper lists two for the players this matters most for: a tight end it
    // also files at receiver belongs to a TE narrowing and a WR one alike.
    assert.equal(playsPosition(["TE", "WR"], ["WR"]), true);
    assert.equal(playsPosition(["TE", "WR"], ["TE"]), true);
    assert.equal(playsPosition(["TE", "WR"], ["QB"]), false);
  });

  test("a player the feed knows nothing about belongs to no narrowing", () => {
    // Guessing is how a roster's total quietly gains a player nobody asked for.
    assert.equal(playsPosition([], ["QB"]), false);
  });
});
