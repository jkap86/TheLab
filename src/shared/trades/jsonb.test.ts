import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { asNumber, isRecord, items, numbers } from "./jsonb.ts";

/**
 * These four stand between Sleeper's untyped blobs and every reader of them, so
 * what is pinned here is the shape of *wrongness* they must survive: a column
 * holding the wrong JSON type, and an id spelled as a string.
 */
describe("isRecord", () => {
  test("an array is not a record", () => {
    // `adds` relies on this: it is an object of player → roster, and a row
    // storing an array there must read as no adds rather than as odd ones.
    assert.equal(isRecord([]), false);
    assert.equal(isRecord([{ a: 1 }]), false);
  });

  test("null and primitives are not records", () => {
    assert.equal(isRecord(null), false);
    assert.equal(isRecord(undefined), false);
    assert.equal(isRecord("x"), false);
    assert.equal(isRecord(3), false);
  });

  test("an object is", () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord({ "4046": 2 }), true);
  });
});

describe("items", () => {
  test("anything that is not an array yields none", () => {
    assert.deepEqual(items(null), []);
    assert.deepEqual(items({ a: 1 }), []);
    assert.deepEqual(items("nope"), []);
  });

  test("an array passes through", () => {
    assert.deepEqual(items([1, "2", null]), [1, "2", null]);
  });
});

describe("asNumber", () => {
  test("reads both spellings Sleeper has used for an id", () => {
    assert.equal(asNumber(4), 4);
    assert.equal(asNumber("4"), 4);
  });

  test("anything unreadable is null, never zero", () => {
    // Zero is a roster id and a FAAB amount, so folding an unreadable value
    // into it would invent a participant or a payment.
    assert.equal(asNumber("abc"), null);
    assert.equal(asNumber(null), null);
    assert.equal(asNumber(undefined), null);
    assert.equal(asNumber({}), null);
    assert.equal(asNumber(Number.NaN), null);
    assert.equal(asNumber(Number.POSITIVE_INFINITY), null);
  });

  test("a real zero survives", () => {
    assert.equal(asNumber(0), 0);
    assert.equal(asNumber("0"), 0);
  });
});

describe("numbers", () => {
  test("keeps what reads as a number and drops the rest", () => {
    assert.deepEqual(numbers([1, "2", "x", null, 3]), [1, 2, 3]);
  });

  test("a non-array is none", () => {
    assert.deepEqual(numbers({ "0": 1 }), []);
  });
});
