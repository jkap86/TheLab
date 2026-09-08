import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LineupSlot } from "../contract/lineups.ts";
import {
  isStartingSlot,
  STARTING_SLOTS,
  startingSlotsOf,
} from "./starting-slots.ts";
import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "./slots.ts";

/**
 * The slot axis against the solver's own table.
 *
 * `positions.test.ts`' seam one axis over, and it carries more weight here
 * because the list is *written* rather than derived — see the module note on
 * why the table's declaration order is the wrong reading order for a track.
 * What the derivation would have given for free, these assertions have to buy:
 * a slot the solver learns and this list does not is a seat a reader can never
 * narrow to, and one named here that the solver cannot fill is a narrowing that
 * counts nobody. Both render a perfectly ordinary panel.
 */

/**
 * The union, written out — spelled here for {@link LineupSlot}'s own reason: the
 * `Record` is exhaustive, so a slot added to the contract does not compile until
 * it is listed, and the assertions below are then what say whether the solver
 * and the ordered list agree.
 */
const DECLARED: Record<LineupSlot, true> = {
  QB: true,
  RB: true,
  WR: true,
  TE: true,
  FLEX: true,
  WRRB_FLEX: true,
  REC_FLEX: true,
  SUPER_FLEX: true,
  K: true,
  DEF: true,
  DL: true,
  LB: true,
  DB: true,
  IDP_FLEX: true,
};

describe("STARTING_SLOTS", () => {
  test("is a permutation of the solver's own table", () => {
    // Both directions at once: a key the solver has and this does not, and one
    // this has that the solver cannot fill.
    assert.deepEqual(
      [...STARTING_SLOTS].sort(),
      Object.keys(SLOT_POSITIONS).sort(),
    );
  });

  test("names exactly the union the contract declares", () => {
    assert.deepEqual([...STARTING_SLOTS].sort(), Object.keys(DECLARED).sort());
  });

  test("reads in three runs: the bare seats, the flexes, then the units", () => {
    // The order the two milled cuts in the picker's track fall between, and the
    // one thing here a derivation could not have given — see the module note.
    assert.deepEqual(
      [...STARTING_SLOTS],
      [
        "QB",
        "RB",
        "WR",
        "TE",
        "FLEX",
        "WRRB_FLEX",
        "REC_FLEX",
        "SUPER_FLEX",
        "K",
        "DEF",
        "DL",
        "LB",
        "DB",
        "IDP_FLEX",
      ],
    );
  });

  test("holds no slot that holds players without starting them", () => {
    for (const slot of STARTING_SLOTS) {
      assert.equal(NON_STARTING_SLOTS.has(slot), false, `${slot} is a bench`);
    }
  });

  test("nothing outside the table reads as a slot", () => {
    assert.equal(isStartingSlot("SUPER_FLEX"), true);
    assert.equal(isStartingSlot("super_flex"), false);
    assert.equal(isStartingSlot("BN"), false);
    assert.equal(isStartingSlot("OP"), false);
    assert.equal(isStartingSlot(""), false);
  });
});

describe("startingSlotsOf", () => {
  test("is the union of the leagues in hand, in canonical order", () => {
    assert.deepEqual(
      startingSlotsOf([
        ["SUPER_FLEX", "RB", "BN"],
        ["QB", "RB", "FLEX", "BN"],
      ]),
      ["QB", "RB", "FLEX", "SUPER_FLEX"],
    );
  });

  test("drops the slots that hold players without starting them", () => {
    // A bench seat is not a seat a column can be narrowed to.
    assert.deepEqual(startingSlotsOf([["QB", "BN", "IR", "TAXI"]]), ["QB"]);
  });

  test("drops a slot the solver cannot fill, and Sleeper's own padding", () => {
    // `recognisedSlots` drops the same ones into `unknown_slots`: a slot with no
    // entry in the table seats nobody, so narrowing to it counts nobody.
    assert.deepEqual(startingSlotsOf([["QB", "OP", "", "0"]]), ["QB"]);
  });

  test("a league with no lineup on file contributes nothing", () => {
    // `roster_positions` is nullable for exactly that row, and an unsynced
    // league must not be read as a league that starts no seats.
    assert.deepEqual(startingSlotsOf([null, ["QB"]]), ["QB"]);
    assert.deepEqual(startingSlotsOf([null]), []);
    assert.deepEqual(startingSlotsOf([]), []);
  });

  test("a slot repeated across leagues is offered once", () => {
    assert.deepEqual(startingSlotsOf([["WR", "WR"], ["WR"]]), ["WR"]);
  });
});
