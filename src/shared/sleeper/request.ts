/**
 * The composition every Sleeper read runs through: a policy, a permit, a
 * bounded HTTP ladder.
 *
 * **Separate from `client.ts` because `client.ts` cannot be tested.** That
 * module reaches `@/shared/http` through the alias, which Node's own runner
 * cannot resolve, so anything written there is a decision no test can drive.
 * What is actually worth driving is exactly what is here — that a queue budget
 * reaches the limiter, that a deadline reaches the ladder, that a background
 * caller gets neither — so the limiter and the getter arrive as arguments and
 * `client.ts` is left as the wiring that names the real two.
 *
 * Both imports are relative and carry `.ts`, on `sync-admission.ts`' rule.
 */

import type { Limiter } from "./limiter.ts";
import {
  SleeperBudgetExhaustedError,
  ladderBudgetMs,
  queueBudgetMs,
  requestBudgetOverdueMs,
  requestBudgetExhausted,
  resolveSleeperPolicy,
} from "./request-policy.ts";
import type { SleeperRequestOptions } from "./request-policy.ts";

/**
 * The half of `http.get` this needs, named structurally so this module does not
 * import the client it stands in front of.
 *
 * Every field is one the real client already has; `deadlineMs` is the one this
 * work added, and it is the field the interactive policy turns on.
 */
export type SleeperHttpGet = <T>(
  url: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    retries?: number;
    deadlineMs?: number;
  },
) => Promise<{ data: T }>;

/** GET a Sleeper document under the policy in force, folding a null body. */
export type SleeperRequest = <T>(
  url: string,
  options?: SleeperRequestOptions,
) => Promise<T | null>;

/**
 * Bind a limiter and an HTTP getter into the one function `sleeperGet` is.
 *
 * **The permit is held across the retries, deliberately** — a retry is another
 * request on Sleeper's doorstep, and a limiter that released between attempts
 * would admit a fresh caller for every one of them. What the policy bounds is
 * the two things that were unbounded either side of that permit: how long the
 * caller queues for it, and how long the ladder inside it may run.
 *
 * **The queue budget and the ladder budget are separate numbers and must
 * stay separate.** `maxWaitMs` expiring means no slot ever came free and no
 * request was made; `deadlineMs` expiring means Sleeper was reached and did not
 * answer in time. They are different operational facts and they reject with
 * different errors — `AdmissionTimeoutError` against `HttpTimeoutError` — which
 * is what lets a log line say which of the two a bad minute was.
 *
 * **And both are spent out of one pot, which is the third number.** A policy
 * carrying an `expiresAt` — every interactive one does — is a whole request's
 * Sleeper budget rather than one read's, so each read clamps its queue budget
 * and its ladder budget against what is left of it and a read that arrives with
 * nothing left is refused without touching the limiter. Four sequential reads
 * on a handler therefore share twelve seconds; before, each was handed its own.
 */
export function createSleeperRequest(
  limiter: Limiter,
  get: SleeperHttpGet,
  options: { now?: () => number } = {},
): SleeperRequest {
  const now = options.now ?? Date.now;

  return function sleeperRequest<T>(
    url: string,
    callOptions?: SleeperRequestOptions,
  ): Promise<T | null> {
    const policy = resolveSleeperPolicy(callOptions);

    // **Refused before the limiter, not inside it.** A request with nothing
    // left must not take a permit to discover that, and must not be queued
    // behind callers that can still use one. It is also what makes the
    // invariant cheap: once a route has spent its budget, every remaining
    // Sleeper read in it costs one clock read.
    const before = now();
    if (requestBudgetExhausted(policy, before)) {
      return Promise.reject(
        new SleeperBudgetExhaustedError(
          requestBudgetOverdueMs(policy, before),
          url,
        ),
      );
    }

    return limiter.run(
      () => {
        // **Read again, after admission.** The queue and the ladder spend from
        // one pot in sequence, so a ladder budget taken before the wait would
        // be handed time the wait has since eaten — `maxWaitMs + deadlineMs`
        // exceeding what the request had, which is the arithmetic this whole
        // clamp exists to close. A caller admitted with nothing left is refused
        // here rather than given a one-millisecond attempt to fail.
        const after = now();
        if (requestBudgetExhausted(policy, after)) {
          throw new SleeperBudgetExhaustedError(
            requestBudgetOverdueMs(policy, after),
            url,
          );
        }
        return get<T | null>(url, {
          signal: policy.signal,
          timeoutMs: policy.timeoutMs,
          retries: policy.retries,
          deadlineMs: ladderBudgetMs(policy, after),
        }).then((response) => response.data);
      },
      { signal: policy.signal, maxWaitMs: queueBudgetMs(policy, before) },
    );
  };
}
