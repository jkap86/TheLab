/**
 * Waiting on work somebody else started, under *your* budget rather than
 * theirs.
 *
 * **This is the seam between a producer's lifetime and a caller's patience**,
 * and until it existed the two were one thing. Every in-process Sleeper cache
 * in this app holds the *promise* rather than the answer, deliberately — that
 * is what makes concurrent callers share one request instead of five — and the
 * consequence nobody had spelled out is that whoever created the promise chose
 * the budget for everybody who later awaited it:
 *
 * - a crawl tick starts the NFL-state fetch; a page arrives a moment later,
 *   joins it, and is now behind a ladder of 30s × 4 — two minutes of a request
 *   whose platform deadline is thirty seconds, with nothing in the request's
 *   own policy able to say otherwise;
 * - or a page starts it, a *durable* sync joins, and the sync is now behind a
 *   12-second ladder that will give up on work nothing else retries.
 *
 * Both are the same mistake and neither is visible: the page is slow and the
 * sync is thin, and every module involved is doing exactly what it says.
 *
 * So the two are separated, and the split is one sentence each. **The producer
 * runs under a policy belonging to nobody** — every cache populates itself
 * inside {@link withBackgroundSleeper}, because a value held for the next
 * reader is durable work by definition, and because that scope is the one that
 * drops an ambient signal (a shared promise rejected by one browser navigating
 * away is every other reader's answer gone). **The caller waits only as long as
 * its own request has left**, which is what this module does.
 *
 * **Giving up waiting is not cancelling.** Nothing here aborts, rejects or
 * touches the producer: it goes on running, it goes on filling its cache, and
 * the reader that timed out is simply no longer one of its awaiters. That is
 * the property that makes it safe for an interactive caller to bail out of a
 * fetch a background loop needs.
 *
 * Pure but for the ambient policy, and imported relatively with `.ts` so Node's
 * own runner can drive it — `request.ts`' rule.
 */

import { AdmissionAbortedError } from "./limiter.ts";
import {
  SleeperBudgetExhaustedError,
  currentSleeperPolicy,
  remainingRequestBudgetMs,
  requestBudgetOverdueMs,
} from "./request-policy.ts";
import type { SleeperRequestPolicy } from "./request-policy.ts";

export type SharedWaitOptions = {
  /** Ends the wait early. The producer is untouched. */
  signal?: AbortSignal;
  /**
   * The instant this caller stops waiting, epoch ms. Undefined waits as long
   * as the producer takes, which is what a background caller wants.
   */
  expiresAt?: number;
  /** For a deterministic test; production reads the clock. */
  now?: () => number;
  /** Names the value in the error, e.g. `the NFL state`. */
  label?: string;
};

/**
 * Await `producer`, but no longer than `expiresAt`.
 *
 * Resolves and rejects exactly as `producer` does while there is budget left.
 * Past it, this rejects with {@link SleeperBudgetExhaustedError} — the same
 * refusal `sleeperGet` throws when a request has nothing left to spend, so a
 * caller has one thing to catch and `isAdmissionRefusal` classifies both.
 *
 * **A rejection is always handled here**, whether or not this caller is still
 * listening for it: `producer.catch` marks the original settled-with-a-handler,
 * so a waiter that walked away cannot leave an unhandled rejection behind,
 * while every *other* awaiter still receives it. That is the one bookkeeping
 * detail this file exists to get right in one place rather than at six call
 * sites.
 */
export function waitForShared<T>(
  producer: Promise<T>,
  options: SharedWaitOptions = {},
): Promise<T> {
  const { signal, expiresAt, now = Date.now, label = "a shared Sleeper read" } =
    options;

  const bounded = expiresAt !== undefined && Number.isFinite(expiresAt);
  if (!bounded && !signal) return producer;

  // Attached before anything below can decide to stop waiting. Rejection
  // handling is the whole of it: the derived promise is discarded, the original
  // keeps rejecting for everyone who is still awaiting it, and Node no longer
  // has grounds to call it unhandled.
  void producer.catch(() => {});

  if (signal?.aborted) return Promise.reject(new AdmissionAbortedError());
  const left = bounded ? expiresAt - now() : Infinity;
  if (left <= 0) {
    return Promise.reject(new SleeperBudgetExhaustedError(-left, label));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Idempotent, because the three ways this wait can end can all be racing
    // and a second settle is a listener left on a signal that outlives us.
    const done = (): boolean => {
      if (settled) return false;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      return true;
    };

    function onAbort() {
      if (done()) reject(new AdmissionAbortedError());
    }

    if (Number.isFinite(left)) {
      // **Not `unref`'d**, which is a deliberate reversal of the first
      // spelling: this timer is the thing that *ends* the wait, so a loop that
      // was allowed to drain past it would leave the caller waiting on a
      // producer nothing is going to interrupt. It is bounded by the request's
      // own budget — twelve seconds at the outside — and `http.get`'s own
      // attempt and backoff timers are ref'd for the same reason.
      timer = setTimeout(() => {
        if (done()) reject(new SleeperBudgetExhaustedError(0, label));
      }, left);
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    producer.then(
      (value) => {
        if (done()) resolve(value);
      },
      (error: unknown) => {
        if (done()) reject(error);
      },
    );
  });
}

/**
 * {@link waitForShared} against the policy in force here.
 *
 * The one call sites use: a cache hands over the promise it holds and this
 * bounds the wait by whatever the *current* request has left, which for a
 * background caller is nothing at all and for a reader is the rest of their
 * twelve seconds. One wrap per cache, no plumbing, and the class travels the
 * way every other Sleeper budget in this app travels.
 */
export function awaitShared<T>(
  producer: Promise<T>,
  options: { label?: string; policy?: SleeperRequestPolicy; now?: () => number } = {},
): Promise<T> {
  const policy = options.policy ?? currentSleeperPolicy();
  if (!policy) return producer;
  const now = options.now ?? Date.now;
  // One reading of the clock for the whole decision: two would let the budget
  // shrink between the check and the timer it arms.
  const at = now();
  const remaining = remainingRequestBudgetMs(policy, at);
  if (!Number.isFinite(remaining) && !policy.signal) return producer;
  if (remaining <= 0) {
    return Promise.reject(
      new SleeperBudgetExhaustedError(
        requestBudgetOverdueMs(policy, at),
        options.label ?? "a shared Sleeper read",
      ),
    );
  }
  return waitForShared(producer, {
    signal: policy.signal,
    expiresAt: Number.isFinite(remaining) ? at + remaining : undefined,
    now,
    label: options.label,
  });
}
