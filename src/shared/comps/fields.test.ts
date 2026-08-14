import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_FIELDS,
  COMPS_POSITIONS,
  compsField,
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

  test("a statKey is present exactly on the production fields", () => {
    for (const field of COMPS_FIELDS) {
      assert.equal(
        field.statKey !== undefined,
        field.family === "production",
        `${field.key}: statKey and family disagree`,
      );
    }
  });

  test("perGame is true exactly for production — age-per-game is nonsense", () => {
    for (const field of COMPS_FIELDS) {
      assert.equal(
        field.perGame,
        field.family === "production",
        `${field.key}: perGame and family disagree`,
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
    assert.equal(compsField("off_snp"), undefined);
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
