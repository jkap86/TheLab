import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMP_POSITIONS,
  CRITERIA,
  POSITION_CRITERIA,
  POSITION_PRESETS,
  criterionAppliesTo,
  defaultCriteriaFor,
  isCompPosition,
  isWindowed,
} from "./criteria.ts";
import type { CompCriterion } from "./criteria.ts";

const on = (list: readonly CompCriterion[]) => list.filter((c) => c.on).map((c) => c.id);
const find = (list: readonly CompCriterion[], id: string) => list.find((c) => c.id === id)!;

/**
 * The presets are what stop a running back being compared on a receiver's
 * criteria, and a quarterback on columns that are zero for every one of them.
 * Each rule below renders a perfectly ordinary panel when it is wrong.
 */
describe("position presets", () => {
  test("every supported position has a preset and an applicability list", () => {
    for (const position of COMP_POSITIONS) {
      assert.ok(POSITION_PRESETS[position], position);
      assert.ok(POSITION_CRITERIA[position].length > 0, position);
    }
  });

  test("a preset never switches on a criterion its own position hides", () => {
    for (const position of COMP_POSITIONS) {
      for (const id of Object.keys(POSITION_PRESETS[position])) {
        assert.ok(
          criterionAppliesTo(id as never, position),
          `${position} presets ${id} but does not offer it`,
        );
      }
    }
  });

  test("every preset names criteria and windows the vocabulary knows", () => {
    const ids = new Set(CRITERIA.map((c) => c.id));
    for (const position of COMP_POSITIONS) {
      for (const [id, wins] of Object.entries(POSITION_PRESETS[position])) {
        assert.ok(ids.has(id as never), `${position}: unknown criterion ${id}`);
        const criterion = CRITERIA.find((c) => c.id === id)!;
        assert.ok(wins!.length > 0, `${position}: ${id} has no window`);
        if (!isWindowed(criterion)) {
          // A windowless criterion's one "window" is the row's own season.
          assert.deepEqual(wins!.map((w) => w.id), ["last"], `${position}: ${id}`);
        }
      }
    }
  });

  test("WR is the vocabulary's own default state, so the two cannot drift", () => {
    const wr = defaultCriteriaFor("WR");
    assert.deepEqual(
      wr.map((c) => ({ id: c.id, on: c.on, wins: c.wins })),
      CRITERIA.map((c) => ({ id: c.id, on: c.on, wins: c.wins })),
    );
  });

  test("TE is receiving-centric and weighs target share above a receiver's", () => {
    const te = defaultCriteriaFor("TE");
    assert.deepEqual(on(te).sort(), ["age", "draft", "exp", "ppg", "recyd", "snap", "tgtsh", "yprr"]);
    assert.ok(
      find(te, "tgtsh").wins[0].w > find(defaultCriteriaFor("WR"), "tgtsh").wins[0].w,
    );
  });

  test("RB carries real rushing weight and does not lead on receiving", () => {
    const rb = defaultCriteriaFor("RB");
    const rush = find(rb, "rush");
    assert.equal(rush.on, true, "a back is not comped without his rushing");
    const rushWeight = rush.wins.reduce((sum, w) => sum + w.w, 0);

    // The two receiver-shaped criteria must not outweigh the rushing ones.
    for (const id of ["tgtsh", "yprr"]) {
      const criterion = find(rb, id);
      const weight = criterion.on ? criterion.wins.reduce((sum, w) => sum + w.w, 0) : 0;
      assert.ok(weight < rushWeight, `${id} outweighs rushing for an RB`);
    }
    // And YPRR specifically sits below what a receiver gives it.
    assert.ok(
      find(rb, "yprr").wins[0].w < find(defaultCriteriaFor("WR"), "yprr").wins[0].w,
    );
  });

  test("QB is offered, and never on a receiving criterion", () => {
    assert.ok(isCompPosition("QB"));
    const qb = defaultCriteriaFor("QB");
    for (const id of ["recyd", "tgtsh", "yprr"]) {
      assert.equal(criterionAppliesTo(id as never, "QB"), false, id);
      assert.equal(find(qb, id).on, false, `${id} is on for a QB`);
    }
    // What is left is what his columns can answer.
    assert.deepEqual(on(qb).sort(), ["age", "draft", "exp", "gp", "ppg", "pts", "rush"]);
  });

  test("a position this feature does not comp is not one", () => {
    for (const position of ["K", "DEF", "OL", "", "wr"]) {
      assert.equal(isCompPosition(position), false, position);
    }
    // And an unrecognised position hides nothing, so a corpus that somehow
    // holds one still renders rather than showing an empty panel.
    assert.equal(criterionAppliesTo("tgtsh", "K"), true);
  });

  test("no position, no preset: the vocabulary's defaults, as before a subject is picked", () => {
    assert.deepEqual(
      defaultCriteriaFor(null).map((c) => [c.id, c.on]),
      CRITERIA.map((c) => [c.id, c.on]),
    );
  });

  test("every table is a fresh copy, so one page's edits cannot leak into another's", () => {
    const a = defaultCriteriaFor("RB");
    const b = defaultCriteriaFor("RB");
    assert.notEqual(a[0], b[0]);
    assert.notEqual(a[0].wins, b[0].wins);
    assert.notEqual(a[0].wins[0], b[0].wins[0]);
  });

  test("a preset always leaves at least one criterion on", () => {
    // An empty table is a page that cannot run a comp and says only "no
    // criteria on", with no way for a reader to know it was handed that.
    for (const position of COMP_POSITIONS) {
      assert.ok(on(defaultCriteriaFor(position)).length > 0, position);
    }
  });
});
