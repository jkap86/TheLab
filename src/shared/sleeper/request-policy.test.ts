import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isAdmissionRefusal } from "./limiter.ts";
import {
  BACKGROUND_SLEEPER_POLICY,
  INTERACTIVE_REQUEST_BUDGET_MS,
  INTERACTIVE_SLEEPER_POLICY,
  SleeperBudgetExhaustedError,
  currentSleeperPolicy,
  isInteractive,
  ladderBudgetMs,
  queueBudgetMs,
  remainingRequestBudgetMs,
  requestBudgetExhausted,
  requestBudgetOverdueMs,
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

describe("the interactive scope mints one budget for the whole request", () => {
  test("entering it stamps an absolute deadline", () => {
    const at = 1_000_000;
    const policy = withInteractiveSleeper(
      () => currentSleeperPolicy()!,
      { now: () => at },
    );
    assert.equal(policy.expiresAt, at + INTERACTIVE_REQUEST_BUDGET_MS);
    assert.equal(policy.requestClass, "interactive");
  });

  test("a nested interactive scope inherits it rather than minting a second", () => {
    // The failure this closes is a handler that wraps twice — or a helper that
    // wraps defensively inside one that already had — quietly getting twelve
    // seconds per wrap, which is the multiplication the budget exists to stop.
    const at = 1_000_000;
    const inner = withInteractiveSleeper(
      () =>
        withInteractiveSleeper(() => currentSleeperPolicy()!, {
          now: () => at + 9_000,
        }),
      { now: () => at },
    );
    assert.equal(inner.expiresAt, at + INTERACTIVE_REQUEST_BUDGET_MS);
  });

  test("re-entering interactive from inside background mints a fresh one", () => {
    // Nothing in the app does this today, and the answer has to be *some*
    // budget rather than none: a background scope carries no deadline to
    // inherit, so the honest reading of "this part answers a reader" is a
    // reader's budget starting now.
    const at = 1_000_000;
    const policy = withInteractiveSleeper(
      () =>
        withBackgroundSleeper(() =>
          withInteractiveSleeper(() => currentSleeperPolicy()!, {
            now: () => at + 5_000,
          }),
        ),
      { now: () => at },
    );
    assert.equal(policy.expiresAt, at + 5_000 + INTERACTIVE_REQUEST_BUDGET_MS);
  });

  test("the background scope carries no deadline at all", () => {
    const policy = withInteractiveSleeper(
      () => withBackgroundSleeper(() => currentSleeperPolicy()!),
      { now: () => 1_000_000 },
    );
    assert.equal(policy.expiresAt, undefined);
    assert.equal(policy.signal, undefined);
  });

  test("the whole-request budget is the per-ladder one, and says so", () => {
    // If these two ever diverge it should be because somebody decided they
    // should: a request budget *smaller* than one ladder would make a single
    // cold read unable to finish, and a much larger one would put the
    // multiplication back.
    assert.equal(INTERACTIVE_REQUEST_BUDGET_MS, INTERACTIVE_SLEEPER_POLICY.deadlineMs);
    const { maxWaitMs } = INTERACTIVE_SLEEPER_POLICY;
    assert.ok(maxWaitMs !== undefined);
    // Heroku's router gives up at thirty seconds; the worst case a handler can
    // spend on Sleeper is now one queue budget plus the whole request budget.
    assert.ok(maxWaitMs + INTERACTIVE_REQUEST_BUDGET_MS <= 20_000);
  });
});

describe("what is left of a request's budget", () => {
  const at = 1_000_000;
  const interactive = { ...INTERACTIVE_SLEEPER_POLICY, expiresAt: at + 12_000 };

  test("a policy with no deadline has an infinite remainder", () => {
    assert.equal(remainingRequestBudgetMs(BACKGROUND_SLEEPER_POLICY, at), Infinity);
    assert.equal(requestBudgetExhausted(BACKGROUND_SLEEPER_POLICY, at), false);
    assert.equal(requestBudgetOverdueMs(BACKGROUND_SLEEPER_POLICY, at), 0);
  });

  test("the remainder never goes negative; overdue is where that goes", () => {
    assert.equal(remainingRequestBudgetMs(interactive, at + 20_000), 0);
    assert.equal(requestBudgetExhausted(interactive, at + 20_000), true);
    assert.equal(requestBudgetOverdueMs(interactive, at + 20_000), 8_000);
  });

  test("both budgets are the smaller of the class's and the request's", () => {
    // Early: the class binds, because there is more request left than either
    // of its own ceilings.
    assert.equal(queueBudgetMs(interactive, at), INTERACTIVE_SLEEPER_POLICY.maxWaitMs);
    assert.equal(ladderBudgetMs(interactive, at), 12_000);
    // Late: the request binds, on both.
    assert.equal(queueBudgetMs(interactive, at + 10_000), 2_000);
    assert.equal(ladderBudgetMs(interactive, at + 10_000), 2_000);
  });

  test("a background policy is bounded by neither", () => {
    assert.equal(queueBudgetMs(BACKGROUND_SLEEPER_POLICY, at), undefined);
    assert.equal(ladderBudgetMs(BACKGROUND_SLEEPER_POLICY, at), undefined);
  });

  test("a deadline on a policy with no class ceilings still binds", () => {
    // A background-shaped policy handed a request deadline — which is what a
    // caller passing `expiresAt` explicitly would produce — must be bounded by
    // it rather than falling through to "as long as it takes".
    const bounded = { ...BACKGROUND_SLEEPER_POLICY, expiresAt: at + 3_000 };
    assert.equal(queueBudgetMs(bounded, at), 3_000);
    assert.equal(ladderBudgetMs(bounded, at), 3_000);
  });

  test("`resolveSleeperPolicy` carries the deadline through an override", () => {
    // The line this merge is most dangerous to forget: a read that overrode any
    // one field would otherwise come out with no request deadline at all.
    const resolved = resolveSleeperPolicy({ retries: 0 }, interactive);
    assert.equal(resolved.expiresAt, interactive.expiresAt);
    assert.equal(resolved.retries, 0);
  });

  test("and lets a caller state one where the scope has none", () => {
    const resolved = resolveSleeperPolicy(
      { expiresAt: at + 500 },
      BACKGROUND_SLEEPER_POLICY,
    );
    assert.equal(ladderBudgetMs(resolved, at), 500);
  });
});

describe("a spent budget is an admission refusal", () => {
  test("`isAdmissionRefusal` classifies it", () => {
    // What the routes turn into a 503, and the reason the name is in
    // `limiter.ts`'s set: to a caller it means the same thing every other
    // refusal means, which is that no request was made.
    assert.equal(isAdmissionRefusal(new SleeperBudgetExhaustedError(4)), true);
    assert.equal(isAdmissionRefusal(new Error("upstream")), false);
  });

  test("it says how far past the deadline it was", () => {
    const error = new SleeperBudgetExhaustedError(1_250, "the NFL state");
    assert.equal(error.name, "SleeperBudgetExhaustedError");
    assert.equal(error.overdueMs, 1_250);
    assert.match(error.message, /1250ms before the NFL state/);
  });
});
