import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assignColumn, groupMetrics, resolveColumns } from "./columns.ts";

const KNOWN = new Set(["standing", "points", "ktc_start", "proj", "bench"]);
const DEFAULTS = ["standing", "points", "ktc_start", "proj"];

describe("resolveColumns", () => {
  test("nothing stored is the defaults", () => {
    assert.deepEqual(resolveColumns(null, DEFAULTS, KNOWN), DEFAULTS);
  });

  test("a stored selection is returned", () => {
    const stored = JSON.stringify(["proj", "bench", "points", "standing"]);
    assert.deepEqual(resolveColumns(stored, DEFAULTS, KNOWN), [
      "proj",
      "bench",
      "points",
      "standing",
    ]);
  });

  test("only the slot naming a gone metric falls back", () => {
    const stored = JSON.stringify(["proj", "retired_metric", "points", "bench"]);
    assert.deepEqual(resolveColumns(stored, DEFAULTS, KNOWN), [
      "proj",
      "points", // this slot's default, not the whole row's
      "points",
      "bench",
    ]);
  });

  test("the shape is the defaults', however long the stored row is", () => {
    assert.deepEqual(
      resolveColumns(JSON.stringify(["bench"]), DEFAULTS, KNOWN),
      ["bench", "points", "ktc_start", "proj"],
    );
    assert.deepEqual(
      resolveColumns(
        JSON.stringify(["bench", "proj", "points", "standing", "proj"]),
        DEFAULTS,
        KNOWN,
      ),
      ["bench", "proj", "points", "standing"],
    );
  });

  test("junk in storage is the defaults, never a throw", () => {
    for (const stored of ["", "{oops", "null", '{"a":1}', "[1,2,3,4]"]) {
      assert.deepEqual(resolveColumns(stored, DEFAULTS, KNOWN), DEFAULTS);
    }
  });
});

describe("assignColumn", () => {
  test("a metric no other slot holds simply lands", () => {
    assert.deepEqual(assignColumn(DEFAULTS, 2, "bench"), [
      "standing",
      "points",
      "bench",
      "proj",
    ]);
  });

  test("a metric another slot holds trades places with it", () => {
    // Slot 3 asks for `points`, which slot 1 shows — so slot 1 takes `proj`.
    assert.deepEqual(assignColumn(DEFAULTS, 3, "points"), [
      "standing",
      "proj",
      "ktc_start",
      "points",
    ]);
  });

  test("re-picking the metric a slot already shows changes nothing", () => {
    assert.deepEqual(assignColumn(DEFAULTS, 1, "points"), DEFAULTS);
  });

  test("a slot off the end is a no-op, not a throw", () => {
    assert.deepEqual(assignColumn(DEFAULTS, 9, "bench"), DEFAULTS);
    assert.deepEqual(assignColumn(DEFAULTS, -1, "bench"), DEFAULTS);
  });

  test("the input is never mutated", () => {
    const before = [...DEFAULTS];
    assignColumn(DEFAULTS, 0, "bench");
    assert.deepEqual(DEFAULTS, before);
  });
});

describe("groupMetrics", () => {
  const METRICS = [
    { key: "standing", group: "Record" },
    { key: "proj", group: "Projection" },
    { key: "points", group: "Record" },
    { key: "loose" },
  ];

  test("a family appears where its first member does, and gathers the rest", () => {
    assert.deepEqual(
      groupMetrics(METRICS, "Other").map((group) => [
        group.label,
        group.metrics.map((metric) => metric.key),
      ]),
      [
        ["Record", ["standing", "points"]],
        ["Projection", ["proj"]],
        ["Other", ["loose"]],
      ],
    );
  });

  test("every metric survives exactly once", () => {
    const grouped = groupMetrics(METRICS, "Other").flatMap((g) => g.metrics);
    assert.equal(grouped.length, METRICS.length);
  });

  test("an ungrouped catalogue is one group", () => {
    const loose: { key: string; group?: string }[] = [{ key: "a" }, { key: "b" }];
    const groups = groupMetrics(loose, "All");
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "All");
  });
});
