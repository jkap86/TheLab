import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_FIELDS,
  COMPS_POSITIONS,
  compsField,
  compsFieldTakesWindow,
  defaultWeightsFor,
  isCompsPosition,
} from "./fields.ts";

/**
 * The catalogue is data both ends of the wire trust, so what these tests pin is
 * its internal agreements — the claims no type can carry.
 */

describe("COMPS_FIELDS", () => {
  test("keys are unique — a duplicate would make fields= ambiguous", () => {
    const keys = COMPS_FIELDS.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("a statKey is present exactly on the line-read production fields", () => {
    // A derived field is computed at assembly, so a statKey on one would be a
    // key nothing reads — and a non-derived production field without one would
    // assemble as a column of zeroes.
    for (const field of COMPS_FIELDS) {
      assert.equal(
        field.statKey !== undefined,
        field.family === "production" && field.derived !== true,
        `${field.key}: statKey and family disagree`,
      );
    }
  });

  test("perGame is true exactly for line-read production — a share is already a rate", () => {
    for (const field of COMPS_FIELDS) {
      assert.equal(
        field.perGame,
        field.family === "production" && field.derived !== true,
        `${field.key}: perGame and family disagree`,
      );
    }
  });

  test("gated marks unverified line-read production keys, never defaulted", () => {
    // Gated values are nullable (a season whose feed lacks the key), so the
    // no-default rule applies; and gated-plus-derived would be contradictory —
    // derived fields aren't read off a line at all.
    for (const field of COMPS_FIELDS) {
      if (field.gated !== true) continue;
      assert.equal(field.family, "production", `${field.key} gated family`);
      assert.equal(field.derived, undefined, `${field.key} gated and derived`);
      assert.notEqual(field.statKey, undefined, `${field.key} gated statKey`);
      assert.deepEqual(field.defaultWeights, {}, `${field.key} defaults`);
    }
    assert.deepEqual(
      COMPS_FIELDS.filter((f) => f.gated === true).map((f) => f.key),
      ["pass_air_yd", "rec_air_yd", "off_snp"],
    );
  });

  test("derived appears only on production fields, and never with a default", () => {
    // Derived values are nullable (a season whose feed lacks the inputs), so a
    // default weight would silently exclude those seasons from every first
    // board — the market fields' own rule.
    for (const field of COMPS_FIELDS) {
      if (field.derived !== true) continue;
      assert.equal(field.family, "production", `${field.key} derived family`);
      assert.deepEqual(field.defaultWeights, {}, `${field.key} defaults`);
    }
    assert.deepEqual(
      COMPS_FIELDS.filter((f) => f.derived === true).map((f) => f.key),
      ["rush_share", "tgt_share", "snap_pct", "tgt_per_snap"],
    );
  });

  test("`requires` names raw stat keys and appears only on derived fields", () => {
    // The gate a derived field is nullable through: it is a claim about the
    // *feed*, so it names stat keys and never catalogue keys — `tm_off_snp` is
    // a denominator no field is named after, which is exactly why the two
    // vocabularies must not be confused.
    const derivedKeys = new Set(
      COMPS_FIELDS.filter((f) => f.derived === true).map((f) => f.key),
    );
    for (const field of COMPS_FIELDS) {
      if (field.requires === undefined) continue;
      assert.equal(field.derived, true, `${field.key} requires without derived`);
      assert.ok(field.requires.length > 0, `${field.key} requires nothing`);
      for (const required of field.requires) {
        // A derived field is read off no line, so requiring one would be a
        // gate on a key the feed can never carry — permanently null.
        assert.ok(
          !derivedKeys.has(required),
          `${field.key} requires the derived ${required}`,
        );
      }
    }
    assert.deepEqual(
      COMPS_FIELDS.filter((f) => f.requires !== undefined).map((f) => f.key),
      ["snap_pct", "tgt_per_snap"],
    );
  });

  test("a window applies to production and to nothing else", () => {
    // Pooling is additive, which is what a count or a usage rate *is* and what
    // a price and an age are not — two seasons of KTC pool into nothing
    // anybody has a name for.
    for (const field of COMPS_FIELDS) {
      assert.equal(
        compsFieldTakesWindow(field),
        field.family === "production",
        `${field.key} takes a window`,
      );
    }
  });

  test("every default weight is positive and within 0–100", () => {
    // Zero is expressed by absence: an explicit zero entry would read as a
    // default while defaulting nothing.
    for (const field of COMPS_FIELDS) {
      for (const [position, weight] of Object.entries(field.defaultWeights)) {
        assert.ok(
          weight > 0 && weight <= 100,
          `${field.key} defaults ${position} to ${weight}`,
        );
      }
    }
  });

  test("default weights name only supported positions", () => {
    for (const field of COMPS_FIELDS) {
      for (const position of Object.keys(field.defaultWeights)) {
        assert.ok(
          isCompsPosition(position),
          `${field.key} defaults unknown position ${position}`,
        );
      }
    }
  });

  test("no market field carries a default — weighting one excludes unpriced players", () => {
    for (const field of COMPS_FIELDS) {
      if (field.family !== "market") continue;
      assert.deepEqual(
        field.defaultWeights,
        {},
        `${field.key} defaults a market weight`,
      );
    }
  });

  test("the career fields carry no default — a rookie season answers null", () => {
    // Same argument as the market rule one test up: a defaulted nullable field
    // silently excludes every season that can't answer it, and every player's
    // first stored season can't.
    for (const key of ["career_ppg", "prev3_ppg"]) {
      assert.deepEqual(compsField(key)?.defaultWeights, {}, key);
    }
  });
});

describe("defaultWeightsFor", () => {
  test("every supported position gets a usable default board", () => {
    // A position whose defaults produce no board would turn the tool's first
    // answer into a 400.
    for (const position of COMPS_POSITIONS) {
      const defaults = defaultWeightsFor(position);
      assert.ok(
        defaults.some(
          (d) => compsField(d.key)?.family === "production" && d.weight > 0,
        ),
        `${position} defaults no production field`,
      );
      assert.ok(
        defaults.some((d) => d.key === "age"),
        `${position} defaults omit age`,
      );
    }
  });

  test("returns catalogue order with only the positive entries", () => {
    const defaults = defaultWeightsFor("QB");
    const catalogueOrder = COMPS_FIELDS.map((f) => f.key).filter((key) =>
      defaults.some((d) => d.key === key),
    );
    assert.deepEqual(
      defaults.map((d) => d.key),
      catalogueOrder,
    );
    for (const d of defaults) assert.ok(d.weight > 0);
  });

  test("a per-position default really varies by position", () => {
    // rush_yd is the field the map shape exists for: 100 for a back, 60 for a
    // quarterback — one (weight, positions) pair could not spell that.
    const rb = defaultWeightsFor("RB").find((d) => d.key === "rush_yd");
    const qb = defaultWeightsFor("QB").find((d) => d.key === "rush_yd");
    assert.equal(rb?.weight, 100);
    assert.equal(qb?.weight, 60);
  });
});

describe("compsField / isCompsPosition", () => {
  test("resolves a catalogue key and refuses an unknown one", () => {
    assert.equal(compsField("rec_tgt")?.label, "Targets");
    assert.equal(compsField("kick_ret_yd"), undefined);
  });

  test("accepts the four supported positions and nothing else", () => {
    for (const position of COMPS_POSITIONS) {
      assert.ok(isCompsPosition(position));
    }
    assert.ok(!isCompsPosition("K"));
    assert.ok(!isCompsPosition("DEF"));
    assert.ok(!isCompsPosition("qb"));
  });
});
