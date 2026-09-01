import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AdmissionAbortedError,
  AdmissionTimeoutError,
  DEFAULT_SLEEPER_CONCURRENCY,
  createLimiter,
  isAdmissionAbort,
  isAdmissionRefusal,
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
    // A manager sync's six leagues × eight weeks: nothing that would run in
    // parallel should be serialised by this bound arriving.
    assert.ok(DEFAULT_SLEEPER_CONCURRENCY >= 24);
  });
});

/**
 * Giving up on the *queue*, which is a different thing from giving up on the
 * work.
 *
 * **What this closes.** A queued waiter used to be a bare `resolve` pushed onto
 * an array with no way out of it, so a request the platform had already
 * abandoned could be handed a permit thirty seconds later and spend a pool
 * connection computing an answer with nobody to receive it.
 *
 * Three endings can race — permit, abort, timeout — and the properties below
 * are the ones that make that safe: a cancelled waiter leaves the queue, never
 * runs, never double-settles, and never takes the slot that should have gone to
 * the next real caller. A leaked slot tightens the bound by one; a slot handed
 * to a caller that has stopped waiting loses it outright.
 */
describe("bounded admission", () => {
  test("a free slot is taken synchronously, options or not", async () => {
    // Not an implementation detail: callers start a job and then interact with
    // it in the same turn (release it, count it), so a limiter with room must
    // not defer the work it admits by a microtask.
    const limiter = createLimiter(1);
    let started = false;
    const controller = new AbortController();
    void limiter.run(async () => {
      started = true;
    }, { signal: controller.signal, maxWaitMs: 50 });
    assert.equal(started, true, "fn ran before this line");
  });

  test("an already-aborted caller never starts, even with room", async () => {
    // Refused before the slot is taken: a request whose client has gone should
    // not spend a permit on an answer nobody will receive.
    const limiter = createLimiter(2);
    const controller = new AbortController();
    controller.abort();
    let started = false;

    await assert.rejects(
      limiter.run(async () => {
        started = true;
      }, { signal: controller.signal }),
      (error: unknown) => error instanceof AdmissionAbortedError,
    );
    assert.equal(started, false);
    assert.equal(limiter.stats().active, 0, "and no slot was spent");
  });

  test("an aborted waiter leaves the queue and never runs", async () => {
    const limiter = createLimiter(1);
    const holder = deferred();
    const held = limiter.run(() => holder.promise);
    await tick();

    const controller = new AbortController();
    let started = false;
    const queued = limiter.run(async () => {
      started = true;
    }, { signal: controller.signal });
    await tick();
    assert.equal(limiter.stats().queued, 1);

    controller.abort();
    await assert.rejects(queued, (error: unknown) =>
      error instanceof AdmissionAbortedError,
    );
    assert.equal(limiter.stats().queued, 0, "removed from the queue");

    // And the permit the holder gives back does not go to it.
    holder.resolve("ok");
    await held;
    await tick();
    assert.equal(started, false, "a cancelled waiter never runs");
    assert.equal(limiter.stats().active, 0, "and the slot came back");
  });

  test("a waiter past its budget leaves the queue and never runs", async () => {
    const limiter = createLimiter(1);
    const holder = deferred();
    const held = limiter.run(() => holder.promise);
    await tick();

    let started = false;
    const queued = limiter.run(async () => {
      started = true;
    }, { maxWaitMs: 1 });

    await assert.rejects(queued, (error: unknown) => {
      assert.ok(error instanceof AdmissionTimeoutError);
      assert.equal(error.waitedMs, 1, "the budget is on the error");
      return true;
    });
    assert.equal(limiter.stats().queued, 0);

    holder.resolve("ok");
    await held;
    await tick();
    assert.equal(started, false);
    assert.equal(limiter.stats().active, 0);
  });

  test("the slot goes to the next real waiter, not to a cancelled one", async () => {
    // The failure this guards is a *lost* slot: handed to a caller that has
    // stopped waiting, the permit is neither used nor returned, and the bound
    // tightens by one for the life of the process.
    const limiter = createLimiter(1);
    const holder = deferred();
    const held = limiter.run(() => holder.promise);
    await tick();

    const controller = new AbortController();
    const cancelled = limiter.run(async () => "cancelled", {
      signal: controller.signal,
    });
    const next = deferred();
    let nextStarted = false;
    const survivor = limiter.run(async () => {
      nextStarted = true;
      return next.promise;
    });
    await tick();
    assert.equal(limiter.stats().queued, 2);

    controller.abort();
    await assert.rejects(cancelled);
    assert.equal(limiter.stats().queued, 1, "only the survivor is left");

    holder.resolve("ok");
    await held;
    await tick();
    assert.equal(nextStarted, true, "the freed slot reached the next in line");

    next.resolve("ok");
    assert.equal(await survivor, "ok");
    assert.equal(limiter.stats().active, 0);
  });

  test("an abort racing the permit does not double-settle", async () => {
    // The window: `release` shifts a waiter and grants it synchronously, and an
    // abort can fire in the same turn. Cleanup is idempotent, so the second of
    // the two is a no-op rather than an unhandled rejection over a running job.
    const limiter = createLimiter(1);
    const holder = deferred();
    const held = limiter.run(() => holder.promise);
    await tick();

    const controller = new AbortController();
    const gate = deferred();
    const queued = limiter.run(() => gate.promise, {
      signal: controller.signal,
    });
    await tick();

    // Release and abort in one synchronous turn, in that order.
    holder.resolve("ok");
    await held;
    controller.abort();

    gate.resolve("ran anyway");
    assert.equal(await queued, "ran anyway", "the grant won and stood");
    assert.equal(limiter.stats().active, 0, "and its slot still came back");
  });

  test("cancellation leaks no slots across a burst", async () => {
    // The arithmetic that matters: whatever mixture of grants, aborts and
    // timeouts a burst produces, the limiter admits its full width afterwards.
    const limiter = createLimiter(2);
    const holders = [deferred(), deferred()];
    const held = holders.map((h) => limiter.run(() => h.promise));
    await tick();

    const controller = new AbortController();
    const cancelled = [
      limiter.run(async () => "a", { signal: controller.signal }),
      limiter.run(async () => "b", { maxWaitMs: 1 }),
      limiter.run(async () => "c", { signal: controller.signal }),
    ];
    await tick();
    controller.abort();
    await Promise.allSettled(cancelled);
    await new Promise((resolve) => setTimeout(resolve, 5));

    holders.forEach((h) => h.resolve("ok"));
    await Promise.all(held);
    await tick();

    assert.equal(limiter.stats().active, 0);
    assert.equal(limiter.stats().queued, 0);
    assert.ok(limiter.tryAcquire(), "still admits");
    assert.ok(limiter.tryAcquire(), "at its full width");
    assert.equal(limiter.tryAcquire(), null, "and no wider");
  });

  test("a caller with a budget it never reaches is unaffected", async () => {
    // The common case: a slot is free, so the budget is never consulted and no
    // timer outlives the call.
    const limiter = createLimiter(1);
    assert.equal(await limiter.run(async () => "ok", { maxWaitMs: 1 }), "ok");
    assert.equal(limiter.stats().active, 0);
  });

  test("no options means wait as long as it takes", async () => {
    // What every background loop wants: nothing is holding a response open, so
    // shedding would only lose work nobody was waiting on.
    const limiter = createLimiter(1);
    const holder = deferred();
    const held = limiter.run(() => holder.promise);
    const queued = limiter.run(async () => "eventually");

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(limiter.stats().queued, 1, "still waiting, not shed");

    holder.resolve("ok");
    await held;
    assert.equal(await queued, "eventually");
  });
});

describe("recognising an admission refusal", () => {
  test("both refusals are refusals; an ordinary failure is not", () => {
    assert.equal(isAdmissionRefusal(new AdmissionAbortedError()), true);
    assert.equal(isAdmissionRefusal(new AdmissionTimeoutError(5)), true);
    assert.equal(isAdmissionRefusal(new Error("boom")), false);
    assert.equal(isAdmissionRefusal(null), false);
    assert.equal(isAdmissionRefusal("AdmissionTimeoutError"), false);
  });

  test("only the abort is the client-went-away half", () => {
    // The two want different log volumes: a timeout says the budget is being
    // hit, an abort says a navigation happened. Only the response is shared.
    assert.equal(isAdmissionAbort(new AdmissionAbortedError()), true);
    assert.equal(isAdmissionAbort(new AdmissionTimeoutError(5)), false);
  });

  test("matched by name, so a structured clone still reads as one", () => {
    // A caller classifying a refusal matches these by `name` rather than by
    // class, to stay free of runtime imports; this pins the names it reads.
    assert.equal(new AdmissionAbortedError().name, "AdmissionAbortedError");
    assert.equal(new AdmissionTimeoutError(1).name, "AdmissionTimeoutError");
  });
});
