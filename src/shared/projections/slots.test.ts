import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFENSIVE_SLOTS,
  IDP_SLOTS,
  NON_STARTING_SLOTS,
  SLOT_POSITIONS,
} from "./slots.ts";

/**
 * The lineup-slot vocabulary, which both sides of the wire read.
 *
 * The two derived sets are what is actually worth testing: they are derived
 * rather than listed so that a new IDP slot joins them the moment the solver
 * learns it, and the failure mode of getting that wrong is silent — a slot
 * missing from `DEFENSIVE_SLOTS` silences the "projections read low" caveat for
 * exactly the leagues that need it. So these assert the *derivation rule* over
 * whatever `SLOT_POSITIONS` holds, plus the memberships that would be wrong
 * whatever else changed.
 */

const DEFENSIVE_POSITIONS = new Set(["DEF", "DL", "LB", "DB"]);
const IDP_POSITIONS = new Set(["DL", "LB", "DB"]);

describe("SLOT_POSITIONS", () => {
  test("every slot takes at least one position", () => {
    for (const [slot, positions] of Object.entries(SLOT_POSITIONS)) {
      assert.ok(positions.length > 0, `${slot} fills with nobody`);
    }
  });

  test("the flexes overlap without nesting, which is why the solve isn't a sort", () => {
    // `WRRB_FLEX` takes RB/WR and `REC_FLEX` takes WR/TE — neither contains the
    // other, and leagues here run both. Filling slots one at a time, even
    // most-constrained first, picks the wrong lineup.
    const wrrb = new Set(SLOT_POSITIONS.WRRB_FLEX);
    const rec = new Set(SLOT_POSITIONS.REC_FLEX);
    assert.ok([...wrrb].some((p) => rec.has(p)), "they overlap");
    assert.ok([...wrrb].some((p) => !rec.has(p)), "and neither contains the other");
    assert.ok([...rec].some((p) => !wrrb.has(p)));
  });

  test("a bench slot is not a lineup slot", () => {
    // The two vocabularies are disjoint on purpose: `roster_positions` mixes
    // them, and a slot appearing in both would be filled by the solver.
    for (const slot of NON_STARTING_SLOTS) {
      assert.ok(!(slot in SLOT_POSITIONS), `${slot} would be filled by the solver`);
    }
  });
});

describe("DEFENSIVE_SLOTS", () => {
  test("holds exactly the slots only defensive players can fill", () => {
    // The derivation rule, asserted over the table rather than against a written
    // list — a new IDP slot has to land here the moment the solver learns it.
    for (const [slot, positions] of Object.entries(SLOT_POSITIONS)) {
      const allDefensive = positions.every((p) => DEFENSIVE_POSITIONS.has(p));
      assert.equal(
        DEFENSIVE_SLOTS.has(slot),
        allDefensive,
        `${slot} is on the wrong side of the defensive line`,
      );
    }
  });

  test("the team unit and the individual defenders are all in it", () => {
    for (const slot of ["DEF", "DL", "LB", "DB", "IDP_FLEX"]) {
      assert.ok(DEFENSIVE_SLOTS.has(slot), `${slot} should be defensive`);
    }
  });

  test("a slot that can take an offensive player is not defensive", () => {
    // `SUPER_FLEX` takes a QB, so it can never qualify however the table grows.
    for (const slot of ["QB", "RB", "WR", "TE", "K", "FLEX", "SUPER_FLEX", "REC_FLEX"]) {
      assert.ok(!DEFENSIVE_SLOTS.has(slot), `${slot} should not be defensive`);
    }
  });
});

describe("IDP_SLOTS", () => {
  test("is the defensive slots without the team unit", () => {
    // Not interchangeable with `DEFENSIVE_SLOTS`, and the split is the point:
    // nearly every league starts a team defence, so that set barely
    // distinguishes leagues, while starting a linebacker makes it another game.
    assert.ok(DEFENSIVE_SLOTS.has("DEF"));
    assert.ok(!IDP_SLOTS.has("DEF"));
    for (const slot of IDP_SLOTS) {
      assert.ok(DEFENSIVE_SLOTS.has(slot), `${slot} is IDP but not defensive`);
    }
    assert.equal(IDP_SLOTS.size, DEFENSIVE_SLOTS.size - 1);
  });

  test("holds exactly the slots only individual defenders can fill", () => {
    for (const [slot, positions] of Object.entries(SLOT_POSITIONS)) {
      assert.equal(
        IDP_SLOTS.has(slot),
        positions.every((p) => IDP_POSITIONS.has(p)),
        `${slot} is on the wrong side of the IDP line`,
      );
    }
  });

  test("the two sets are separate objects, so neither can mutate the other", () => {
    assert.notEqual(IDP_SLOTS, DEFENSIVE_SLOTS);
  });
});
