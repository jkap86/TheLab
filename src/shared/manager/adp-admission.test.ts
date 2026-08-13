import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { createLimiter } from "../sleeper/limiter.ts";
import { TtlPromiseCache } from "../util/ttl-promise-cache.ts";
import {
  DEFAULT_ADP_COMPUTE_CONCURRENCY,
  adpComputeConcurrency,
} from "./adp-admission.ts";

/**
 * What the limiter buys the ADP reads, asserted as the two numbers that matter:
 * how many cold computations run at once, and how many times the underlying
 * computation runs at all.
 *
 * The cache and the limiter are each tested on their own next door
 * (`ttl-promise-cache.test.ts`, `sleeper/limiter.test.ts`); what is pinned here
 * is the **composition**, because that is where this is easy to get wrong and
 * impossible to see. Wrap the public read instead of the loader and cache hits
 * queue behind cold boards; wrap outside the cache and same-key coalescing pays
 * for a slot per caller; hold the slot across the `pool.query` a caller already
 * owns and the bound becomes the pool exhaustion it exists to prevent. None of
 * the three is a type error and all three read as correct.
 *
 * So these drive `read(key, () => limiter.run(compute))` — the exact shape
 * `getDraftAdp` and `getDraftAdpForPlayers` use — with a compute that reports
 * when it starts and finishes.
 */

/** A compute that resolves only when told, tracking concurrent entries. */
function tracked() {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const releases: Array<(value: { n: number }) => void> = [];

  const compute = () => {
    calls += 1;
    active += 1;
    if (active > peak) peak = active;
    const n = calls;
    return new Promise<{ n: number }>((resolve) => {
      releases.push((value) => {
        active -= 1;
        resolve(value);
      });
    }).then(() => ({ n }));
  };

  return {
    compute,
    /** Cumulative entries into the computation — i.e. how many were admitted. */
    started: () => calls,
    peak: () => peak,
    /** Let the oldest running computation finish. */
    releaseOne: () => releases.shift()?.({ n: 0 }),
    releaseAll: () => {
      while (releases.length > 0) releases.shift()?.({ n: 0 });
    },
  };
}

/** The production composition, at a width a test can drive. */
function admitted(limit: number) {
  const limiter = createLimiter(limit);
  const cache = new TtlPromiseCache<{ n: number }>({
    max: 32,
    ttlMs: 60_000,
    name: "test",
    onOutcome: () => {},
  });
  const work = tracked();
  const read = (key: string) =>
    cache.read(key, () => limiter.run(() => work.compute()));
  return { limiter, cache, work, read };
}

/** Let every pending microtask settle, so admissions have actually happened. */
const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

describe("cold ADP computations are bounded across keys", () => {
  test("ten distinct cold boards run at most three at a time", async () => {
    const { work, read } = admitted(DEFAULT_ADP_COMPUTE_CONCURRENCY);

    // Well past the limit, and every one of them a legitimately different board:
    // a season here, a window there, a league-rule set that resolved elsewhere.
    // The cache has no reason to fold any of them together, which is precisely
    // the burst it cannot protect the pool from on its own.
    const readers = Array.from({ length: 10 }, (_, i) => read(`board-${i}`));
    await flush();

    assert.equal(work.started(), 3, "only the limit is admitted");
    assert.ok(
      work.peak() <= DEFAULT_ADP_COMPUTE_CONCURRENCY,
      `peak ${work.peak()} exceeded the limit`,
    );

    // Draining is not one-shot: each freed slot is handed to the next waiter,
    // which then has to be released in its turn. Bounded rather than `while`,
    // so a regression that stops admitting is a failed assertion below and not
    // a hung test.
    for (let round = 0; round < 10; round += 1) {
      work.releaseAll();
      await flush();
    }
    await Promise.all(readers);

    assert.equal(work.started(), 10, "every distinct board is still computed");
    assert.ok(
      work.peak() <= DEFAULT_ADP_COMPUTE_CONCURRENCY,
      `peak ${work.peak()} exceeded the limit over the whole drain`,
    );
  });

  test("a queued board starts as soon as one ahead of it finishes", async () => {
    const { work, read } = admitted(3);
    const readers = Array.from({ length: 5 }, (_, i) => read(`board-${i}`));
    await flush();
    assert.equal(work.started(), 3);

    work.releaseOne();
    await flush();
    assert.equal(work.started(), 4, "the freed slot goes to the next in line");

    for (let round = 0; round < 5; round += 1) {
      work.releaseAll();
      await flush();
    }
    await Promise.all(readers);
    assert.equal(work.started(), 5);
  });
});

describe("what the limiter must not slow down", () => {
  test("same-key callers still coalesce onto one computation and one slot", async () => {
    const { limiter, work, read } = admitted(3);

    // Ten readers of the *default* board — the common case, and the one the
    // cache was added for. They must cost one computation and one slot between
    // them, leaving the other two free for genuinely different boards.
    const sameKey = Array.from({ length: 10 }, () => read("default"));
    await flush();

    assert.equal(work.started(), 1, "one computation for ten callers");
    assert.equal(limiter.stats().active, 1, "and one slot, not ten");
    assert.equal(limiter.stats().queued, 0, "so nobody is waiting");

    // Two other boards can therefore still start immediately.
    const others = [read("other-a"), read("other-b")];
    await flush();
    assert.equal(work.started(), 3);

    work.releaseAll();
    await flush();
    const results = await Promise.all(sameKey);
    for (const result of results) {
      assert.deepEqual(result, results[0], "every caller got the one answer");
    }
    await Promise.all(others);
    assert.equal(work.started(), 3, "three boards, three computations");
  });

  test("a cached board is answered without taking a slot", async () => {
    const { limiter, work, read } = admitted(1);

    const first = read("default");
    work.releaseAll();
    await first;
    assert.equal(limiter.stats().active, 0);

    // The single slot is now occupied by a cold board that never finishes.
    const cold = read("cold");
    await flush();
    assert.equal(limiter.stats().active, 1, "the cold board holds the only slot");

    // A hit must not queue behind it. If the limiter wrapped the public read
    // rather than the loader, this would never resolve.
    const hit = await Promise.race([
      read("default"),
      new Promise((resolve) => setImmediate(() => resolve("blocked"))),
    ]);
    assert.deepEqual(hit, { n: 1 }, "the cached answer came straight back");
    assert.equal(work.started(), 2, "and nothing was recomputed");

    work.releaseAll();
    await cold;
  });
});

describe("a failed computation gives its slot back", () => {
  test("a rejection admits the work queued behind it", async () => {
    const limiter = createLimiter(2);
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
      onOutcome: () => {},
    });

    let started = 0;
    const gates: Array<{
      resolve: (v: { n: number }) => void;
      reject: (e: unknown) => void;
    }> = [];
    const read = (key: string) =>
      cache.read(key, () =>
        limiter.run(() => {
          started += 1;
          return new Promise<{ n: number }>((resolve, reject) => {
            gates.push({ resolve, reject });
          });
        }),
      );

    // Both slots occupied, a third waiting.
    const a = read("a");
    const b = read("b");
    const c = read("c");
    await flush();
    assert.equal(started, 2);
    assert.equal(limiter.stats().queued, 1);

    // One of the running computations fails — a statement timeout, a pool that
    // had no room. Its slot must come back, or the cap tightens by one per
    // database blip until it admits nobody at all.
    gates[0].reject(new Error("statement timeout"));
    await assert.rejects(a, /statement timeout/);
    await flush();

    assert.equal(started, 3, "the queued board was admitted");
    assert.equal(limiter.stats().active, 2, "and the bound still holds");
    assert.equal(cache.size, 0, "the failure was not cached");

    gates[1].resolve({ n: 2 });
    gates[2].resolve({ n: 3 });
    await Promise.all([b, c]);
    assert.equal(limiter.stats().active, 0, "every slot is back");

    // And the failed key is retryable rather than wedged.
    const retry = read("a");
    await flush();
    gates[3].resolve({ n: 4 });
    assert.deepEqual(await retry, { n: 4 });
  });

  test("a synchronous throw releases the slot too", async () => {
    const limiter = createLimiter(1);
    const cache = new TtlPromiseCache<{ n: number }>({
      max: 8,
      ttlMs: 60_000,
      name: "test",
      onOutcome: () => {},
    });

    await assert.rejects(
      cache.read("a", () =>
        limiter.run(() => {
          throw new Error("bad filters");
        }),
      ),
      /bad filters/,
    );
    assert.equal(limiter.stats().active, 0, "the slot did not leak");

    const ok = await cache.read("b", () => limiter.run(async () => ({ n: 1 })));
    assert.deepEqual(ok, { n: 1 });
  });
});

describe("the reads are wired to it", () => {
  /**
   * `./adp.ts` cannot be imported here — it pulls in the pool, which is the bar
   * every tested module in this package keeps — so the one thing the tests above
   * cannot reach is whether the production reads use this composition at all.
   * Nothing in the type system says they must: dropping the `run` wrapper leaves
   * two working, cached, coalescing reads with no bound on cold keys, which is
   * exactly the state this whole file exists to prevent and is invisible in
   * review. Pinned against the source, the way `app/fonts` pins its own and
   * `trades/sql` pins an expression against the migration that indexes it.
   */
  const source = readFileSync(new URL("./adp.ts", import.meta.url), "utf8");

  for (const [cache, compute] of [
    ["boardResultCache", "computeDraftAdp("],
    ["boardCache", "computeDraftAdpForPlayers("],
  ] as const) {
    test(`${compute.slice(0, -1)} runs inside the admission`, () => {
      const from = source.indexOf(`${cache}.read(`);
      assert.ok(from >= 0, `${cache}.read( not found — was it renamed?`);

      const call = source.slice(from);
      const admission = call.indexOf("adpComputeAdmission.run(");
      const invocation = call.indexOf(compute);

      assert.ok(admission >= 0, `${cache}'s loader does not admit`);
      assert.ok(
        admission < invocation,
        `${compute} is invoked outside the admission`,
      );
    });
  }

  test("the admission is inside the cache loader, never around the read", () => {
    // The placement is the whole design: outside, a hit waits for a slot and
    // ten callers of one board spend ten of them. Both spellings compile.
    assert.doesNotMatch(
      source.replace(/\s+/g, " "),
      /adpComputeAdmission\.run\([^)]*(?:boardResultCache|boardCache)\.read\(/,
      "the limiter must wrap the loader, not the cached read",
    );
  });
});

describe("the configured limit", () => {
  test("defaults to three", () => {
    assert.equal(adpComputeConcurrency({}), 3);
    assert.equal(adpComputeConcurrency({}), DEFAULT_ADP_COMPUTE_CONCURRENCY);
  });

  test("ADP_COMPUTE_LIMIT overrides it", () => {
    assert.equal(adpComputeConcurrency({ ADP_COMPUTE_LIMIT: "5" }), 5);
    assert.equal(adpComputeConcurrency({ ADP_COMPUTE_LIMIT: " 2 " }), 2);
  });

  test("junk falls back rather than failing the boot", () => {
    // A typo in a dashboard must not be why the ADP board stops answering, and
    // a zero or a negative would be a cap that admits nobody.
    for (const value of ["", "  ", "three", "0", "-1", "2.5"]) {
      assert.equal(
        adpComputeConcurrency({ ADP_COMPUTE_LIMIT: value }),
        DEFAULT_ADP_COMPUTE_CONCURRENCY,
        `"${value}" should fall back`,
      );
    }
  });
});
