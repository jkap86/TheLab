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

/**
 * Concurrent cold misses, which are the trades route's expensive case.
 *
 * A cache answers the *second* page cheaply and does nothing at all for two
 * readers arriving together on a board nobody has asked for since the last TTL:
 * both miss, both query, and the second request costs a full set of pool
 * connections answering questions already in flight. These pin that it now
 * costs none.
 */
describe("cachedLookup, under concurrent cold misses", () => {
  /** A fetch that does not settle until it is told to. */
  const deferred = () => {
    let release!: (value: Map<string, string>) => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<Map<string, string>>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    return { promise, release, fail };
  };

  test("two callers on the same cold ids issue one fetch", async () => {
    const cache = new BoundedCache<string | null>(10, 60_000);
    const asked: string[][] = [];
    const gate = deferred();
    const fetch = async (ids: string[]) => {
      asked.push(ids);
      return gate.promise;
    };

    const first = cachedLookup(cache, ["a", "b"], fetch);
    const second = cachedLookup(cache, ["a", "b"], fetch);
    gate.release(new Map([["a", "A"], ["b", "B"]]));

    assert.deepEqual([...(await first)], [["a", "A"], ["b", "B"]]);
    assert.deepEqual([...(await second)], [["a", "A"], ["b", "B"]]);
    assert.deepEqual(asked, [["a", "b"]], "the second caller joined the first");
  });

  test("a caller asks only for the ids nobody else has in flight", async () => {
    // The partial-overlap case: the second reader's page shares most of its
    // players with the first's and names a few of its own.
    const cache = new BoundedCache<string | null>(10, 60_000);
    const asked: string[][] = [];
    const gate = deferred();
    const fetch = async (ids: string[]) => {
      asked.push(ids);
      if (asked.length === 1) return gate.promise;
      return new Map(ids.map((id) => [id, id.toUpperCase()]));
    };

    const first = cachedLookup(cache, ["a", "b"], fetch);
    const second = cachedLookup(cache, ["b", "c"], fetch);
    gate.release(new Map([["a", "A"], ["b", "B"]]));

    await first;
    // Sorted, because the result is a lookup and its iteration order has never
    // been the input's — hits have always come out ahead of misses.
    assert.deepEqual([...(await second)].sort(), [["b", "B"], ["c", "C"]]);
    assert.deepEqual(asked, [["a", "b"], ["c"]]);
  });

  test("a joined miss is remembered as a miss, not re-asked", async () => {
    const cache = new BoundedCache<string | null>(10, 60_000);
    let calls = 0;
    const gate = deferred();
    const fetch = async () => {
      calls += 1;
      return gate.promise;
    };

    const first = cachedLookup(cache, ["gone"], fetch);
    const second = cachedLookup(cache, ["gone"], fetch);
    gate.release(new Map());

    assert.equal((await first).size, 0);
    assert.equal((await second).size, 0);
    assert.equal(calls, 1);
    // And the miss is cached, so a later page does not ask again either.
    assert.equal((await cachedLookup(cache, ["gone"], fetch)).size, 0);
    assert.equal(calls, 1);
  });

  test("a failed fetch caches nothing and is retried by the next caller", async () => {
    // The `memoize-manager-lookup` rule: a database blip remembered for the TTL
    // is an outage extended by the mechanism meant to absorb one.
    const cache = new BoundedCache<string | null>(10, 60_000);
    let calls = 0;
    const gate = deferred();
    const fetch = async (ids: string[]) => {
      calls += 1;
      if (calls === 1) return gate.promise;
      return new Map(ids.map((id) => [id, id.toUpperCase()]));
    };

    const first = cachedLookup(cache, ["a"], fetch);
    gate.fail(new Error("connection reset"));
    await assert.rejects(first, /connection reset/);

    assert.deepEqual([...(await cachedLookup(cache, ["a"], fetch))], [["a", "A"]]);
    assert.equal(calls, 2, "the failure left nothing behind to serve");
  });

  test("a joiner is not taken down by the owner's failure", async () => {
    // It asked about one id and somebody else's query for it failed; the honest
    // answer is "nothing for that id", not a failed page of trades.
    const cache = new BoundedCache<string | null>(10, 60_000);
    const gate = deferred();
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return gate.promise;
    };

    const owner = cachedLookup(cache, ["a"], fetch);
    const joiner = cachedLookup(cache, ["a"], fetch);
    gate.fail(new Error("connection reset"));

    await assert.rejects(owner, /connection reset/);
    assert.equal((await joiner).size, 0);
    assert.equal(calls, 1);
  });

  test("in-flight bookkeeping does not leak across calls", async () => {
    // If a settled fetch left its ids registered, every later request would
    // await a promise nobody is going to re-run.
    const cache = new BoundedCache<string | null>(10, 60_000);
    let calls = 0;
    const fetch = async (ids: string[]) => {
      calls += 1;
      return new Map(ids.map((id) => [id, id.toUpperCase()]));
    };

    await cachedLookup(cache, ["a"], fetch);
    cache.clear();
    assert.deepEqual([...(await cachedLookup(cache, ["a"], fetch))], [["a", "A"]]);
    assert.equal(calls, 2);
  });
});
