import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AdmissionAbortedError,
  AdmissionTimeoutError,
  createLimiter,
} from "./limiter.ts";
import { createSleeperRequest } from "./request.ts";
import type { SleeperHttpGet } from "./request.ts";
import {
  BACKGROUND_SLEEPER_POLICY,
  INTERACTIVE_SLEEPER_POLICY,
  withBackgroundSleeper,
  withInteractiveSleeper,
} from "./request-policy.ts";

/**
 * The composition `sleeperGet` is: a policy, a permit, a bounded ladder.
 *
 * What is under test is the wiring the review found missing — the limiter has
 * carried `signal` and `maxWaitMs` since it landed, `http.get` has carried
 * `signal`, `timeoutMs` and `retries` since it replaced axios, and the one
 * function every Sleeper call passes through handed neither of them anything.
 * Every failure here is silent in production: a route that queues behind a
 * crawl batch for a minute answers eventually, to a browser that gave up
 * thirty seconds ago, having held a permit and a pooled connection the whole
 * time.
 */

type Recorded = {
  url: string;
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
    deadlineMs?: number;
  };
};

/** An HTTP getter that records what it was told, and answers what it is told to. */
function recorder(answer: () => Promise<unknown> = async () => ({ ok: true })) {
  const calls: Recorded[] = [];
  const get: SleeperHttpGet = async <T>(
    url: string,
    options: Recorded["options"],
  ): Promise<{ data: T }> => {
    calls.push({ url, options });
    return { data: (await answer()) as T };
  };
  return { calls, get };
}

/** Let queued continuations run. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A job the caller ends by hand — for occupying a limiter of one. */
function gate() {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

describe("createSleeperRequest — what reaches the limiter and the ladder", () => {
  test("an interactive read carries a queue budget and a deadline", async () => {
    const { calls, get } = recorder();
    const waits: (number | undefined)[] = [];
    const limiter = createLimiter(4);
    const spy = {
      ...limiter,
      run: <T>(fn: () => Promise<T>, options?: { maxWaitMs?: number }) => {
        waits.push(options?.maxWaitMs);
        return limiter.run(fn, options);
      },
    };

    const request = createSleeperRequest(spy, get);
    await withInteractiveSleeper(() => request("https://sleeper.test/a"));

    assert.deepEqual(waits, [INTERACTIVE_SLEEPER_POLICY.maxWaitMs]);
    assert.equal(calls[0]?.options.timeoutMs, INTERACTIVE_SLEEPER_POLICY.timeoutMs);
    assert.equal(calls[0]?.options.retries, INTERACTIVE_SLEEPER_POLICY.retries);
    assert.equal(calls[0]?.options.deadlineMs, INTERACTIVE_SLEEPER_POLICY.deadlineMs);
  });

  test("a background read carries neither, which is what it always did", async () => {
    const { calls, get } = recorder();
    const waits: (number | undefined)[] = [];
    const limiter = createLimiter(4);
    const spy = {
      ...limiter,
      run: <T>(fn: () => Promise<T>, options?: { maxWaitMs?: number }) => {
        waits.push(options?.maxWaitMs);
        return limiter.run(fn, options);
      },
    };

    const request = createSleeperRequest(spy, get);
    await withBackgroundSleeper(() => request("https://sleeper.test/b"));

    assert.deepEqual(waits, [undefined], "a loop queues as long as it takes");
    assert.equal(calls[0]?.options.timeoutMs, BACKGROUND_SLEEPER_POLICY.timeoutMs);
    assert.equal(calls[0]?.options.retries, BACKGROUND_SLEEPER_POLICY.retries);
    assert.equal(calls[0]?.options.deadlineMs, undefined);
    assert.equal(calls[0]?.options.signal, undefined);
  });

  test("nothing declared is still the background budget", async () => {
    const { calls, get } = recorder();
    const request = createSleeperRequest(createLimiter(2), get);
    await request("https://sleeper.test/c");
    assert.equal(calls[0]?.options.timeoutMs, BACKGROUND_SLEEPER_POLICY.timeoutMs);
    assert.equal(calls[0]?.options.retries, BACKGROUND_SLEEPER_POLICY.retries);
  });

  test("a null body is folded, so `sleeperGet` can hand back its fallback", async () => {
    const { get } = recorder(async () => null);
    const request = createSleeperRequest(createLimiter(2), get);
    assert.equal(await request("https://sleeper.test/none"), null);
  });
});

describe("createSleeperRequest — the queue budget", () => {
  test("an interactive read gives up on a full queue rather than waiting", async () => {
    // The interactive policy's own four seconds, with the clock sped up: what
    // is under test is that a bounded wait *ends*, not what the number is.
    const limiter = createLimiter(1);
    const { calls, get } = recorder();
    const request = createSleeperRequest(limiter, get);

    const blocker = gate();
    void limiter.run(() => blocker.held);
    await tick();

    await assert.rejects(
      request("https://sleeper.test/queued", {
        policy: { ...INTERACTIVE_SLEEPER_POLICY, maxWaitMs: 20 },
      }),
      (error: unknown) => error instanceof AdmissionTimeoutError,
    );
    // And no request was made: a refusal at the queue is a refusal before
    // Sleeper is touched, which is the whole point of bounding the wait rather
    // than the work.
    assert.equal(calls.length, 0);
    blocker.release();
  });

  test("a background read waits for the slot and then runs", async () => {
    const limiter = createLimiter(1);
    const { calls, get } = recorder();
    const request = createSleeperRequest(limiter, get);

    const blocker = gate();
    void limiter.run(() => blocker.held);
    await tick();

    const queued = withBackgroundSleeper(() =>
      request("https://sleeper.test/patient"),
    );
    // Long enough that an interactive read would have given up twice over.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.length, 0, "still queued, not refused");

    blocker.release();
    await queued;
    assert.equal(calls.length, 1);
  });
});

describe("createSleeperRequest — cancellation", () => {
  test("a cancelled interactive read leaves the queue and never reaches Sleeper", async () => {
    const limiter = createLimiter(1);
    const { calls, get } = recorder();
    const request = createSleeperRequest(limiter, get);

    const blocker = gate();
    void limiter.run(() => blocker.held);
    await tick();

    const controller = new AbortController();
    const pending = request("https://sleeper.test/abandoned", {
      policy: "interactive",
      signal: controller.signal,
    });
    await tick();
    assert.equal(limiter.stats().queued, 1);

    controller.abort();
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof AdmissionAbortedError,
    );
    assert.equal(calls.length, 0, "the work was never admitted");
    // The waiter is out of the queue rather than merely rejected: a cancelled
    // caller left behind would be handed a permit it has stopped waiting for.
    assert.equal(limiter.stats().queued, 0);

    blocker.release();
    await tick();
    // And the slot it did not take is still there for the next caller.
    await request("https://sleeper.test/next");
    assert.equal(calls.length, 1);
  });

  test("an already-cancelled read is refused before a slot is taken", async () => {
    const limiter = createLimiter(1);
    const { calls, get } = recorder();
    const request = createSleeperRequest(limiter, get);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      request("https://sleeper.test/gone", {
        policy: "interactive",
        signal: controller.signal,
      }),
      (error: unknown) => error instanceof AdmissionAbortedError,
    );
    assert.equal(calls.length, 0);
    assert.equal(limiter.stats().active, 0, "no permit was spent");
  });

  test("the caller's signal reaches the ladder as well as the queue", async () => {
    // A signal that only ended the queueing would leave a request that had
    // already been admitted running its full ladder for a client that has gone.
    const { calls, get } = recorder();
    const request = createSleeperRequest(createLimiter(2), get);
    const controller = new AbortController();
    await request("https://sleeper.test/x", {
      policy: "interactive",
      signal: controller.signal,
    });
    assert.equal(calls[0]?.options.signal, controller.signal);
  });

  test("durable work started inside a request is not aborted by the browser", async () => {
    // The rule the manager sync, the per-league refresh and the history
    // backfill all rest on. The scope is opened with a reader's signal, the
    // durable call re-enters the background scope, and what reaches Sleeper
    // carries no signal at all — so a disconnect cannot abandon a fan-out whose
    // answer is rows every later reader shares.
    const { calls, get } = recorder();
    const request = createSleeperRequest(createLimiter(2), get);
    const controller = new AbortController();

    await withInteractiveSleeper(
      async () => {
        await withBackgroundSleeper(() => request("https://sleeper.test/sync"));
        controller.abort();
        await withBackgroundSleeper(() =>
          request("https://sleeper.test/sync-after-disconnect"),
        );
      },
      { signal: controller.signal },
    );

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.options.signal, undefined);
    assert.equal(calls[1]?.options.signal, undefined);
    assert.equal(calls[1]?.options.timeoutMs, BACKGROUND_SLEEPER_POLICY.timeoutMs);
    assert.equal(calls[1]?.options.deadlineMs, undefined);
  });

  test("a read in the interactive scope itself does carry the scope's signal", async () => {
    const { calls, get } = recorder();
    const request = createSleeperRequest(createLimiter(2), get);
    const controller = new AbortController();
    await withInteractiveSleeper(() => request("https://sleeper.test/own"), {
      signal: controller.signal,
    });
    assert.equal(calls[0]?.options.signal, controller.signal);
  });
});

describe("createSleeperRequest — the bound the policy must not widen", () => {
  test("the process-wide concurrency guarantee survives the policy wiring", async () => {
    // The limiter's own test proves the semaphore; this proves that routing
    // every read through a policy did not put a path around it. A permit is
    // held for the *whole* call, retries included, which is why the getter is
    // what counts as "in flight".
    const limiter = createLimiter(3);
    let active = 0;
    let peak = 0;
    const get: SleeperHttpGet = async <T>(): Promise<{ data: T }> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: null as T };
    };

    const request = createSleeperRequest(limiter, get);
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        i % 2 === 0
          ? withInteractiveSleeper(() => request(`https://sleeper.test/${i}`))
          : withBackgroundSleeper(() => request(`https://sleeper.test/${i}`)),
      ),
    );

    assert.equal(peak, 3);
    assert.equal(limiter.stats().active, 0, "every permit came back");
    assert.equal(limiter.stats().queued, 0);
  });

  test("a failed read gives its permit back", async () => {
    const limiter = createLimiter(1);
    const get: SleeperHttpGet = async <T>(): Promise<{ data: T }> => {
      throw new Error("upstream");
    };
    const request = createSleeperRequest(limiter, get);
    await assert.rejects(request("https://sleeper.test/boom"));
    assert.equal(limiter.stats().active, 0);
  });
});
