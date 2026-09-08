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

  test("evicts on weight, not only on count", () => {
    // Ten slots and a budget of five: the count never bites, and the weight
    // does. This is the shape a circle cache is in — a handful of readers, one
    // of whom knows several thousand people.
    const cache = new BoundedCache<string[]>(10, 60_000, {
      maxWeight: 5,
      weigh: (ids) => ids.length,
    });
    cache.set("a", ["1", "2", "3"]);
    cache.set("b", ["4", "5"]);
    assert.equal(cache.totalWeight, 5);

    cache.set("c", ["6"]);
    assert.equal(cache.get("a"), undefined, "the oldest went to make room");
    assert.deepEqual(cache.get("b"), ["4", "5"]);
    assert.deepEqual(cache.get("c"), ["6"]);
    assert.equal(cache.totalWeight, 3);
  });

  test("both bounds apply, and either one alone can bite", () => {
    const cache = new BoundedCache<string[]>(2, 60_000, {
      maxWeight: 100,
      weigh: (ids) => ids.length,
    });
    cache.set("a", ["1"]);
    cache.set("b", ["2"]);
    cache.set("c", ["3"]);
    assert.equal(cache.size, 2, "the count bit first, well inside the weight");
    assert.equal(cache.get("a"), undefined);

    const heavy = new BoundedCache<string[]>(100, 60_000, {
      maxWeight: 4,
      weigh: (ids) => ids.length,
    });
    heavy.set("a", ["1", "2", "3"]);
    heavy.set("b", ["4", "5", "6"]);
    assert.equal(heavy.size, 1, "the weight bit first, well inside the count");
    assert.equal(heavy.totalWeight, 3);
  });

  test("an entry heavier than the whole budget is not stored at all", () => {
    // The pathological case: eviction cannot reach a bound smaller than one
    // entry, so either the trim never converges or that one value is exempt
    // from the limit it exceeds — which is the unbounded map the class exists
    // to not be. It is refused, and its caller pays a recompute.
    const cache = new BoundedCache<string[]>(10, 60_000, {
      maxWeight: 3,
      weigh: (ids) => ids.length,
    });
    cache.set("small", ["1"]);
    cache.set("huge", Array.from({ length: 50 }, (_, i) => String(i)));

    assert.equal(cache.get("huge"), undefined);
    assert.deepEqual(cache.get("small"), ["1"], "and it cost nobody else");
    assert.equal(cache.totalWeight, 1);
  });

  test("replacing a key replaces its weight, never adds to it", () => {
    // The running total is maintained rather than recomputed, so a write over
    // an existing key is the one place it can drift — and a drifted total is a
    // cache that evicts everything or nothing, silently.
    const cache = new BoundedCache<string[]>(10, 60_000, {
      maxWeight: 100,
      weigh: (ids) => ids.length,
    });
    cache.set("a", ["1", "2", "3"]);
    cache.set("a", ["1"]);
    assert.equal(cache.totalWeight, 1);
    assert.equal(cache.size, 1);

    cache.delete("a");
    assert.equal(cache.totalWeight, 0);

    cache.set("b", ["1", "2"]);
    cache.clear();
    assert.equal(cache.totalWeight, 0, "and a clear resets it");
  });

  test("an expired entry gives its weight back", () => {
    const cache = new BoundedCache<string[]>(10, -1, {
      maxWeight: 100,
      weigh: (ids) => ids.length,
    });
    cache.set("a", ["1", "2"]);
    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.totalWeight, 0, "the read that dropped it un-weighed it");
  });

  test("a cache with no weight options is the one it always was", () => {
    // Every caller that predates the weight passes neither option and must be
    // untouched: an unweighed entry counts 1 and the bound is the count.
    const cache = new BoundedCache<number>(2, 60_000);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    assert.equal(cache.size, 2);
    assert.equal(cache.totalWeight, 2);
  });

  test("partition splits hits from misses", () => {
    const cache = new BoundedCache<number>(10, 60_000);
    cache.set("a", 1);
    const { hits, misses } = cache.partition(["a", "b"]);
    assert.deepEqual([...hits], [["a", 1]]);
    assert.deepEqual(misses, ["b"]);
  });
});
