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
  INTERACTIVE_REQUEST_BUDGET_MS,
  INTERACTIVE_SLEEPER_POLICY,
  SleeperBudgetExhaustedError,
  withBackgroundSleeper,
  withInteractiveSleeper,
  withSleeperRequests,
} from "./request-policy.ts";
import { awaitShared, waitForShared } from "./shared-wait.ts";

/**
 * The seam between a producer's lifetime and a caller's patience.
 *
 * **Every failure here is invisible in production**, which is why the two cases
 * are written as the two directions rather than as one. A background-first
 * promise that an interactive caller joins makes a *page* wait out a crawl
 * tick's ladder — the page is slow, nothing errors, and the request policy that
 * was supposed to bound it is in force the whole time. An interactive-first
 * promise that a background caller joins makes a *sync* give up after twelve
 * seconds on work nothing else retries — the corpus is thin, nothing errors,
 * and again every module is doing what it says.
 */

/** Let queued continuations run. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("waitForShared — a caller's patience, not the producer's lifetime", () => {
  test("an unbounded caller simply gets the producer", async () => {
    const producer = Promise.resolve("board");
    // Identity rather than a wrapper: a background caller pays nothing at all
    // for a mechanism it never uses.
    assert.equal(waitForShared(producer, {}), producer);
    assert.equal(await producer, "board");
  });

  test("a bounded caller stops at its own deadline", async () => {
    const held = deferred<string>();
    let settled = false;
    void held.promise.then(() => {
      settled = true;
    });

    await assert.rejects(
      waitForShared(held.promise, { expiresAt: Date.now() + 15 }),
      (error: unknown) => error instanceof SleeperBudgetExhaustedError,
    );

    // **And the producer is untouched**, which is the property the whole design
    // turns on: it is still running, and it still lands for everyone else.
    assert.equal(settled, false);
    held.resolve("board");
    assert.equal(await held.promise, "board");
  });

  test("a deadline already past rejects without arming a timer", async () => {
    const held = deferred<string>();
    await assert.rejects(
      waitForShared(held.promise, { expiresAt: Date.now() - 5_000 }),
      (error: unknown) =>
        error instanceof SleeperBudgetExhaustedError && error.overdueMs >= 4_000,
    );
    held.resolve("unused");
  });

  test("a caller that walked away leaves no unhandled rejection", async () => {
    // The bookkeeping this module exists to get right in one place. A waiter
    // that timed out and a producer that later fails are both ordinary; a
    // producer whose rejection nobody is left holding takes the process down.
    const held = deferred<string>();
    const rejections: unknown[] = [];
    const onUnhandled = (error: unknown) => rejections.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      await assert.rejects(
        waitForShared(held.promise, { expiresAt: Date.now() + 10 }),
        (error: unknown) => error instanceof SleeperBudgetExhaustedError,
      );
      held.reject(new Error("upstream"));
      // Two macrotask turns: Node reports an unhandled rejection at the end of
      // the turn after the one it was rejected in.
      await tick();
      await tick();
      assert.deepEqual(rejections, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("a rejection still reaches every caller that is still waiting", async () => {
    // The other half of the same line: handling the rejection to keep Node
    // quiet must not swallow it for anybody.
    const held = deferred<string>();
    const waiting = waitForShared(held.promise, {
      expiresAt: Date.now() + 5_000,
    });
    held.reject(new Error("upstream"));
    await assert.rejects(waiting, /upstream/);
  });

  test("an abort ends the wait and not the producer", async () => {
    const held = deferred<string>();
    const controller = new AbortController();
    const waiting = waitForShared(held.promise, { signal: controller.signal });
    controller.abort();
    await assert.rejects(
      waiting,
      (error: unknown) => error instanceof AdmissionAbortedError,
    );
    held.resolve("board");
    assert.equal(await held.promise, "board");
  });

  test("an already-aborted caller never waits at all", async () => {
    const held = deferred<string>();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      waitForShared(held.promise, { signal: controller.signal }),
      (error: unknown) => error instanceof AdmissionAbortedError,
    );
    held.resolve("board");
  });
});

describe("awaitShared — the wait is the ambient policy's", () => {
  test("a background caller waits as long as the producer takes", async () => {
    const held = deferred<string>();
    const waiting = withBackgroundSleeper(() => awaitShared(held.promise));
    // Far longer than an interactive caller would have lasted.
    await new Promise((resolve) => setTimeout(resolve, 40));
    let done = false;
    void waiting.then(() => {
      done = true;
    });
    await tick();
    assert.equal(done, false, "still waiting, not refused");
    held.resolve("board");
    assert.equal(await waiting, "board");
  });

  test("an interactive caller waits only what its request has left", async () => {
    const held = deferred<string>();
    const started = Date.now();
    await assert.rejects(
      withSleeperRequests(
        { ...INTERACTIVE_SLEEPER_POLICY, expiresAt: started + 20 },
        () => awaitShared(held.promise),
      ),
      (error: unknown) => error instanceof SleeperBudgetExhaustedError,
    );
    assert.ok(Date.now() - started < 1_000, "gave up on its own clock");
    held.resolve("board");
  });

  test("outside every scope, the producer is handed back untouched", async () => {
    const producer = Promise.resolve(1);
    assert.equal(awaitShared(producer), producer);
  });
});

/**
 * The two directions, driven through the whole composition rather than through
 * `waitForShared` alone: a limiter, the real policy resolution, a getter that
 * records what it was told, and a cache that holds the promise.
 */
describe("a shared producer and two classes of waiter", () => {
  /** A one-entry promise cache, which is every Sleeper cache in this app. */
  function sharedCache<T>(produce: () => Promise<T>) {
    let entry: Promise<T> | null = null;
    let produced = 0;
    return {
      get produced() {
        return produced;
      },
      read(): Promise<T> {
        if (!entry) {
          produced += 1;
          // The producer half: **a background scope, whoever calls first**. It
          // is what makes the ladder, the retries and the cancellation belong
          // to nobody in particular.
          entry = withBackgroundSleeper(produce);
        }
        // The waiter half: bounded by whoever is asking.
        return awaitShared(entry);
      },
    };
  }

  /** An HTTP getter that never answers, and records the budget it was given. */
  function hangingGet() {
    const calls: { deadlineMs?: number; retries?: number; timeoutMs?: number }[] =
      [];
    const get: SleeperHttpGet = <T>(
      _url: string,
      options: { deadlineMs?: number; retries?: number; timeoutMs?: number },
    ): Promise<{ data: T }> => {
      calls.push(options);
      return new Promise<{ data: T }>(() => {});
    };
    return { calls, get };
  }

  test("Case A — background starts, interactive joins", async () => {
    const { calls, get } = hangingGet();
    const request = createSleeperRequest(createLimiter(4), get);
    const cache = sharedCache(() => request<string>("https://sleeper.test/state"));

    // The crawl tick gets there first and its read runs on the background
    // ladder, as it should.
    const background = withBackgroundSleeper(() => cache.read());
    void background.catch(() => {});
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.timeoutMs, BACKGROUND_SLEEPER_POLICY.timeoutMs);
    assert.equal(calls[0]?.retries, BACKGROUND_SLEEPER_POLICY.retries);
    assert.equal(calls[0]?.deadlineMs, undefined, "a loop's ladder is unbounded");

    // A page arrives and joins it. It must not inherit two minutes of ladder.
    const started = Date.now();
    await assert.rejects(
      withSleeperRequests(
        { ...INTERACTIVE_SLEEPER_POLICY, expiresAt: started + 25 },
        () => cache.read(),
      ),
      (error: unknown) => error instanceof SleeperBudgetExhaustedError,
    );
    const waited = Date.now() - started;
    assert.ok(waited < 1_000, `interactive waited ${waited}ms, not the ladder`);

    // Deduplicated: one producer, and the interactive caller giving up did not
    // start a second one…
    assert.equal(cache.produced, 1);
    assert.equal(calls.length, 1);
    // …nor cancel the first, which is still in flight for the loop that needs
    // it. (Nothing resolves it here; the point is that nothing ended it.)
    let backgroundSettled = false;
    void background.then(
      () => {
        backgroundSettled = true;
      },
      () => {
        backgroundSettled = true;
      },
    );
    await tick();
    assert.equal(backgroundSettled, false);
  });

  test("Case B — interactive starts, background joins", async () => {
    const { calls, get } = hangingGet();
    const request = createSleeperRequest(createLimiter(4), get);
    const cache = sharedCache(() => request<string>("https://sleeper.test/state"));

    // A page gets there first. **What reaches Sleeper is still the background
    // ladder**, because the producer is scoped rather than inherited — that is
    // the half of the split a waiter-only fix would not give.
    const started = Date.now();
    const reader = withSleeperRequests(
      { ...INTERACTIVE_SLEEPER_POLICY, expiresAt: started + 25 },
      () => cache.read(),
    );
    void reader.catch(() => {});
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.timeoutMs, BACKGROUND_SLEEPER_POLICY.timeoutMs);
    assert.equal(calls[0]?.deadlineMs, undefined);

    // The reader gives up on its own clock.
    await assert.rejects(
      reader,
      (error: unknown) => error instanceof SleeperBudgetExhaustedError,
    );

    // And the sync that joined is *not* refused with them: it is still waiting,
    // on work that is still running, with no interactive lifetime anywhere in
    // sight.
    const sync = withBackgroundSleeper(() => cache.read());
    let syncSettled = false;
    void sync.then(
      () => {
        syncSettled = true;
      },
      () => {
        syncSettled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(syncSettled, false, "durable work kept waiting");
    assert.equal(cache.produced, 1, "and joined rather than re-fetching");
    void sync.catch(() => {});
  });

  test("a signal a reader's scope carries never reaches the producer", async () => {
    // The other way an interactive caller can end a shared promise for
    // everybody, and the reason the producer scope is `withBackgroundSleeper`
    // rather than a bare policy object: that scope drops the ambient signal.
    const { calls, get } = hangingGet();
    const request = createSleeperRequest(createLimiter(4), get);
    const cache = sharedCache(() => request<string>("https://sleeper.test/state"));
    const controller = new AbortController();

    const reader = withInteractiveSleeper(() => cache.read(), {
      signal: controller.signal,
    });
    void reader.catch(() => {});
    await tick();

    const passed = calls[0] as { signal?: AbortSignal };
    assert.equal(passed.signal, undefined, "the producer carries no signal");

    controller.abort();
    await assert.rejects(
      reader,
      (error: unknown) => error instanceof AdmissionAbortedError,
    );
    assert.equal(cache.produced, 1);
  });

  test("the interactive waiter's bound is the request's, not the read's", async () => {
    // A scope minted the ordinary way: the wait must be bounded by what the
    // *request* has left rather than by a fresh per-read ceiling, so a caller
    // that has already spent most of its budget waits only the remainder.
    const held = deferred<string>();
    const at = 1_000_000;
    let clock = at;
    const waiting = withInteractiveSleeper(
      () => awaitShared(held.promise, { now: () => clock }),
      { now: () => at },
    );
    void waiting.catch(() => {});

    // Nine-tenths of the budget gone: what is left is the remainder, not the
    // whole of it again.
    clock = at + INTERACTIVE_REQUEST_BUDGET_MS - 30;
    const second = withSleeperRequests(
      { ...INTERACTIVE_SLEEPER_POLICY, expiresAt: at + INTERACTIVE_REQUEST_BUDGET_MS },
      () => awaitShared(held.promise, { now: () => clock }),
    );
    const started = Date.now();
    await assert.rejects(
      second,
      (error: unknown) => error instanceof SleeperBudgetExhaustedError,
    );
    assert.ok(Date.now() - started < 1_000);
    held.resolve("board");
    assert.equal(await waiting, "board");
  });
});

describe("the limiter's own refusals are unchanged by all of this", () => {
  test("a queue that never comes free is still an admission timeout", async () => {
    const limiter = createLimiter(1);
    const { get } = (() => {
      const g: SleeperHttpGet = <T>(): Promise<{ data: T }> =>
        new Promise<{ data: T }>(() => {});
      return { get: g };
    })();
    const request = createSleeperRequest(limiter, get);
    void limiter.run(() => new Promise<void>(() => {}));
    await tick();

    await assert.rejects(
      request("https://sleeper.test/queued", {
        policy: { ...INTERACTIVE_SLEEPER_POLICY, maxWaitMs: 15 },
      }),
      (error: unknown) => error instanceof AdmissionTimeoutError,
    );
  });
});
