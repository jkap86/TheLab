import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { criterionValue, draftLabel, signedDelta, weightLabel } from "./format.ts";

describe("the comps figures", () => {
  test("a delta carries a real minus, a plus, and no sign at zero", () => {
    assert.equal(signedDelta(4.2, 1), "+4.2");
    assert.equal(signedDelta(-1.8, 1), "−1.8");
    assert.equal(signedDelta(0, 1), "0.0");
    assert.equal(signedDelta(-320), "−320");
  });

  test("a draft pick at or past the UDFA mark is the word, and a null is too", () => {
    assert.equal(draftLabel(69), "#69");
    assert.equal(draftLabel(260), "UDFA");
    assert.equal(draftLabel(null), "UDFA");
  });

  test("a chip prints each criterion in its own unit", () => {
    assert.equal(criterionValue("yprr", 2.4), "2.40");
    assert.equal(criterionValue("tgtsh", 27.5), "28%");
    assert.equal(criterionValue("snap", 88), "88%");
    assert.equal(criterionValue("ppg", 17.25), "17.3");
    assert.equal(criterionValue("draft", 177), "#177");
    assert.equal(criterionValue("recyd", 1230), "1,230");
    assert.equal(criterionValue("age", 24), "24");
  });

  test("a weight reads to one decimal with a multiplication sign", () => {
    assert.equal(weightLabel(1.6), "1.6×");
    assert.equal(weightLabel(1), "1.0×");
  });
});
