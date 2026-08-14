import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADDED_TIER,
  LADDER_TIERS,
  TIER_WEIGHT,
  benchFields,
  boardLoad,
  ladderRows,
  tierOf,
  weightForTier,
} from "./ladder.ts";
import { defaultWeightBoard } from "./prefs.ts";

import { COMPS_FIELDS, defaultWeightsFor } from "../../shared/comps/fields.ts";

describe("tiers and weights", () => {
  test("the ladder is a view of the 0–100 scale, and round-trips", () => {
    for (let tier = 1; tier <= LADDER_TIERS; tier += 1) {
      assert.equal(tierOf(weightForTier(tier)), tier, `tier ${tier}`);
    }
    assert.deepEqual(
      [1, 2, 3, 4, 5].map(weightForTier),
      [20, 40, 60, 80, 100],
    );
  });

  test("zero is off the board, and nothing positive rounds down to it", () => {
    // A weight a reader set is a field they are comparing on, so the smallest
    // positive weight still shows a notch — rounding 5 to nothing would take a
    // field off the ladder without anybody removing it.
    assert.equal(tierOf(0), 0);
    assert.equal(tierOf(-10), 0);
    assert.equal(tierOf(1), 1);
    assert.equal(tierOf(5), 1);
    assert.equal(tierOf(200), LADDER_TIERS);
  });

  test("a hand-tuned weight shows the notch it rounds to", () => {
    // The board a URL or an older client wrote is displayed, never snapped —
    // only a press writes a multiple of the notch.
    assert.equal(tierOf(85), 4);
    assert.equal(tierOf(70), 4);
    assert.equal(tierOf(30), 2);
  });

  test("every catalogue default lands exactly on a notch", () => {
    // The agreement that makes the ladder free to adopt: no position's opening
    // board is approximated by the notches, so nobody's defaults move the day
    // the control changes. A new default off the ladder would be caught here.
    for (const field of COMPS_FIELDS) {
      for (const [position, weight] of Object.entries(field.defaultWeights)) {
        assert.equal(
          weight % TIER_WEIGHT,
          0,
          `${field.key} defaults ${position} to ${weight}, off the ladder`,
        );
      }
    }
  });

  test("the tier a bin press adds at is a real notch in the middle", () => {
    assert.ok(ADDED_TIER >= 1 && ADDED_TIER <= LADDER_TIERS);
    assert.equal(weightForTier(ADDED_TIER), 60);
  });
});

describe("ladderRows", () => {
  const board = {
    rec_tgt: 100,
    rec_yd: 100,
    rec: 80,
    rec_td: 60,
    age: 60,
    snap_pct: 45,
    tgt_per_snap: 25,
    fum_lost: 0,
  };

  test("heaviest first, and ties keep catalogue order", () => {
    // Two fields at one tier weigh the same in the distance, so any order
    // between them would be the list inventing a distinction. Catalogue order
    // is the stable fallback — the same board renders the same way twice.
    const keys = ladderRows(board).map((row) => row.field.key);
    assert.deepEqual(keys, [
      "rec_tgt",
      "rec_yd",
      "rec",
      "rec_td",
      "age",
      "snap_pct",
      "tgt_per_snap",
    ]);
    // rec_tgt precedes rec_yd in the catalogue and both weigh 100.
    const order = COMPS_FIELDS.map((f) => f.key);
    assert.ok(order.indexOf("rec_tgt") < order.indexOf("rec_yd"));
  });

  test("a zero-weight field is not a row", () => {
    assert.ok(!ladderRows(board).some((row) => row.field.key === "fum_lost"));
    assert.ok(benchFields(board).some((field) => field.key === "fum_lost"));
  });

  test("the shares sum to one and are read off the true weights", () => {
    const rows = ladderRows(board);
    const total = rows.reduce((sum, row) => sum + row.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    // 45 of 470 — the stored weight, not the notch's 40, so the row and the
    // mix strip above it describe the same board.
    const snap = rows.find((row) => row.field.key === "snap_pct")!;
    assert.equal(snap.weight, 45);
    assert.equal(snap.tier, 2);
    assert.ok(Math.abs(snap.share - 45 / 470) < 1e-9);
  });

  test("an empty board is an empty ladder, not a division by zero", () => {
    assert.deepEqual(ladderRows({}), []);
    assert.equal(boardLoad({}), 0);
    assert.equal(benchFields({}).length, COMPS_FIELDS.length);
  });

  test("the ladder and the bin partition the catalogue exactly", () => {
    // Every field is in the comparison or available to add, never both and
    // never neither — a field that fell out of both would be unreachable.
    for (const weights of [board, {}, defaultWeightBoard("QB")]) {
      const inBoard = ladderRows(weights).map((row) => row.field.key);
      const inBin = benchFields(weights).map((field) => field.key);
      assert.equal(inBoard.length + inBin.length, COMPS_FIELDS.length);
      assert.equal(new Set([...inBoard, ...inBin]).size, COMPS_FIELDS.length);
    }
  });

  test("a position's opening board is a ladder of its own defaults", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const rows = ladderRows(defaultWeightBoard(position));
      assert.deepEqual(
        new Set(rows.map((row) => row.field.key)),
        new Set(defaultWeightsFor(position).map((d) => d.key)),
        position,
      );
      // Descending, which is what makes the first row the board's subject.
      for (let i = 1; i < rows.length; i += 1) {
        assert.ok(rows[i - 1].weight >= rows[i].weight, `${position} order`);
      }
    }
  });
});
