import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BoundedCache, cachedLookup } from "./cache.ts";

/**
 * The enrichment caches. Two properties matter and neither is obvious from the
 * happy path: the cache is *bounded* (an unbounded map of every id a process has
 * been asked about is a leak with a slow fuse) and it caches *misses* (an id
 * nothing is stored for is the one most likely to be asked about repeatedly).
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
    // Reading `a` makes `b` the oldest, which is the whole reason `get`
    // re-inserts: without it the eviction order is insertion order, and the
    // entry every page reads is the one that gets thrown away.
    cache.get("a");
    cache.set("c", 3);
    assert.equal(cache.size, 2);
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

describe("cachedLookup", () => {
  test("fetches only what the cache lacks", async () => {
    const cache = new BoundedCache<string | null>(10, 60_000);
    const asked: string[][] = [];
    const fetch = async (ids: string[]) => {
      asked.push(ids);
      return new Map(ids.map((id) => [id, id.toUpperCase()]));
    };

    assert.deepEqual([...(await cachedLookup(cache, ["a", "b"], fetch))], [
      ["a", "A"],
      ["b", "B"],
    ]);
    assert.deepEqual([...(await cachedLookup(cache, ["b", "c"], fetch))], [
      ["b", "B"],
      ["c", "C"],
    ]);
    assert.deepEqual(asked, [["a", "b"], ["c"]]);
  });

  test("an id with nothing stored is asked about once, not once a page", async () => {
    // The case this exists for: KTC prices ~500 players, so an unpriced kicker
    // appears in trades all season and would otherwise be queried every time.
    const cache = new BoundedCache<string | null>(10, 60_000);
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return new Map<string, string>();
    };

    assert.equal((await cachedLookup(cache, ["missing"], fetch)).size, 0);
    assert.equal((await cachedLookup(cache, ["missing"], fetch)).size, 0);
    assert.equal(calls, 1);
  });

  test("nothing is fetched when everything is cached", async () => {
    const cache = new BoundedCache<string | null>(10, 60_000);
    cache.set("a", "A");
    let calls = 0;
    const result = await cachedLookup(cache, ["a"], async () => {
      calls += 1;
      return {};
    });
    assert.deepEqual([...result], [["a", "A"]]);
    assert.equal(calls, 0);
  });

  test("takes a plain object as readily as a Map", async () => {
    const cache = new BoundedCache<string | null>(10, 60_000);
    const result = await cachedLookup(cache, ["a"], async () => ({ a: "A" }));
    assert.deepEqual([...result], [["a", "A"]]);
  });
});
