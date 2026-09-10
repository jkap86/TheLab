import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BACKGROUND_SLEEPER_POLICY,
  INTERACTIVE_SLEEPER_POLICY,
  currentSleeperPolicy,
  isInteractive,
  resolveSleeperPolicy,
  withBackgroundSleeper,
  withInteractiveSleeper,
  withSleeperRequests,
} from "./request-policy.ts";

/**
 * Which budget a Sleeper read runs under.
 *
 * Every rule here is silent when it is wrong. A route that resolves to the
 * background policy is as slow as it was before anybody did this work and
 * nothing says so; a *sync* that resolves to the interactive one starts
 * shedding leagues under exactly the crawler pressure it is queued behind,
 * having already stamped `attempt_at`; and an ambient signal that survives into
 * durable work lets one browser navigating away abandon a fan-out other readers
 * are waiting on. None of the three throws, and none of them is visible in a
 * response.
 */

describe("the two policies", () => {
  test("the background policy is what every Sleeper read used to run under", () => {
    // The half of the split that changes nothing, and the reason it is safe to
    // make it the default: 30s per attempt and three retries are
    // `DEFAULT_TIMEOUT_MS` and `DEFAULT_RETRIES`, and no queue bound at all is
    // what `sleeperGet` passed the limiter before it passed anything.
    assert.equal(BACKGROUND_SLEEPER_POLICY.timeoutMs, 30_000);
    assert.equal(BACKGROUND_SLEEPER_POLICY.retries, 3);
    assert.equal(BACKGROUND_SLEEPER_POLICY.maxWaitMs, undefined);
    assert.equal(BACKGROUND_SLEEPER_POLICY.deadlineMs, undefined);
    assert.equal(isInteractive(BACKGROUND_SLEEPER_POLICY), false);
  });

  test("an interactive read cannot outlast the platform's own deadline", () => {
    // The arithmetic that matters, pinned rather than left in a comment: a
    // handler behind Heroku's 30-second router timeout can afford one Sleeper
    // read's worst case *plus* its Postgres reads, its solve and its
    // serialisation. Queue budget and ladder budget are the two terms, and
    // `timeoutMs * (retries + 1)` is deliberately not one of them — the
    // deadline is what stops that product being the answer.
    const { maxWaitMs, deadlineMs, timeoutMs, retries } =
      INTERACTIVE_SLEEPER_POLICY;
    assert.ok(maxWaitMs !== undefined && Number.isFinite(maxWaitMs));
    assert.ok(deadlineMs !== undefined && Number.isFinite(deadlineMs));
    assert.ok(maxWaitMs + deadlineMs <= 20_000, "worst case leaves the route room");
    assert.ok(timeoutMs <= deadlineMs, "an attempt cannot outlast the ladder");
    assert.ok(
      timeoutMs * (retries + 1) > deadlineMs,
      "the deadline binds: the attempts alone would outlast it",
    );
    assert.equal(isInteractive(INTERACTIVE_SLEEPER_POLICY), true);
  });
});

describe("resolveSleeperPolicy", () => {
  test("nothing said is the background policy, not the interactive one", () => {
    // The `processRole` call: the honest answer to "nothing declared" is the
    // behaviour the app already had. Under the other default a background path
    // that lost its declaration would start giving up on work nothing else
    // retries, which is a new failure rather than an old one.
    assert.equal(resolveSleeperPolicy(undefined, undefined), BACKGROUND_SLEEPER_POLICY);
    assert.equal(resolveSleeperPolicy({}, undefined), BACKGROUND_SLEEPER_POLICY);
  });

  test("the ambient scope is the default for the calls under it", () => {
    assert.equal(
      resolveSleeperPolicy(undefined, INTERACTIVE_SLEEPER_POLICY),
      INTERACTIVE_SLEEPER_POLICY,
    );
  });

  test("a named class on the call beats the scope it was made in", () => {
    const resolved = resolveSleeperPolicy(
      { policy: "background" },
      INTERACTIVE_SLEEPER_POLICY,
    );
    assert.equal(resolved, BACKGROUND_SLEEPER_POLICY);
  });

  test("an override moves one field and keeps the rest of its class", () => {
    const resolved = resolveSleeperPolicy(
      { policy: "interactive", maxWaitMs: 25 },
      undefined,
    );
    assert.equal(resolved.requestClass, "interactive");
    assert.equal(resolved.maxWaitMs, 25);
    assert.equal(resolved.timeoutMs, INTERACTIVE_SLEEPER_POLICY.timeoutMs);
    assert.equal(resolved.retries, INTERACTIVE_SLEEPER_POLICY.retries);
    assert.equal(resolved.deadlineMs, INTERACTIVE_SLEEPER_POLICY.deadlineMs);
  });

  test("an explicit undefined cannot erase a policy's own value", () => {
    // Read field by field rather than spread, because `{ ...base, ...options }`
    // would let a caller passing `{ maxWaitMs: undefined }` — which is what
    // every optional argument threaded through a helper looks like — silently
    // unbound the queue on an interactive read.
    const resolved = resolveSleeperPolicy(
      { signal: new AbortController().signal },
      INTERACTIVE_SLEEPER_POLICY,
    );
    assert.equal(resolved.maxWaitMs, INTERACTIVE_SLEEPER_POLICY.maxWaitMs);
    assert.equal(resolved.deadlineMs, INTERACTIVE_SLEEPER_POLICY.deadlineMs);
  });
});

describe("the scopes", () => {
  test("there is no ambient policy outside every scope", () => {
    assert.equal(currentSleeperPolicy(), undefined);
  });

  test("an interactive scope reaches the reads made under it, awaits included", async () => {
    const seen = await withInteractiveSleeper(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentSleeperPolicy();
    });
    assert.equal(seen?.requestClass, "interactive");
    // And it is gone again once the scope is: an `AsyncLocalStorage` that
    // leaked out of `run` would put a route's budget on the next thing this
    // process did.
    assert.equal(currentSleeperPolicy(), undefined);
  });

  test("a background scope inside an interactive one wins", () => {
    withInteractiveSleeper(() => {
      assert.equal(currentSleeperPolicy()?.requestClass, "interactive");
      withBackgroundSleeper(() => {
        assert.equal(currentSleeperPolicy(), BACKGROUND_SLEEPER_POLICY);
      });
      // ...and the outer scope is unharmed on the way back out.
      assert.equal(currentSleeperPolicy()?.requestClass, "interactive");
    });
  });

  test("a background scope drops the reader's signal outright", async () => {
    // The rule the manager sync, the per-league refresh and the history
    // backfill all depend on: a browser disconnecting must not be able to
    // abandon durable work started from inside its request. Dropping the signal
    // is one line and it is the whole of that guarantee.
    const controller = new AbortController();
    const inner = withInteractiveSleeper(
      () => withBackgroundSleeper(() => currentSleeperPolicy()),
      { signal: controller.signal },
    );
    assert.equal(inner?.signal, undefined);
    controller.abort();
    assert.equal(inner?.signal, undefined);
  });

  test("an interactive scope carries a signal only where one was passed", () => {
    assert.equal(
      withInteractiveSleeper(() => currentSleeperPolicy()?.signal),
      undefined,
    );
    const controller = new AbortController();
    assert.equal(
      withInteractiveSleeper(() => currentSleeperPolicy()?.signal, {
        signal: controller.signal,
      }),
      controller.signal,
    );
  });

  test("a scope does not mutate the shared policy objects", () => {
    // `withInteractiveSleeper` copies rather than assigning a signal onto the
    // exported constant — one request's `AbortSignal` written there would be
    // every later request's, including the ones in other scopes.
    const controller = new AbortController();
    withInteractiveSleeper(() => {}, { signal: controller.signal });
    assert.equal(INTERACTIVE_SLEEPER_POLICY.signal, undefined);
  });

  test("two concurrent scopes do not see each other", async () => {
    const [a, b] = await Promise.all([
      withInteractiveSleeper(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentSleeperPolicy()?.requestClass;
      }),
      withSleeperRequests(BACKGROUND_SLEEPER_POLICY, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentSleeperPolicy()?.requestClass;
      }),
    ]);
    assert.equal(a, "interactive");
    assert.equal(b, "background");
  });
});
