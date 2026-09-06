import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COMPS_ANSWER_MAX, COMPS_ANSWER_TTL_MS, compsAnswerKey } from "./answer-cache.ts";

/**
 * The key is the whole of what makes this cache safe. A hit is only correct
 * because two identical questions over one corpus build have one answer — so
 * anything that can change the answer has to be in it, and the corpus version
 * most of all.
 */
describe("compsAnswerKey", () => {
  const base = { version: "stored:2026-01-02T00:00:00.000Z:5000:1", query: "k=10&pos=1", minCoverage: 0.75 };

  test("the same question over the same corpus is the same key", () => {
    assert.equal(compsAnswerKey(base), compsAnswerKey({ ...base }));
  });

  test("a load moves the version, and every held answer with it", () => {
    assert.notEqual(compsAnswerKey(base), compsAnswerKey({ ...base, version: "stored:later:5100:1" }));
  });

  test("a different question is a different key", () => {
    assert.notEqual(compsAnswerKey(base), compsAnswerKey({ ...base, query: "k=11&pos=1" }));
  });

  test("the coverage threshold is in the key, so a change to it cannot reuse an old answer", () => {
    assert.notEqual(compsAnswerKey(base), compsAnswerKey({ ...base, minCoverage: 0.6 }));
  });

  test("the parts cannot run together into one another", () => {
    // A separator-free key would let a version ending in a digit and a query
    // beginning with one collide with a different pair.
    const a = compsAnswerKey({ version: "v1", query: "2", minCoverage: 0.75 });
    const b = compsAnswerKey({ version: "v", query: "12", minCoverage: 0.75 });
    assert.notEqual(a, b);
  });
});

describe("the cache's bounds", () => {
  test("are finite, because a query string is an unbounded key space", () => {
    // A rail has fifteen positions on forty-four possible pairs; an unbounded
    // map keyed by that is a leak with a slow fuse.
    assert.ok(Number.isInteger(COMPS_ANSWER_MAX) && COMPS_ANSWER_MAX > 0);
    assert.ok(COMPS_ANSWER_TTL_MS > 0 && COMPS_ANSWER_TTL_MS <= 60 * 60 * 1000);
  });
});
