import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BoundedCache, cachedLookup } from "./cache.ts";

/**
 * `cachedLookup`'s own habit: it caches *misses* as well as hits, because an id
 * nothing is stored for is the one most likely to be asked about repeatedly.
 * The cache underneath it is tested beside the class, in `shared/util`.
 */
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
