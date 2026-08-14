import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_PREFS_VERSION,
  DEFAULT_COMPS_PREFS,
  defaultWeightBoard,
  isCustomized,
  parseCompsPrefs,
  resetPosition,
  serializeCompsPrefs,
  setPositionWeights,
  weightsFor,
} from "./prefs.ts";

describe("parseCompsPrefs", () => {
  test("null, junk and a stale version all read as defaults", () => {
    assert.deepEqual(parseCompsPrefs(null), DEFAULT_COMPS_PREFS);
    assert.deepEqual(parseCompsPrefs("not json"), DEFAULT_COMPS_PREFS);
    assert.deepEqual(parseCompsPrefs("[1,2]"), DEFAULT_COMPS_PREFS);
    assert.deepEqual(
      parseCompsPrefs(JSON.stringify({ v: 99, basis: "total" })),
      DEFAULT_COMPS_PREFS,
    );
  });

  test("a round trip survives", () => {
    const prefs = setPositionWeights(
      { ...DEFAULT_COMPS_PREFS, basis: "total" },
      "WR",
      { ...defaultWeightBoard("WR"), rec: 0, ktc_sf: 40 },
    );
    const back = parseCompsPrefs(serializeCompsPrefs(prefs));
    assert.equal(back.basis, "total");
    assert.equal(weightsFor(back, "WR").ktc_sf, 40);
    assert.equal(weightsFor(back, "WR").rec, 0);
  });

  test("unknown positions, unknown fields and junk weights fall away alone", () => {
    const raw = JSON.stringify({
      v: COMPS_PREFS_VERSION,
      basis: "per_game",
      weightsByPosition: {
        WR: { rec: 80, off_snp: 50, rec_yd: "lots", rec_tgt: 101 },
        K: { fgm: 100 },
      },
    });
    const prefs = parseCompsPrefs(raw);
    // The one good key survives; nothing else resets it.
    assert.equal(prefs.weightsByPosition.WR?.rec, 80);
    assert.equal(prefs.weightsByPosition.WR?.off_snp, undefined);
    assert.equal(prefs.weightsByPosition.WR?.rec_yd, undefined);
    assert.equal(prefs.weightsByPosition.WR?.rec_tgt, undefined);
    assert.equal("K" in prefs.weightsByPosition, false);
  });
});

describe("weightsFor / per-position boards", () => {
  test("an untouched position opens on the catalogue's defaults", () => {
    assert.deepEqual(
      weightsFor(DEFAULT_COMPS_PREFS, "RB"),
      defaultWeightBoard("RB"),
    );
    assert.equal(isCustomized(DEFAULT_COMPS_PREFS, "RB"), false);
  });

  test("a WR-tuned board never follows the reader onto a QB subject", () => {
    const prefs = setPositionWeights(DEFAULT_COMPS_PREFS, "WR", {
      ...defaultWeightBoard("WR"),
      ktc_sf: 100,
    });
    assert.equal(weightsFor(prefs, "WR").ktc_sf, 100);
    assert.deepEqual(weightsFor(prefs, "QB"), defaultWeightBoard("QB"));
  });

  test("a stored board is re-laid onto the catalogue on read", () => {
    // A field the stored board never mentions reads as 0, so a catalogue
    // field added after the write appears switched off rather than undefined.
    const prefs = setPositionWeights(DEFAULT_COMPS_PREFS, "TE", { rec: 50 });
    const board = weightsFor(prefs, "TE");
    assert.equal(board.rec, 50);
    assert.equal(board.rec_yd, 0);
  });

  test("reset clears the entry rather than writing today's defaults", () => {
    const customized = setPositionWeights(DEFAULT_COMPS_PREFS, "WR", {
      rec: 10,
    });
    const reset = resetPosition(customized, "WR");
    assert.equal(isCustomized(reset, "WR"), false);
    assert.equal("WR" in reset.weightsByPosition, false);
    assert.deepEqual(weightsFor(reset, "WR"), defaultWeightBoard("WR"));
  });

  test("market fields default to 0 on every position's opening board", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const board = defaultWeightBoard(position);
      assert.equal(board.ktc_sf, 0);
      assert.equal(board.ktc_oneqb, 0);
      assert.equal(board.adp_dynasty, 0);
      assert.equal(board.adp_redraft, 0);
    }
  });
});
