import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_SLEEPER_CONCURRENCY,
  createLimiter,
  sleeperConcurrency,
} from "./limiter.ts";

/**
 * The process-wide bound on Sleeper traffic.
 *
 * What is under test is the property every local concurrency constant in this
 * app fails to give: that the number of requests in flight *across unrelated
 * callers* is bounded. Two manager syncs and a crawl tick each respected their
 * own cap and between them produced three times the fan-out anyone chose; the
 * advisory locks could not help, because they are per manager and these are
 * different managers.
 *
 * The release paths are the other half. A slot leaked on a thrown request is a
 * limiter that tightens by one every time Sleeper times out — which is a matter
 * of hours rather than of theory — and ends up admitting nobody.
 */

/** A job that reports the concurrency it observed and resolves when told to. */
function deferred() {
  let resolve: (value: string) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued continuations run. */
const tick = () => new Promise<void>((r) => setImmediate(r));

describe("createLimiter", () => {
  test("never exceeds the configured concurrency", async () => {
    const limiter = createLimiter(3);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 20 }, deferred);

    const runs = gates.map((gate) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        const value = await gate.promise;
        active -= 1;
        return value;
      }),
    );

    await tick();
    assert.equal(peak, 3, "only three ever started");
    assert.equal(limiter.stats().queued, 17);

    // Release them one at a time; each release admits exactly one more.
    for (const gate of gates) {
      gate.resolve("ok");
      await tick();
      assert.ok(peak <= 3, `peak reached ${peak}`);
    }

    assert.deepEqual(await Promise.all(runs), gates.map(() => "ok"));
    assert.equal(limiter.stats().active, 0);
    assert.equal(limiter.stats().queued, 0);
    assert.equal(limiter.stats().peak, 3);
  });

  test("releases the slot after a success", async () => {
    const limiter = createLimiter(1);
    await limiter.run(async () => "first");
    await limiter.run(async () => "second");
    assert.equal(limiter.stats().active, 0);
  });

  test("releases the slot after a throw", async () => {
    // The failure mode this guards: a limiter that tightens by one per timeout.
    const limiter = createLimiter(2);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        limiter.run(async () => {
          throw new Error("Sleeper timed out");
        }),
      );
    }
    assert.equal(limiter.stats().active, 0);
    assert.equal(limiter.stats().queued, 0);

    // And it still admits its full width afterwards.
    let concurrent = 0;
    const gates = [deferred(), deferred()];
    const runs = gates.map((gate) =>
      limiter.run(async () => {
        concurrent += 1;
        return gate.promise;
      }),
    );
    await tick();
    assert.equal(concurrent, 2);
    gates.forEach((gate) => gate.resolve("ok"));
    await Promise.all(runs);
  });

  test("a rejection does not strand the callers queued behind it", async () => {
    const limiter = createLimiter(1);
    const blocker = deferred();
    const first = limiter.run(() => blocker.promise);
    const second = limiter.run(async () => "after");

    await tick();
    blocker.reject(new Error("boom"));
    await assert.rejects(first);
    assert.equal(await second, "after", "no deadlock behind a failed request");
  });

  test("unrelated callers share one limiter", async () => {
    // The point of the whole module: a crawl tick and two manager syncs are
    // three callers that know nothing about each other, and the bound is on
    // their sum rather than on each.
    const limiter = createLimiter(4);
    let peak = 0;
    let active = 0;
    const gates: ReturnType<typeof deferred>[] = [];

    const caller = (n: number) =>
      Array.from({ length: n }, () => {
        const gate = deferred();
        gates.push(gate);
        return limiter.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await gate.promise;
          active -= 1;
          return "ok";
        });
      });

    const all = [...caller(6), ...caller(6), ...caller(6)];
    await tick();
    assert.equal(peak, 4, "eighteen requests, four in flight");

    gates.forEach((gate) => gate.resolve("ok"));
    await Promise.all(all);
    assert.equal(limiter.stats().peak, 4);
  });

  test("runs in the order callers arrived", async () => {
    // FIFO, so a busy page cannot indefinitely defer a background tick that has
    // been waiting since before it started.
    const limiter = createLimiter(1);
    const order: number[] = [];
    const gate = deferred();

    const first = limiter.run(async () => {
      order.push(0);
      await gate.promise;
    });
    const rest = [1, 2, 3, 4].map((i) =>
      limiter.run(async () => {
        order.push(i);
      }),
    );

    await tick();
    gate.resolve("ok");
    await Promise.all([first, ...rest]);
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
  });

  test("tryAcquire takes a free slot and answers null when there is none", () => {
    const limiter = createLimiter(2);
    const first = limiter.tryAcquire();
    const second = limiter.tryAcquire();
    assert.ok(first);
    assert.ok(second);
    assert.equal(limiter.tryAcquire(), null, "no third slot to take");
    assert.equal(limiter.stats().active, 2);
    assert.equal(limiter.stats().queued, 0, "a declined caller never queues");

    first();
    assert.ok(limiter.tryAcquire(), "a released slot is immediately reusable");
  });

  test("a doubled release does not widen the bound", () => {
    // The opposite of a leak and the worse of the two, because it is permanent:
    // a `finally` reachable on two paths is the ordinary way it happens.
    const limiter = createLimiter(1);
    const release = limiter.tryAcquire();
    assert.ok(release);
    release();
    release();
    release();
    assert.equal(limiter.stats().active, 0);

    assert.ok(limiter.tryAcquire());
    assert.equal(limiter.tryAcquire(), null, "the bound is still one");
  });

  test("tryAcquire cannot steal the slot a waiting run() was handed", async () => {
    // The window this closes: `release` used to decrement and *then* resolve the
    // waiter, so between the two — a synchronous window, since the waiter resumes
    // a microtask later — `active` read below the limit and a non-queueing caller
    // walked straight through, putting limit+1 in flight the moment the waiter
    // woke.
    const limiter = createLimiter(1);
    let concurrent = 0;
    let peak = 0;
    const held = deferred();
    const queued = deferred();

    const first = limiter.run(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await held.promise;
      concurrent -= 1;
      return "first";
    });
    const second = limiter.run(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await queued.promise;
      concurrent -= 1;
      return "second";
    });

    await tick();
    assert.equal(limiter.stats().queued, 1);

    // Resolve the holder and reach for a slot in the same synchronous turn the
    // release happens in.
    held.resolve("ok");
    assert.equal(limiter.tryAcquire(), null, "the slot belongs to the waiter");

    queued.resolve("ok");
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
    assert.equal(peak, 1, `peak reached ${peak}`);
    assert.equal(limiter.stats().active, 0);
    assert.equal(limiter.stats().peak, 1);
  });

  test("declines while a queue is draining, so a waiter is never jumped", async () => {
    const limiter = createLimiter(2);
    const gates = Array.from({ length: 4 }, deferred);
    const runs = gates.map((gate) => limiter.run(() => gate.promise));

    await tick();
    assert.equal(limiter.stats().queued, 2);
    assert.equal(limiter.tryAcquire(), null);

    gates.forEach((gate) => gate.resolve("ok"));
    await Promise.all(runs);
    assert.equal(limiter.stats().active, 0);
    assert.ok(limiter.tryAcquire(), "and admits again once the queue is empty");
  });

  test("a limit below one is still one, not zero", () => {
    // Zero would be a deadlock dressed as a configuration value.
    for (const limit of [0, -3, 0.4]) {
      assert.equal(createLimiter(limit).stats().limit, 1, String(limit));
    }
  });
});

describe("sleeperConcurrency", () => {
  test("defaults when nothing is set", () => {
    assert.equal(sleeperConcurrency({}), DEFAULT_SLEEPER_CONCURRENCY);
  });

  test("reads a positive integer from the environment", () => {
    assert.equal(sleeperConcurrency({ SLEEPER_MAX_CONCURRENCY: " 6 " }), 6);
  });

  test("falls back rather than failing on junk", () => {
    // A typo in a dashboard should not be the reason a process refuses to talk
    // to Sleeper at all.
    for (const value of ["", "lots", "0", "-2", "3.5"]) {
      assert.equal(
        sleeperConcurrency({ SLEEPER_MAX_CONCURRENCY: value }),
        DEFAULT_SLEEPER_CONCURRENCY,
        value,
      );
    }
  });

  test("is above the largest single fan-out any one path takes", () => {
    // The crawler's four leagues × eight weeks: nothing that used to run in
    // parallel should be serialised by this bound arriving.
    assert.ok(DEFAULT_SLEEPER_CONCURRENCY >= 24);
  });
});
