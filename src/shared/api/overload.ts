/**
 * What a route answers when the process declined to do the work.
 *
 * **An overload is not a bug, and a 500 says it is.** `sleeperGet` has three
 * ways of refusing a caller before Sleeper is touched — the limiter's queue
 * budget ran out, the caller's signal fired, or the request had no Sleeper
 * budget left — and all three are the app deliberately shedding load. Reaching
 * a handler's `catch` they became `{ error: "Failed to load …" }` with a 500,
 * which is the same answer a null dereference gives: it tells an operator to go
 * looking for a fault that is not there, it tells a browser nothing about
 * whether to try again, and it makes the one signal that would show the shed
 * rate indistinguishable from noise.
 *
 * So the refusal is answered as what it is — **503 with a `Retry-After`** — and
 * it is answered in exactly one place, because a status and a header spelled
 * per route are a status and a header that drift. Every other error is
 * untouched: a 400, a 404, a 502 and a genuine exception all reach the caller
 * exactly as they did.
 */

import type { ApiErrorPayload } from "@/shared/contract";
// Relative and with the extension, on `sync-admission.ts`' rule: this module is
// four functions and a status code, and every one of them is a decision worth
// driving under Node's own runner — which cannot resolve `@/…`. The contract
// import is type-only and erased, so it costs nothing here.
import { isAdmissionRefusal, isAdmissionAbort } from "../sleeper/limiter.ts";

/**
 * What a shed caller is told to wait, in seconds.
 *
 * **Short, because what it is waiting out is a burst rather than an outage.**
 * The two things that produce this are a full Sleeper limiter and a request
 * that spent its own twelve seconds; both are measured in seconds, and a longer
 * figure would tell a browser to stand off for an interval unrelated to
 * anything the process is doing. It is deliberately not the manager-sync shed's
 * ten (`/api/user/[username]/leagues`): that one is a *cold graph sync* holding
 * a stream open, which really does take that long to clear.
 */
export const OVERLOAD_RETRY_AFTER_SECONDS = 5;

/** What the reader is told. Deliberately about load rather than about a fault. */
export const OVERLOAD_MESSAGE =
  "Too much Sleeper traffic right now. Try again shortly.";

/**
 * Whether this error is the app shedding rather than failing.
 *
 * `isAdmissionRefusal` under a name that says what a *route* does about it, so
 * a reader of a handler does not have to know that a request budget and a
 * limiter queue are both spelled as admission.
 */
export function isOverload(error: unknown): boolean {
  return isAdmissionRefusal(error);
}

/** The 503, with the header that makes it actionable. */
export function overloadResponse(): Response {
  const body: ApiErrorPayload = { error: OVERLOAD_MESSAGE };
  return Response.json(body, {
    status: 503,
    headers: {
      "Retry-After": String(OVERLOAD_RETRY_AFTER_SECONDS),
      // Never cached: a shed is a fact about this instant, and a CDN holding
      // one would turn a five-second burst into a five-minute outage.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The overload response for a refusal, or `null` for anything else.
 *
 * The seam a caller that already has its own `catch` can use without giving up
 * the handling it has: `mapOverload(error) ?? myOwn500()`.
 */
export function mapOverload(error: unknown): Response | null {
  if (!isOverload(error)) return null;
  // An abort is the client having gone, which says nothing about load — nobody
  // is reading the response either way, so the status is a formality and the
  // log line is the part that must not claim a shed happened.
  if (!isAdmissionAbort(error)) {
    console.warn("[overload] shed a Sleeper read:", (error as Error).message);
  }
  return overloadResponse();
}
