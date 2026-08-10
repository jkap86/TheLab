import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BoundedCache } from "./bounded-cache.ts";

/**
 * Two properties matter and neither is obvious from the happy path: the cache is
 * *bounded* (an unbounded map of everything a process has been asked about is a
 * leak with a slow fuse), and an expired entry is *dropped* rather than left to
 * accumulate — a TTL that only hid stale values would still grow without limit.
 */
describe("BoundedCache", () => {
  test("holds what it was given until the TTL", () => {
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("a", 1);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("b"), undefined);
  });

  test("evicts the least recently read past `max`", () => {
    const cache = new BoundedCache<number>(2, 60_000);
    cache.set("a", 1);
    cache.set("b", 2);
    // Reading "a" makes "b" the oldest, so "b" is what the next write evicts.
    cache.get("a");
    cache.set("c", 3);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("c"), 3);
  });

  test("an expired entry reads as absent", () => {
    const cache = new BoundedCache<number>(10, -1);
    cache.set("a", 1);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.size, 0, "and is dropped rather than left to accumulate");
  });

  test("partition splits hits from misses", () => {
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("a", 1);
    const { hits, misses } = cache.partition(["a", "b"]);
    assert.deepEqual([...hits], [["a", 1]]);
    assert.deepEqual(misses, ["b"]);
  });
});
