import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

import { TtlPromiseCache, type CacheOutcome } from "./ttl-promise-cache.ts";

/**
 * The seven properties the two server-side read caches rest on. Six of them are
 * about *not* doing work, and the seventh is about not keeping it: a cache that
 * coalesces perfectly and grows without bound is a leak with a slow fuse, which
 * is the failure `BoundedCache` was written against and this inherits the answer
 * to.
 *
 * Timers are mocked rather than slept through — a test that waits out a
 * ten-minute TTL is a test nobody runs.
 */

/** A cache whose values are trivially distinguishable, plus a call counter. */
function counted(options?: { max?: number; ttlMs?: number }) {
  let calls = 0;
  const outcomes: CacheOutcome[] = [];
  const cache = new TtlPromiseCache<{ n: number }>({
    max: options?.max ?? 8,
    ttlMs: options?.ttlMs ?? 60_000,
    name: "test",
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  const compute = async () => {
    calls += 1;
    return { n: calls };
  };
  return { cache, compute, outcomes, calls: () => calls };
}

/** A compute that resolves only when the returned `release` is called. */
function deferred<V>() {
  let release!: (value: V) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<V>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

describe("TtlPromiseCache", () => {
  test("the first read computes", async () => {
    const { cache, compute, calls } = counted();
    assert.deepEqual(await cache.read("a", compute), { n: 1 });
    assert.equal(calls(), 1);
  });

  test("a second read inside the TTL is served from the cache", async () => {
    const { cache, compute, calls, outcomes } = counted();
    await cache.read("a", compute);
    assert.deepEqual(await cache.read("a", compute), { n: 1 });
    assert.equal(calls(), 1, "the underlying computation ran once");
    assert.deepEqual(outcomes, ["miss", "hit"]);
  });

  test("concurrent reads of one key share a single computation", async () => {
    const { promise, release } = deferred<{ n: number }>();
    let calls = 0;
    const outcomes: CacheOutcome[] = [];
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    const compute = () => {
      calls += 1;
      return promise;
    };

    // Ten readers arrive on a cold key before the first has finished.
    const readers = Array.from({ length: 10 }, () => cache.read("a", compute));
    assert.equal(calls, 1, "only the first caller computes");
    assert.equal(cache.inFlight, 1);

    release({ n: 7 });
    const results = await Promise.all(readers);
    for (const result of results) {
      assert.deepEqual(result, { n: 7 }, "and every caller gets that answer");
    }
    assert.equal(calls, 1);
    assert.deepEqual(outcomes, ["miss", ...Array(9).fill("coalesced")]);
    assert.equal(cache.inFlight, 0, "the in-flight entry is released on settle");
    assert.equal(cache.size, 1, "and the resolved answer is what is kept");
  });

  test("different keys are computed separately", async () => {
    const { cache, compute, calls } = counted();
    assert.deepEqual(await cache.read("a", compute), { n: 1 });
    assert.deepEqual(await cache.read("b", compute), { n: 2 });
    assert.equal(calls(), 2);
    assert.deepEqual(await cache.read("a", compute), { n: 1 }, "and kept apart");
  });

  test("an expired entry is recomputed", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    t.after(() => mock.timers.reset());

    const { cache, compute, calls } = counted({ ttlMs: 60_000 });
    await cache.read("a", compute);

    t.mock.timers.tick(59_000);
    assert.deepEqual(await cache.read("a", compute), { n: 1 });
    assert.equal(calls(), 1, "still inside the TTL");

    t.mock.timers.tick(2_000);
    assert.deepEqual(await cache.read("a", compute), { n: 2 });
    assert.equal(calls(), 2, "past it, the value is computed again");
  });

  test("a failed computation is not cached, and the next read retries", async () => {
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });
    let calls = 0;
    const compute = async () => {
      calls += 1;
      if (calls === 1) throw new Error("database is down");
      return { n: calls };
    };

    await assert.rejects(cache.read("a", compute), /database is down/);
    assert.equal(cache.size, 0, "nothing was stored");
    assert.equal(cache.inFlight, 0, "and nothing was left in flight");

    assert.deepEqual(await cache.read("a", compute), { n: 2 });
    assert.equal(calls, 2);
  });

  test("everyone waiting on a failed computation sees the failure", async () => {
    const { promise, fail } = deferred<{ n: number }>();
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });
    const readers = Array.from({ length: 3 }, () =>
      cache.read("a", () => promise),
    );
    fail(new Error("boom"));
    for (const reader of readers) await assert.rejects(reader, /boom/);
    assert.equal(cache.size, 0);
    assert.equal(cache.inFlight, 0);
  });

  test("a synchronous throw rejects rather than escaping the bookkeeping", async () => {
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });
    await assert.rejects(
      cache.read("a", () => {
        throw new Error("bad key");
      }),
      /bad key/,
    );
    assert.equal(cache.inFlight, 0, "the key does not stay wedged");
  });

  test("the resolved half cannot exceed its bound", async () => {
    const { cache, compute } = counted({ max: 3 });
    for (const key of ["a", "b", "c", "d", "e"]) await cache.read(key, compute);
    assert.equal(cache.size, 3);
    assert.equal(cache.peek("a"), undefined, "the oldest went first");
    assert.equal(cache.peek("b"), undefined);
    assert.deepEqual(cache.peek("e"), { n: 5 });
  });

  test("forget drops one key and leaves the rest", async () => {
    const { cache, compute, calls } = counted();

    await cache.read("a", compute);
    await cache.read("b", compute);
    assert.equal(calls(), 2);

    // What a write behind the cache does — the league core is invalidated by the
    // sync that rewrote it, not only by its TTL.
    cache.forget("a");
    await cache.read("a", compute);
    await cache.read("b", compute);

    assert.equal(calls(), 3, "only the forgotten key recomputed");
  });

  test("a compute in flight when a key is forgotten does not store its answer", async () => {
    const stale = deferred<{ n: number }>();
    const fresh = deferred<{ n: number }>();
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });

    // A read that started *before* the write lands after it. Left in the pending
    // map it would store rows the invalidation exists to end — the staleness
    // arriving a moment after the call that was meant to end it.
    const before = cache.read("a", () => stale.promise);
    cache.forget("a");
    const after = cache.read("a", () => fresh.promise);

    fresh.release({ n: 2 });
    assert.deepEqual(await after, { n: 2 });
    stale.release({ n: 1 });
    // The caller that asked first still gets an answer; it is simply not kept.
    assert.deepEqual(await before, { n: 1 });
    assert.deepEqual(cache.peek("a"), { n: 2 });
  });

  test("a read may store its answer on the entry's own TTL", async () => {
    // The comps corpus's case: one cache holding a season per key, where the
    // live season moves weekly and a 2008 season does not move at all.
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: -1,
      name: "test",
    });

    await cache.read("live", async () => ({ n: 1 }));
    await cache.read("archive", async () => ({ n: 2 }), { ttlMs: 60_000 });

    assert.equal(cache.peek("live"), undefined, "the cache's own TTL applied");
    assert.deepEqual(cache.peek("archive"), { n: 2 }, "the entry's own did too");
  });

  test("a per-entry TTL does not disturb coalescing or retries", async () => {
    const { promise, release } = deferred<{ n: number }>();
    let calls = 0;
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });
    const compute = () => {
      calls += 1;
      return promise;
    };

    const readers = Array.from({ length: 5 }, () =>
      cache.read("a", compute, { ttlMs: 24 * 60 * 60 * 1000 }),
    );
    assert.equal(calls, 1, "still one computation for five callers");

    release({ n: 3 });
    for (const reader of readers) assert.deepEqual(await reader, { n: 3 });
    assert.equal(cache.inFlight, 0);
  });

  test("a read may take its TTL from the answer itself", async () => {
    // The league week's case: what makes the view stale is the next kickoff,
    // which is an instant in the schedule the view already carries — so the
    // bound is read off the value rather than off the key, and the two cannot
    // disagree about what the schedule said.
    const cache = new TtlPromiseCache<{ ttl: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });

    await cache.read("keep", async () => ({ ttl: 60_000 }), {
      ttlMsFor: (value) => value.ttl,
    });
    await cache.read("drop", async () => ({ ttl: -1 }), {
      ttlMsFor: (value) => value.ttl,
    });

    assert.deepEqual(cache.peek("keep"), { ttl: 60_000 });
    assert.equal(cache.peek("drop"), undefined, "the answer's own bound applied");
  });

  test("a value's own TTL wins over one given by the caller", async () => {
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });
    await cache.read("a", async () => ({ n: 1 }), {
      ttlMs: 60_000,
      ttlMsFor: () => -1,
    });
    assert.equal(cache.peek("a"), undefined);
  });

  test("a non-positive TTL is coalescing and nothing else", async () => {
    const { promise, release } = deferred<{ n: number }>();
    let calls = 0;
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 0,
      name: "test",
    });
    const compute = () => {
      calls += 1;
      return promise;
    };

    // The half of this cache that costs no freshness at all: callers arriving
    // while a computation runs asked for an answer that did not exist yet. What
    // is deliberately not kept is the entry, so the bound is never spent on a
    // value nothing may read.
    const readers = [cache.read("a", compute), cache.read("a", compute)];
    assert.equal(calls, 1);
    release({ n: 1 });
    for (const reader of readers) assert.deepEqual(await reader, { n: 1 });
    assert.equal(cache.size, 0);
    assert.equal(cache.inFlight, 0);

    await cache.read("a", compute);
    assert.equal(calls, 2, "and the next read computes again");
  });

  test("clear drops both halves, and a compute in flight cannot un-coalesce the next", async () => {
    const first = deferred<{ n: number }>();
    const second = deferred<{ n: number }>();
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
    });

    const stale = cache.read("a", () => first.promise);
    cache.clear();
    const fresh = cache.read("a", () => second.promise);
    assert.equal(cache.inFlight, 1);

    // The older compute settles last; it must not delete the newer key.
    second.release({ n: 2 });
    await fresh;
    first.release({ n: 1 });
    await stale;

    assert.deepEqual(cache.peek("a"), { n: 2 }, "the newer answer survives");
  });
});
