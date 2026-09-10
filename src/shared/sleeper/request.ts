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
import { resolveSleeperPolicy } from "./request-policy.ts";
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
 */
export function createSleeperRequest(
  limiter: Limiter,
  get: SleeperHttpGet,
): SleeperRequest {
  return function sleeperRequest<T>(
    url: string,
    options?: SleeperRequestOptions,
  ): Promise<T | null> {
    const policy = resolveSleeperPolicy(options);
    return limiter.run(
      () =>
        get<T | null>(url, {
          signal: policy.signal,
          timeoutMs: policy.timeoutMs,
          retries: policy.retries,
          deadlineMs: policy.deadlineMs,
        }).then((response) => response.data),
      { signal: policy.signal, maxWaitMs: policy.maxWaitMs },
    );
  };
}
