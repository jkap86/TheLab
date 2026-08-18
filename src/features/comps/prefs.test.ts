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
  setPositionWindows,
  weightsFor,
  windowsFor,
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
        WR: { rec: 80, kick_ret_yd: 50, rec_yd: "lots", rec_tgt: 101 },
        K: { fgm: 100 },
      },
    });
    const prefs = parseCompsPrefs(raw);
    // The one good key survives; nothing else resets it.
    assert.equal(prefs.weightsByPosition.WR?.rec, 80);
    assert.equal(prefs.weightsByPosition.WR?.kick_ret_yd, undefined);
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

  test("reset clears both halves — one key on screen means one reset", () => {
    const customized = setPositionWindows(
      setPositionWeights(DEFAULT_COMPS_PREFS, "WR", { rec: 10 }),
      "WR",
      { rec_tgt: "prev3" },
    );
    const reset = resetPosition(customized, "WR");
    assert.equal(isCustomized(reset, "WR"), false);
    assert.equal("WR" in reset.windowsByPosition, false);
    assert.deepEqual(windowsFor(reset, "WR").rec_tgt, "season");
  });

  test("a weight put back where it started leaves nothing behind", () => {
    // The asymmetry this closes: a window restored to its default was dropped
    // from the stored prefs, where a weight restored to its default was kept —
    // so a reader who moved a slider and moved it back had a board that was the
    // catalogue's in every number and "customized" in the only place the UI
    // looks. What they saw for it was a lit Customize key over an untouched
    // board and a Reset that changed nothing.
    const defaults = defaultWeightBoard("WR");
    const moved = setPositionWeights(DEFAULT_COMPS_PREFS, "WR", {
      ...defaults,
      rec_tgt: 20,
    });
    assert.equal(isCustomized(moved, "WR"), true);

    const restored = setPositionWeights(moved, "WR", { ...defaults });
    assert.equal(isCustomized(restored, "WR"), false);
    assert.equal("WR" in restored.weightsByPosition, false);
    assert.deepEqual(weightsFor(restored, "WR"), defaults);
  });

  test("a board naming only its live fields is the same board as one spelling every zero", () => {
    // `weightsFor` reads an absent key as 0 on the way out, so the two spell one
    // board — and the comparison has to agree, or which of them was written
    // decides whether the reader is "customized".
    const sparse = Object.fromEntries(
      Object.entries(defaultWeightBoard("TE")).filter(([, weight]) => weight > 0),
    );
    const prefs = setPositionWeights(DEFAULT_COMPS_PREFS, "TE", sparse);
    assert.equal(isCustomized(prefs, "TE"), false);
  });

  test("restoring one weight while another is moved stays customized", () => {
    // The bound on the rule: normalization is about the *board*, not about the
    // last press, so putting one slider back does not throw away the rest.
    const defaults = defaultWeightBoard("WR");
    const two = setPositionWeights(DEFAULT_COMPS_PREFS, "WR", {
      ...defaults,
      rec_tgt: 20,
      ktc_sf: 60,
    });
    const one = setPositionWeights(two, "WR", { ...defaults, ktc_sf: 60 });
    assert.equal(isCustomized(one, "WR"), true);
    assert.equal(weightsFor(one, "WR").ktc_sf, 60);
    assert.equal(weightsFor(one, "WR").rec_tgt, defaults.rec_tgt);
  });

  test("a default board restored by hand still carries its windows", () => {
    // The two halves are independent: weights back at the defaults with a
    // window still moved is a customized board, and dropping the weights entry
    // must not take the windows with it. Only Reset clears both.
    const defaults = defaultWeightBoard("WR");
    const prefs = setPositionWindows(
      setPositionWeights(DEFAULT_COMPS_PREFS, "WR", {
        ...defaults,
        rec_tgt: 20,
      }),
      "WR",
      { rec_tgt: "prev3" },
    );
    const restored = setPositionWeights(prefs, "WR", { ...defaults });
    assert.equal("WR" in restored.weightsByPosition, false);
    assert.equal(isCustomized(restored, "WR"), true);
    assert.equal(windowsFor(restored, "WR").rec_tgt, "prev3");
  });

  test("a stored board that is the defaults reads as untouched", () => {
    // The same normalization on the way in, because a blob written by a build
    // that stored default weights is still in readers' browsers — and a board
    // is not customized on the strength of which build wrote it.
    const raw = JSON.stringify({
      v: COMPS_PREFS_VERSION,
      basis: "per_game",
      weightsByPosition: { WR: defaultWeightBoard("WR") },
      windowsByPosition: {},
    });
    const prefs = parseCompsPrefs(raw);
    assert.equal(isCustomized(prefs, "WR"), false);
    assert.deepEqual(weightsFor(prefs, "WR"), defaultWeightBoard("WR"));
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

describe("windowsFor / per-position windows", () => {
  test("an untouched position reads every field over its own season", () => {
    const board = windowsFor(DEFAULT_COMPS_PREFS, "WR");
    assert.ok(Object.keys(board).length > 0);
    assert.ok(Object.values(board).every((window) => window === "season"));
    // Only the fields that take one are on the board at all — an age has no
    // window, so a row for it would be a control the editor must not draw.
    assert.equal("age" in board, false);
    assert.equal("ktc_sf" in board, false);
  });

  test("only what the reader moved is stored — absent *is* the default", () => {
    // One spelling of "default", which is what keeps `isCustomized` honest: a
    // board whose windows are all `season` is not a customized board.
    const moved = setPositionWindows(DEFAULT_COMPS_PREFS, "WR", {
      rec_tgt: "prev3",
      rec_yd: "season",
    });
    assert.deepEqual(moved.windowsByPosition.WR, { rec_tgt: "prev3" });
    assert.equal(isCustomized(moved, "WR"), true);

    const back = setPositionWindows(moved, "WR", { rec_tgt: "season" });
    assert.equal("WR" in back.windowsByPosition, false);
    assert.equal(isCustomized(back, "WR"), false);
  });

  test("a WR window never follows the reader onto a QB subject", () => {
    const prefs = setPositionWindows(DEFAULT_COMPS_PREFS, "WR", {
      rec_tgt: "career_best",
    });
    assert.equal(windowsFor(prefs, "WR").rec_tgt, "career_best");
    assert.equal(windowsFor(prefs, "QB").rec_tgt, "season");
  });

  test("a stored blob survives the build that wrote it", () => {
    // The codec's own rule, applied to the second map: a window this build
    // doesn't know, a field it dropped, or a field that stopped taking a
    // window all fall away on their own rather than resetting the board.
    const raw = JSON.stringify({
      v: COMPS_PREFS_VERSION,
      basis: "per_game",
      windowsByPosition: {
        WR: {
          rec_tgt: "prev2",
          rec_yd: "last_year",
          kick_ret_yd: "prev3",
          age: "career_best",
        },
        K: { rec: "prev1" },
      },
    });
    const prefs = parseCompsPrefs(raw);
    assert.deepEqual(prefs.windowsByPosition.WR, { rec_tgt: "prev2" });
    assert.equal("K" in prefs.windowsByPosition, false);
  });

  test("windows round-trip through the codec", () => {
    const prefs = setPositionWindows(DEFAULT_COMPS_PREFS, "TE", {
      snap_pct: "prev3_best",
    });
    const back = parseCompsPrefs(serializeCompsPrefs(prefs));
    assert.equal(windowsFor(back, "TE").snap_pct, "prev3_best");
  });
});
