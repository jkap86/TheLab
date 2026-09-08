import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createReadMemo,
  createStaleWhileRevalidateMemo,
  managerReadKey,
  managerReadMatcher,
} from "./read-cache.ts";

/**
 * The two memo shapes, driven under an injected clock and reader.
 *
 * Every rule here renders perfectly while being wrong — a rejection that stays
 * cached is a fifteen-minute outage, a rebuild that runs per stale mark is the
 * eviction storm the stale-while-revalidate arm exists to stop, and a stale
 * mark lost to a rebuild that predates it is a board serving data a persist has
 * already replaced. None of them throws.
 */

const clock = (start = 1_000) => {
  let t = start;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
};

const deferred = <V,>() => {
  let resolve!: (value: V) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<V>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Let every settled promise's handlers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createReadMemo", () => {
  test("one read per key inside the TTL, shared by everyone who asks", async () => {
    const { now } = clock();
    const memo = createReadMemo<string>({ ttlMs: 100, max: 10, now });
    let loads = 0;
    const load = async () => `v${(loads += 1)}`;

    const first = memo.read("k", load);
    const second = memo.read("k", load);
    assert.equal(first, second, "an in-flight read is joined, not repeated");
    assert.equal(await first, "v1");
    assert.equal(await memo.read("k", load), "v1");
    assert.equal(loads, 1);
  });

  test("the TTL replaces the answer rather than extending it", async () => {
    const { now, tick } = clock();
    const memo = createReadMemo<number>({ ttlMs: 100, max: 10, now });
    let loads = 0;
    const load = async () => (loads += 1);

    assert.equal(await memo.read("k", load), 1);
    tick(99);
    assert.equal(await memo.read("k", load), 1, "inside the TTL is the same answer");
    tick(1);
    assert.equal(await memo.read("k", load), 2, "at the TTL a new read replaces it");
    assert.equal(loads, 2);
  });

  test("a rejection is evicted at once, so the next read retries", async () => {
    const { now } = clock();
    const memo = createReadMemo<string>({ ttlMs: 100, max: 10, now });
    let loads = 0;
    const load = async () => {
      loads += 1;
      if (loads === 1) throw new Error("blip");
      return "ok";
    };

    await assert.rejects(memo.read("k", load), /blip/);
    assert.equal(memo.size, 0, "the failure is not held for the TTL");
    assert.equal(await memo.read("k", load), "ok");
    assert.equal(loads, 2);
  });

  test("a late rejection does not evict the newer entry that replaced it", async () => {
    const { now, tick } = clock();
    const memo = createReadMemo<string>({ ttlMs: 100, max: 10, now });
    const slow = deferred<string>();
    const first = memo.read("k", () => slow.promise);
    first.catch(() => {});

    tick(100);
    const second = memo.read("k", async () => "fresh");
    assert.notEqual(first, second);
    slow.reject(new Error("late"));
    await settle();

    assert.equal(memo.size, 1, "only the entry that failed is dropped");
    assert.equal(await memo.read("k", async () => "unwanted"), "fresh");
  });

  test("the bound evicts the least recently written key", async () => {
    const { now, tick } = clock();
    const memo = createReadMemo<string>({ ttlMs: 1_000, max: 2, now });
    await memo.read("a", async () => "a");
    await memo.read("b", async () => "b");
    // Refreshing `a` past its TTL moves it to the back of the line, so it is
    // `b` — the least recently written — that goes when `c` arrives.
    tick(1_000);
    await memo.read("a", async () => "a2");
    await memo.read("c", async () => "c");

    assert.equal(memo.size, 2);
    assert.equal(await memo.read("a", async () => "no"), "a2");
    assert.equal(await memo.read("b", async () => "reloaded"), "reloaded");
  });

  test("expired entries are dropped on the next write rather than held to the bound", async () => {
    const { now, tick } = clock();
    const memo = createReadMemo<string>({ ttlMs: 10, max: 100, now });
    await memo.read("a", async () => "a");
    await memo.read("b", async () => "b");
    assert.equal(memo.size, 2);

    tick(10);
    await memo.read("c", async () => "c");
    assert.equal(memo.size, 1, "nobody can be answered from `a` or `b` any more");
  });

  test("forget drops what matches and answers how many went", async () => {
    const { now } = clock();
    const memo = createReadMemo<string>({ ttlMs: 100, max: 10, now });
    await memo.read("a", async () => "a");
    await memo.read("b", async () => "b");

    assert.equal(memo.forget((key) => key === "a"), 1);
    assert.equal(memo.forget(() => false), 0);
    assert.equal(memo.size, 1);
    assert.equal(await memo.read("a", async () => "again"), "again");
    assert.equal(await memo.read("b", async () => "no"), "b");
  });
});

describe("createStaleWhileRevalidateMemo", () => {
  const options = (now: () => number, onRebuildError?: (k: string, e: unknown) => void) =>
    ({ ttlMs: 1_000, revalidateMs: 60, now, onRebuildError }) as const;

  test("a cold read is shared, and a cold rejection is evicted", async () => {
    const { now } = clock();
    const memo = createStaleWhileRevalidateMemo<string>(options(now));
    let loads = 0;
    const load = async () => {
      loads += 1;
      if (loads === 1) throw new Error("blip");
      return "ok";
    };

    const first = memo.read("s", load);
    assert.equal(memo.read("s", load), first, "joined while in flight");
    await assert.rejects(first, /blip/);
    assert.equal(memo.size, 0, "there is nothing older to keep, so it goes");
    assert.equal(await memo.read("s", load), "ok");
  });

  test("a stale mark keeps answering while exactly one rebuild runs behind it", async () => {
    const { now, tick } = clock();
    const memo = createStaleWhileRevalidateMemo<string>(options(now));
    const loads: ReturnType<typeof deferred<string>>[] = [];
    const load = () => {
      const d = deferred<string>();
      loads.push(d);
      return d.promise;
    };

    const cold = memo.read("s", load);
    loads[0].resolve("v1");
    assert.equal(await cold, "v1");

    assert.equal(memo.markStale("s"), true);
    tick(60);
    assert.equal(await memo.read("s", load), "v1", "the stale board still answers");
    assert.equal(loads.length, 2, "and a rebuild started behind it");
    assert.equal(await memo.read("s", load), "v1");
    assert.equal(loads.length, 2, "a second reader joins the rebuild rather than starting one");

    loads[1].resolve("v2");
    await settle();
    assert.equal(await memo.read("s", load), "v2", "the rebuild replaced the answer");
    assert.equal(loads.length, 2, "and nothing is due any more");
  });

  test("a rebuild is started at most once per revalidateMs, however often it is marked", async () => {
    const { now, tick } = clock();
    const memo = createStaleWhileRevalidateMemo<string>(options(now));
    let loads = 0;
    const load = async () => `v${(loads += 1)}`;

    await memo.read("s", load);
    memo.markStale("s");
    memo.markStale("s");
    assert.equal(await memo.read("s", load), "v1");
    assert.equal(loads, 1, "the cold read was a moment ago, so no rebuild yet");

    tick(59);
    await memo.read("s", load);
    assert.equal(loads, 1);
    tick(1);
    await memo.read("s", load);
    assert.equal(loads, 2, "the minute is up");
    await settle();
    assert.equal(await memo.read("s", load), "v2");
  });

  test("a rebuild that rejects keeps the old answer and caches nothing", async () => {
    const { now, tick } = clock();
    const errors: [string, unknown][] = [];
    const memo = createStaleWhileRevalidateMemo<string>(
      options(now, (key, error) => errors.push([key, error])),
    );
    let loads = 0;
    const load = async () => {
      loads += 1;
      if (loads === 2) throw new Error("rebuild blip");
      return `v${loads}`;
    };

    await memo.read("s", load);
    memo.markStale("s");
    tick(60);
    assert.equal(await memo.read("s", load), "v1");
    await settle();
    assert.equal(errors.length, 1, "the failure is reported");
    assert.equal(errors[0][0], "s");
    assert.equal(await memo.read("s", load), "v1", "and the old answer stands");
    assert.equal(loads, 2, "no retry inside the throttle window");

    tick(60);
    assert.equal(await memo.read("s", load), "v1", "still the old answer while retrying");
    await settle();
    assert.equal(await memo.read("s", load), "v3", "the retry landed");
  });

  test("a mark that lands during a rebuild is not cleared by it", async () => {
    const { now, tick } = clock();
    const memo = createStaleWhileRevalidateMemo<string>(options(now));
    const loads: ReturnType<typeof deferred<string>>[] = [];
    const load = () => {
      const d = deferred<string>();
      loads.push(d);
      return d.promise;
    };

    const cold = memo.read("s", load);
    loads[0].resolve("v1");
    await cold;
    memo.markStale("s");
    tick(60);
    await memo.read("s", load);
    assert.equal(loads.length, 2, "rebuilding");

    // A persist lands while the aggregate is running: the rebuild may or may
    // not have seen it, so its answer is served but is not believed fresh.
    memo.markStale("s");
    loads[1].resolve("v2");
    await settle();
    assert.equal(await memo.read("s", load), "v2");
    assert.equal(loads.length, 2, "inside the throttle, so not yet");
    tick(60);
    assert.equal(await memo.read("s", load), "v2");
    assert.equal(loads.length, 3, "still due, so a further rebuild follows");
  });

  test("the TTL running out serves the old answer while a rebuild runs", async () => {
    const { now, tick } = clock();
    const memo = createStaleWhileRevalidateMemo<string>(options(now));
    let loads = 0;
    const load = async () => `v${(loads += 1)}`;

    await memo.read("s", load);
    tick(999);
    await memo.read("s", load);
    assert.equal(loads, 1);
    tick(1);
    assert.equal(await memo.read("s", load), "v1", "nobody waits on the rebuild");
    assert.equal(loads, 2);
    await settle();
    assert.equal(await memo.read("s", load), "v2");
  });

  test("marking a key nobody has read is not an entry", () => {
    const memo = createStaleWhileRevalidateMemo<string>(options(clock().now));
    assert.equal(memo.markStale("s"), false);
    assert.equal(memo.size, 0);
  });

  test("clear empties everything, and a rebuild landing after it is dropped", async () => {
    const { now, tick } = clock();
    const memo = createStaleWhileRevalidateMemo<string>(options(now));
    const loads: ReturnType<typeof deferred<string>>[] = [];
    const load = () => {
      const d = deferred<string>();
      loads.push(d);
      return d.promise;
    };

    const cold = memo.read("s", load);
    loads[0].resolve("v1");
    await cold;
    memo.markStale("s");
    tick(60);
    await memo.read("s", load);
    assert.equal(memo.clear(), 1);

    loads[1].resolve("v2");
    await settle();
    const next = memo.read("s", load);
    assert.equal(loads.length, 3, "a fresh cold read, not the orphaned rebuild");
    loads[2].resolve("v3");
    assert.equal(await next, "v3");
  });
});

describe("the manager read keys and what an invalidation matches on", () => {
  test("a key is the user and the season, and a null season matches every season", async () => {
    const { now } = clock();
    const memo = createReadMemo<number>({ ttlMs: 100, max: 10, now });
    for (const key of [
      managerReadKey("u1", "2026"),
      managerReadKey("u1", "2025"),
      managerReadKey("u2", "2026"),
      managerReadKey("u10", "2026"),
    ]) {
      await memo.read(key, async () => 1);
    }

    assert.equal(memo.forget(managerReadMatcher(["u1"], "2026")), 1);
    assert.equal(memo.size, 3, "another season and another user are untouched");
    assert.equal(
      memo.forget(managerReadMatcher(["u1"], "2026")),
      0,
      "an id that starts with another's is not that user",
    );
    assert.equal(memo.forget(managerReadMatcher(["u1", "u2"], null)), 2);
    assert.equal(memo.size, 1);
    assert.equal(memo.forget(managerReadMatcher([], null)), 0);
  });
});
