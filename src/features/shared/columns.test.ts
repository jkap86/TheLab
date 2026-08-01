import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveColumns } from "./columns.ts";

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
