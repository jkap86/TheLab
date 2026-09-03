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

  test("an entry may carry its own TTL", () => {
    const cache = new BoundedCache<number>(10, -1);
    cache.set("expired-by-default", 1);
    cache.set("long-lived", 2, { ttlMs: 60_000 });

    assert.equal(cache.get("expired-by-default"), undefined);
    assert.equal(cache.get("long-lived"), 2);
  });

  test("a per-entry TTL expires on its own clock", () => {
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("short", 1, { ttlMs: -1 });
    cache.set("default", 2);

    assert.equal(
      cache.get("short"),
      undefined,
      "its own TTL wins, not the cache's",
    );
    assert.equal(cache.get("default"), 2, "the cache's own TTL is untouched");
    assert.equal(cache.size, 1, "and the expired one is dropped, not accumulated");
  });

  test("a non-positive TTL stores nothing, rather than storing the unreadable", () => {
    // An entry already expired at the moment it is written can never be answered
    // from, so keeping it would hold a value in memory and a slot against `max`
    // for nothing.
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("live", 1);
    cache.set("already-expired", 2, { ttlMs: 0 });
    cache.set("behind-us", 3, { ttlMs: -5_000 });

    assert.equal(cache.size, 1, "the bound is not spent on entries nothing reads");
    assert.equal(cache.get("already-expired"), undefined);
    assert.equal(cache.get("behind-us"), undefined);
    assert.equal(cache.get("live"), 1);
  });

  test("a non-positive TTL replaces what was there, it does not leave it", () => {
    // The write still happened: leaving the old value readable would answer a
    // caller from rows the new one supersedes.
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("a", 1);
    cache.set("a", 2, { ttlMs: 0 });
    assert.equal(cache.get("a"), undefined);
  });

  test("an omitted TTL is exactly the cache's own", () => {
    // The common case must be untouched: every existing caller passes nothing.
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("a", 1, {});
    cache.set("b", 2, { ttlMs: undefined });
    cache.set("c", 3);
    assert.deepEqual([cache.get("a"), cache.get("b"), cache.get("c")], [1, 2, 3]);
  });

  test("a long-lived entry is still evicted by the bound", () => {
    // The TTL says when an entry stops being *true*; `max` says how many the
    // process may hold. A per-entry TTL must not buy an exemption from the
    // second, or the cache is an unbounded map again.
    const cache = new BoundedCache<number>(2, 60_000);
    cache.set("a", 1, { ttlMs: 24 * 60 * 60 * 1000 });
    cache.set("b", 2, { ttlMs: 24 * 60 * 60 * 1000 });
    cache.set("c", 3, { ttlMs: 24 * 60 * 60 * 1000 });
    assert.equal(cache.get("a"), undefined, "the oldest still goes");
    assert.equal(cache.size, 2);
  });

  test("partition splits hits from misses", () => {
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("a", 1);
    const { hits, misses } = cache.partition(["a", "b"]);
    assert.deepEqual([...hits], [["a", 1]]);
    assert.deepEqual(misses, ["b"]);
  });
});
