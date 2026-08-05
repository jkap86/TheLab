import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { isDatabaseBusy } from "@/shared/db";

/**
 * The response a route sends when a read it needed didn't come back.
 *
 * The HTTP half of `isDatabaseBusy`, sitting in `src/app` for the same reason
 * `resolveManagerRequest` does: the decision is already made in a module this
 * calls, and all that is left is the `NextResponse` domain code has no business
 * constructing.
 *
 * Two answers, and the difference is what a caller should do next. A read that
 * *failed* is a 500 and the route's own message — something is wrong and asking
 * again will be wrong the same way. A read that ran out of the budget this app
 * gives it (`shared/db/budget`) is a **503 with `Retry-After`**: nothing is
 * broken, the database had no room, and the honest thing to tell a client is to
 * come back. Reporting that one as a 500 is what turned a busy minute into an
 * outage — the browser retried anyway, so the only thing the wrong status
 * bought was that nobody could tell the two apart in the logs.
 *
 * Every route that catches a read uses this, rather than the ones that were
 * noticed being slow: a rule applied to two routes out of fourteen is a rule
 * that reports the twelfth as a bug in itself.
 */
export function readFailureResponse(
  error: unknown,
  message: string,
): NextResponse<ApiErrorPayload> {
  if (isDatabaseBusy(error)) {
    const payload: ApiErrorPayload = {
      error: "The database is busy right now. Try again in a moment.",
    };
    // A second is not a real estimate of when the pool drains — nothing here
    // can know that — it is the smallest honest one, and its job is to keep a
    // client that respects the header from re-asking inside the same pile-up.
    return NextResponse.json(payload, {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }

  const payload: ApiErrorPayload = { error: message };
  return NextResponse.json(payload, { status: 500 });
}
