import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { compsReadAdmission } from "../comps/read-admission.ts";
import { adpComputeAdmission } from "../manager/adp-admission.ts";
import { TtlPromiseCache } from "../util/ttl-promise-cache.ts";
import { databaseBudget } from "./budget.ts";
import {
  createHeavyReadAdmission,
  dbHeavyReadAdmission,
  dbHeavyReadCeiling,
  dbHeavyReadConcurrency,
} from "./heavy-admission.ts";

/**
 * The budget Player Comps and ADP spend **between them**.
 *
 * The limiter's own semantics — FIFO, the slot released in a `finally`, a
 * waiter handed a slot that is already counted — belong to `createLimiter` and
 * are asserted in `sleeper/limiter.test.ts`. What is this module's own is the
 * claim that could not be made while there were two limiters: that the total
 * number of expensive database reads in flight across *both* subsystems is
 * bounded, which is the number the pool actually feels.
 *
 * So the tests below deliberately do not assert each subsystem separately. Two
 * caps of three that each hold are exactly the state this replaced, and the
 * regression it exists to catch — six connections held by one cold comps board
 * — passes every per-subsystem assertion there is.
 */

/** A unit of work that reports when it is running, shared across subsystems. */
function fleet() {
  let active = 0;
  let peak = 0;
  let started = 0;
  const releases: Array<() => void> = [];

  const work = () => {
    started += 1;
    active += 1;
    if (active > peak) peak = active;
    // Stamped on entry rather than on release, so a caller's answer identifies
    // *its own* run — the difference between "three boards computed" and "three
    // callers saw whatever the counter had reached by the time they resolved".
    const n = started;
    return new Promise<{ n: number }>((resolve) => {
      releases.push(() => {
        active -= 1;
        resolve({ n });
      });
    });
  };

  return {
    work,
    /** Expensive reads running **right now**, across every subsystem. */
    active: () => active,
    /** The most that were ever running at once — the assertion that matters. */
    peak: () => peak,
    started: () => started,
    releaseOne: () => releases.shift()?.(),
    releaseAll: () => {
      while (releases.length > 0) releases.shift()?.();
    },
  };
}

/** Let every pending microtask settle, so admissions have actually happened. */
const flush = async () => {
  for (let i = 0; i < 16; i += 1) await Promise.resolve();
};

/**
 * The two production shapes, driven against one budget.
 *
 * `comps` is `pool.ts`'s: an admitted read per dataset per season, with no
 * cache in the way of what a test wants to count. `adp` is `adp.ts`'s: the
 * limiter inside a `TtlPromiseCache` loader, so a hit never takes a slot.
 */
function subsystems(limit: number) {
  const admission = createHeavyReadAdmission(limit);
  const work = fleet();
  const boards = new TtlPromiseCache<{ n: number }>({
    max: 32,
    ttlMs: 60_000,
    name: "test-adp",
    onOutcome: () => {},
  });

  return {
    admission,
    work,
    /** One comps season read. */
    comps: () => admission.run(work.work),
    /** One ADP board, cached and coalesced exactly as production does it. */
    adp: (key: string) => boards.read(key, () => admission.run(work.work)),
    /**
     * What `loadAdp` does: resolve the ids the board needs through an admitted
     * read, release that slot, *then* ask ADP — the shape the whole hierarchy
     * rests on.
     */
    compsAdp: async (key: string) => {
      await admission.run(work.work);
      return boards.read(key, () => admission.run(work.work));
    },
  };
}

describe("one budget across comps and ADP", () => {
  test("comps reads alone never exceed it", async () => {
    const { comps, work } = subsystems(3);
    const readers = Array.from({ length: 9 }, () => comps());
    await flush();

    assert.equal(work.started(), 3, "only the budget is admitted");
    for (let round = 0; round < 12; round += 1) {
      work.releaseAll();
      await flush();
    }
    await Promise.all(readers);
    assert.equal(work.started(), 9, "and every read still ran");
    assert.ok(work.peak() <= 3, `peak ${work.peak()} exceeded the budget`);
  });

  test("ADP computations alone never exceed it", async () => {
    const { adp, work } = subsystems(3);
    const boards = Array.from({ length: 9 }, (_, i) => adp(`board-${i}`));
    await flush();

    assert.equal(work.started(), 3);
    for (let round = 0; round < 12; round += 1) {
      work.releaseAll();
      await flush();
    }
    await Promise.all(boards);
    assert.equal(work.started(), 9);
    assert.ok(work.peak() <= 3, `peak ${work.peak()} exceeded the budget`);
  });

  test("comps and ADP together never exceed it — the regression", async () => {
    // The state this replaced: a cold custom board held three comps reads *and*
    // three ADP computations, each subsystem inside its own cap of three, six
    // connections of a pool of ten spent by one reader. Asserting the *total*
    // is the only assertion that fails on that arrangement.
    const { comps, adp, work } = subsystems(3);

    const mixed = [
      ...Array.from({ length: 5 }, () => comps()),
      ...Array.from({ length: 5 }, (_, i) => adp(`board-${i}`)),
    ];
    await flush();

    assert.equal(work.active(), 3, "three expensive reads, not three of each");
    assert.equal(work.started(), 3);

    // And it holds over the whole drain, not just at the start — a bound that
    // only held before anything finished would be an accident of scheduling.
    for (let round = 0; round < 14; round += 1) {
      work.releaseAll();
      await flush();
      assert.ok(
        work.active() <= 3,
        `${work.active()} expensive reads were in flight at once`,
      );
    }
    await Promise.all(mixed);

    assert.equal(work.started(), 10, "every read still ran");
    assert.ok(work.peak() <= 3, `peak ${work.peak()} exceeded the budget`);
  });

  test("a queued read starts as soon as one ahead of it finishes", async () => {
    const { comps, adp, work } = subsystems(2);
    const readers = [comps(), adp("a"), comps(), adp("b")];
    await flush();
    assert.equal(work.started(), 2);

    work.releaseOne();
    await flush();
    assert.equal(work.started(), 3, "the freed slot goes to the next in line");
    assert.equal(work.active(), 2, "and the budget is still full, not exceeded");

    for (let round = 0; round < 6; round += 1) {
      work.releaseAll();
      await flush();
    }
    await Promise.all(readers);
    assert.equal(work.started(), 4);
    assert.equal(work.active(), 0);
  });
});

describe("ADP still works on its own terms", () => {
  test("a board with no comps work beside it takes the whole budget", async () => {
    // The budget is shared, not carved up: nothing reserves capacity for comps,
    // so an ADP-only process is exactly as parallel as it was.
    const { adp, work, admission } = subsystems(3);
    const boards = [adp("a"), adp("b"), adp("c")];
    await flush();
    assert.equal(work.started(), 3);
    assert.equal(admission.stats().queued, 0);

    work.releaseAll();
    await flush();
    const results = await Promise.all(boards);
    assert.equal(new Set(results.map((r) => r.n)).size, 3);
  });

  test("a cached board is answered without taking a slot", async () => {
    const { adp, work, admission } = subsystems(1);
    const first = adp("default");
    work.releaseAll();
    await first;

    // The single slot is now held by a cold comps read that never finishes.
    const cold = adp("cold");
    await flush();
    assert.equal(admission.stats().active, 1);

    const hit = await Promise.race([
      adp("default"),
      new Promise((resolve) => setImmediate(() => resolve("blocked"))),
    ]);
    assert.deepEqual(hit, { n: 1 }, "the cached answer came straight back");

    work.releaseAll();
    await cold;
  });
});

describe("no deadlock where comps asks for ADP", () => {
  test("the production shape completes at a budget of one", async () => {
    // `loadAdp` resolves its ids through an admitted read and *then* calls ADP,
    // which admits for itself. With one slot in the whole process that only
    // terminates because the first slot is given back before the second is
    // asked for — the rule the hierarchy rests on, and the one a future caller
    // is most likely to break by wrapping the ADP call "for consistency".
    const { compsAdp, work } = subsystems(1);
    const board = compsAdp("season-2025");

    for (let round = 0; round < 6; round += 1) {
      work.releaseAll();
      await flush();
    }
    assert.deepEqual(await board, { n: 2 });
  });

  test("even a caller that does nest is served rather than wedged", async () => {
    // The backstop: re-entrant admission passes through on the slot the caller
    // already holds. Without it this hangs forever at a full budget — silently,
    // and only under the load the budget exists to protect against.
    const admission = createHeavyReadAdmission(1);
    const seen: string[] = [];

    const nested = admission.run(async () => {
      seen.push("outer");
      // The mistake: an inner read admitting again from inside a held slot.
      await admission.run(async () => {
        seen.push("inner");
      });
      return "done";
    });

    assert.equal(
      await Promise.race([
        nested,
        new Promise((resolve) => setTimeout(() => resolve("deadlocked"), 50)),
      ]),
      "done",
    );
    assert.deepEqual(seen, ["outer", "inner"]);
    assert.equal(admission.stats().active, 0, "and the slot came back");
  });

  test("nesting three deep at a budget of one still terminates", async () => {
    // The shape the re-entrancy exists for, taken to its limit: with one slot
    // in the whole process, each inner call must ride the outer's rather than
    // queue behind it. Every layer queueing is a deadlock, not a slow page.
    const admission = createHeavyReadAdmission(1);
    const seen: string[] = [];

    const deep = admission.run(async () => {
      seen.push("a");
      return admission.run(async () => {
        seen.push("b");
        return admission.run(async () => {
          seen.push("c");
          return "done";
        });
      });
    });

    assert.equal(
      await Promise.race([
        deep,
        new Promise((resolve) => setTimeout(() => resolve("deadlocked"), 50)),
      ]),
      "done",
    );
    assert.deepEqual(seen, ["a", "b", "c"]);
    assert.equal(admission.stats().active, 0, "and the one slot came back");
  });

  test("a nested read does not spend a second slot", async () => {
    // The other half of re-entrancy: passing through must not *double-count*
    // either, or one logical read holds two of the pool's connections' worth of
    // budget while using one.
    const admission = createHeavyReadAdmission(2);
    let insideBoth = 0;

    const held = admission.run(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            await admission.run(async () => {
              insideBoth = admission.stats().active;
            });
            resolve();
          }, 0);
        }),
    );
    await held;
    assert.equal(insideBoth, 1, "the nested read rode the slot it was inside");
  });
});

describe("slots are given back however the work ends", () => {
  test("a rejection admits what was queued behind it", async () => {
    const admission = createHeavyReadAdmission(2);
    const gates: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    let started = 0;
    const read = () =>
      admission.run(() => {
        started += 1;
        return new Promise<void>((resolve, reject) => {
          gates.push({ resolve: () => resolve(), reject });
        });
      });

    const a = read();
    const b = read();
    const c = read();
    await flush();
    assert.equal(started, 2);
    assert.equal(admission.stats().queued, 1);

    gates[0].reject(new Error("statement timeout"));
    await assert.rejects(a, /statement timeout/);
    await flush();

    assert.equal(started, 3, "the queued read was admitted");
    assert.equal(admission.stats().active, 2, "and the bound still holds");

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all([b, c]);
    assert.equal(admission.stats().active, 0, "every slot is back");
  });

  test("a synchronous throw releases the slot too", async () => {
    const admission = createHeavyReadAdmission(1);
    await assert.rejects(
      admission.run(() => {
        throw new Error("bad filters");
      }),
      /bad filters/,
    );
    assert.equal(admission.stats().active, 0, "the slot did not leak");

    // And the budget still admits, which is what a leak would have ended.
    assert.deepEqual(await admission.run(async () => ({ n: 1 })), { n: 1 });
  });

  test("a rejection inside a nested read releases the outer slot once", async () => {
    const admission = createHeavyReadAdmission(1);
    await assert.rejects(
      admission.run(async () => {
        await admission.run(async () => {
          throw new Error("inner");
        });
      }),
      /inner/,
    );
    assert.equal(admission.stats().active, 0);
    assert.deepEqual(await admission.run(async () => ({ n: 1 })), { n: 1 });
  });
});

describe("the subsystems share the one budget", () => {
  test("both names are the same object", () => {
    // The whole design in one assertion: two names, one counter. Anything that
    // rebuilt either as a limiter of its own would restore the arrangement
    // where each cap held and the pool still emptied.
    assert.equal(compsReadAdmission, dbHeavyReadAdmission);
    assert.equal(adpComputeAdmission, dbHeavyReadAdmission);
    assert.equal(compsReadAdmission, adpComputeAdmission);
  });

  test("no analytical read module builds a limiter of its own", () => {
    // Ownership, pinned against the source: the comps and ADP modules must
    // reach for the shared budget rather than construct a second semaphore.
    // `sync-admission` and `league-refresh` keep their own deliberately — they
    // bound Sleeper fan-outs holding a lock connection, which is a different
    // resource and a different question.
    const files = [
      "../comps/read-admission.ts",
      "../comps/pool.ts",
      "../manager/adp-admission.ts",
      "../manager/adp.ts",
      "../manager/adp-auction.ts",
    ];
    for (const file of files) {
      const source = readFileSync(
        fileURLToPath(new URL(file, import.meta.url)),
        "utf8",
      );
      assert.equal(
        /(?<![\w.])createLimiter\s*\(/.test(source),
        false,
        `${file} builds its own limiter instead of admitting to the budget`,
      );
    }
  });
});

describe("the configured budget", () => {
  test("is the request fan-out share of the pool", () => {
    const env = { DATABASE_POOL_MAX: "12" };
    assert.equal(dbHeavyReadConcurrency(env), databaseBudget(env).fanout);
    assert.equal(dbHeavyReadConcurrency({}), 3, "three on the default pool");
  });

  test("moves with the pool", () => {
    assert.ok(
      dbHeavyReadConcurrency({ DATABASE_POOL_MAX: "30" }) >
        dbHeavyReadConcurrency({ DATABASE_POOL_MAX: "6" }),
    );
  });

  test("never takes the whole pool, however big it is", () => {
    for (const poolMax of ["4", "10", "30", "100"]) {
      const env = { DATABASE_POOL_MAX: poolMax };
      assert.ok(dbHeavyReadConcurrency(env) < databaseBudget(env).poolMax);
    }
  });

  test("DB_HEAVY_READ_LIMIT overrides the derivation", () => {
    assert.equal(
      dbHeavyReadConcurrency({ DATABASE_POOL_MAX: "10", DB_HEAVY_READ_LIMIT: "7" }),
      7,
    );
    // Below the derived default as readily as above it: the clamp is a
    // ceiling, and an operator asking for *less* heavy work still gets it.
    assert.equal(
      dbHeavyReadConcurrency({ DATABASE_POOL_MAX: "10", DB_HEAVY_READ_LIMIT: "2" }),
      2,
    );
  });

  test("the two variables it replaced still configure it", () => {
    // A deployment that had tightened either knob was asking for less heavy
    // work at once, which is exactly what this budget is. Ignoring them on the
    // next deploy would silently widen a bound somebody had narrowed.
    assert.equal(dbHeavyReadConcurrency({ COMPS_READ_LIMIT: "5" }), 5);
    assert.equal(dbHeavyReadConcurrency({ ADP_COMPUTE_LIMIT: "2" }), 2);
  });

  test("the tightest of the legacy names wins", () => {
    // A budget is a ceiling, so the smaller number is the one that still keeps
    // the promise its operator made.
    assert.equal(
      dbHeavyReadConcurrency({ COMPS_READ_LIMIT: "5", ADP_COMPUTE_LIMIT: "2" }),
      2,
    );
    // And the explicit name beats both, so there is one thing to set.
    assert.equal(
      dbHeavyReadConcurrency({
        DB_HEAVY_READ_LIMIT: "6",
        COMPS_READ_LIMIT: "5",
        ADP_COMPUTE_LIMIT: "2",
      }),
      6,
    );
    // Winning the precedence is not the same as escaping the ceiling: an
    // explicit 8 on the default pool is still clamped to 7.
    assert.equal(
      dbHeavyReadConcurrency({
        DB_HEAVY_READ_LIMIT: "8",
        COMPS_READ_LIMIT: "5",
        ADP_COMPUTE_LIMIT: "2",
      }),
      7,
    );
  });

  test("configuration is a request, not a grant", () => {
    // The hole this closes: `DB_HEAVY_READ_LIMIT=10` against a pool of ten let
    // one cold comps board hold every connection the process has — the exact
    // arrangement the shared budget exists to prevent, arrived at through the
    // variable meant to prevent it, with nothing failing to say so.
    const env = { DATABASE_POOL_MAX: "10", DB_HEAVY_READ_LIMIT: "10" };
    assert.equal(dbHeavyReadConcurrency(env), dbHeavyReadCeiling(env));
    assert.equal(dbHeavyReadConcurrency(env), 7, "the pool less a fan-out share");

    // Absurd values are clamped rather than trusted or refused: the operator
    // asked for "as much as possible", and this is what that is.
    assert.equal(
      dbHeavyReadConcurrency({ DATABASE_POOL_MAX: "10", DB_HEAVY_READ_LIMIT: "100" }),
      7,
    );
    assert.equal(
      dbHeavyReadConcurrency({
        DATABASE_POOL_MAX: "10",
        DB_HEAVY_READ_LIMIT: "1000000",
      }),
      7,
    );
  });

  test("the ceiling leaves an ordinary request its full fan-out", () => {
    // The invariant is the existing one reused rather than a second
    // calculation competing with it: `databaseBudget().fanout` is what one
    // foreground request may hold, so reserving exactly that leaves room for
    // one to run at full width while the analytical budget is saturated.
    for (const poolMax of ["2", "3", "4", "10", "12", "30", "100"]) {
      const env = { DATABASE_POOL_MAX: poolMax };
      const { poolMax: pool, fanout } = databaseBudget(env);
      const ceiling = dbHeavyReadCeiling(env);

      assert.ok(ceiling >= 1, `pool ${poolMax}: a zero-width admission queue`);
      assert.ok(
        ceiling <= pool - 1,
        `pool ${poolMax}: heavy reads could take the whole pool`,
      );
      // Never below what the app picks for itself — a clamp arguing with its
      // own default would be a ceiling nobody could raise or lower sensibly.
      assert.ok(ceiling >= fanout, `pool ${poolMax}: the ceiling is under the default`);
    }
  });

  test("the clamp holds however the limit was asked for", () => {
    // The legacy aliases are the same knob under an older name, so a
    // deployment that still sets one cannot buy what the new name refuses.
    for (const name of ["DB_HEAVY_READ_LIMIT", "COMPS_READ_LIMIT", "ADP_COMPUTE_LIMIT"]) {
      const env = { DATABASE_POOL_MAX: "10", [name]: "10" };
      assert.equal(dbHeavyReadConcurrency(env), 7, name);
    }
  });

  test("the derived default is never clamped away", () => {
    // It *is* the reserved share, so on every pool the unconfigured process
    // gets exactly `databaseBudget().fanout` — clamping it would be the app
    // refusing the number it chose for itself.
    for (const poolMax of ["2", "3", "4", "10", "30", "100"]) {
      const env = { DATABASE_POOL_MAX: poolMax };
      assert.equal(dbHeavyReadConcurrency(env), databaseBudget(env).fanout, poolMax);
    }
  });

  test("junk falls back rather than failing the boot", () => {
    // Every one of these would otherwise be a limiter that admits nobody, which
    // is an outage rather than a bound — and a typo in a dashboard must not be
    // why the comps tool stops answering.
    for (const value of ["", "  ", "three", "0", "-1", "-4", "2.5", "NaN", "Infinity"]) {
      assert.equal(
        dbHeavyReadConcurrency({ DB_HEAVY_READ_LIMIT: value }),
        databaseBudget({}).fanout,
        `DB_HEAVY_READ_LIMIT=${value} should fall back`,
      );
      assert.equal(
        dbHeavyReadConcurrency({ COMPS_READ_LIMIT: value, ADP_COMPUTE_LIMIT: "4" }),
        4,
        `a junk alias should not out-tighten a valid one`,
      );
    }
  });

  test("whatever it is configured to, it admits somebody", () => {
    // A zero-width admission queue is the one failure worse than an unbounded
    // one: every heavy read waits forever on a slot nothing can release.
    for (const poolMax of ["2", "3", "10", "30"]) {
      for (const limit of ["", "0", "-4", "junk", "1", "9999"]) {
        const env = { DATABASE_POOL_MAX: poolMax, DB_HEAVY_READ_LIMIT: limit };
        assert.ok(
          dbHeavyReadConcurrency(env) >= 1,
          `pool ${poolMax}, limit "${limit}" admits nobody`,
        );
      }
    }
  });
});

/**
 * A context that outlives its permit.
 *
 * `AsyncLocalStorage` propagates to every async resource created under a
 * callback, *including* ones that run after it returns. A detached descendant —
 * a timer scheduled from inside an admitted read whose callback then resolves —
 * therefore inherits the store while holding nothing, and against a permanent
 * "already admitted" flag would walk straight past the limiter. That is the one
 * way this abstraction could put more heavy reads in flight than the limit, and
 * it would arrive through the mechanism added to prevent a deadlock.
 *
 * Nothing here detaches work from an admitted callback today. This is what
 * keeps a caller that starts to from being a bound that silently isn't one.
 */
describe("a detached descendant cannot ride a released permit", () => {
  /** A promise plus its resolver — a barrier, so nothing here waits on a clock. */
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  test("it queues for a slot of its own, and gets one when the holder lets go", async () => {
    const admission = createHeavyReadAdmission(1);
    const holderRunning = deferred();
    const holderMayFinish = deferred();
    const scheduled = deferred();
    const descendantRan = deferred<string>();
    // A slot on an object rather than a resolved promise: `resolve(aPromise)`
    // *adopts* it, so handing the descendant's own promise through a deferred
    // would make this test wait on the thing it is about to assert is waiting.
    const detached: { run: Promise<string> | null } = { run: null };

    // 1. An admitted operation creates a descendant and returns. The
    //    descendant is *scheduled* here and admitted later, from a context
    //    that inherits the store this slot ran under.
    await admission.run(async () => {
      setTimeout(() => {
        detached.run = admission.run(async () => {
          descendantRan.resolve("ran");
          return "ran";
        });
        scheduled.resolve();
      }, 0);
    });
    // 2. Its permit is back: the outer callback settled, so the limiter's
    //    `finally` has run and the token it left behind is inactive.
    assert.equal(admission.stats().active, 0);

    // 3. Somebody else takes the only slot, and holds it. Synchronously, so no
    //    timer can fire between the assertion above and this line — which is
    //    what makes the ordering deterministic rather than a race.
    const holder = admission.run(async () => {
      holderRunning.resolve();
      await holderMayFinish.promise;
      return "holder";
    });
    await holderRunning.promise;
    assert.equal(admission.stats().active, 1);

    // 4. The descendant now asks to run. It must *wait* — the store it
    //    inherited names a permit that no longer exists.
    await scheduled.promise;
    const descendant = detached.run;
    assert.ok(descendant, "the descendant never asked to run");
    await flush();
    assert.equal(
      await Promise.race([
        descendantRan.promise,
        new Promise((resolve) => setImmediate(() => resolve("waited"))),
      ]),
      "waited",
      "the detached descendant bypassed the limiter",
    );
    assert.equal(admission.stats().queued, 1, "it queued like any other caller");
    assert.equal(admission.stats().active, 1, "and did not exceed the budget");

    // 5. Once the holder lets go, it proceeds.
    holderMayFinish.resolve();
    assert.equal(await holder, "holder");
    assert.equal(await descendant, "ran");
    assert.equal(admission.stats().active, 0);
  });

  test("the budget still holds across a fleet of them", async () => {
    // The counting version of the same claim: four detached descendants of
    // four finished slots are four ordinary callers, so a budget of two admits
    // two at a time — where an inherited flag would have let all four through
    // at once, which is the number the pool feels.
    const admission = createHeavyReadAdmission(2);
    const work = fleet();
    const detached: Array<Promise<{ n: number }>> = [];

    await Promise.all(
      Array.from({ length: 4 }, () =>
        admission.run(async () => {
          setImmediate(() => detached.push(admission.run(work.work)));
        }),
      ),
    );
    assert.equal(admission.stats().active, 0, "every permit went back");

    await flush();
    await new Promise((resolve) => setImmediate(resolve));
    await flush();

    assert.equal(detached.length, 4);
    assert.equal(work.started(), 2, "only the budget is admitted");
    for (let round = 0; round < 8; round += 1) {
      work.releaseAll();
      await flush();
    }
    await Promise.all(detached);
    assert.equal(work.started(), 4, "and all of them still ran");
    assert.ok(work.peak() <= 2, `peak ${work.peak()} exceeded the budget`);
  });

  test("a descendant created *and* run inside a live slot still rides it", async () => {
    // The other side of the same line: deactivation is tied to the permit
    // going back, not to the callback's stack. A timer whose parent is still
    // holding its slot must pass through, or the nesting backstop is gone.
    const admission = createHeavyReadAdmission(1);
    let insideBoth = -1;

    await admission.run(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            await admission.run(async () => {
              insideBoth = admission.stats().active;
            });
            resolve();
          }, 0);
        }),
    );

    assert.equal(insideBoth, 1, "the descendant took a second slot");
    assert.equal(admission.stats().active, 0);
  });
});
