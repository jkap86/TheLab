import { NextResponse } from "next/server";

import type { ApiErrorPayload, VisitorLogsPayload } from "@/shared/contract";
import { getVisitorLogs, logsAccess, sessionFromCookieHeader } from "@/shared/logs";
import { integer } from "@/shared/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The longest window the page offers, in hours — thirty days.
 *
 * A bound rather than a preference: the read is capped at
 * `VISITOR_LOG_CAP` rows either way, so a wider window would only move which
 * rows fall off the end without saying it had.
 */
const MAX_WINDOW_HOURS = 24 * 30;

const HOUR_MS = 60 * 60 * 1000;

/** Every answer here is one reader's, right now — nothing may hold it. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * `GET /api/logs` — recent visits, newest first.
 *
 * **Authenticated by the session cookie and nothing else.** It took the
 * credential itself on a request header once, which is a credential on every
 * read; the session is minted by `POST /api/logs/session` and verified here
 * independently of the page, so a browser holding a page that has since
 * expired is told so by the read rather than served on the page's say-so.
 *
 * **Unconfigured in production is a 404** — the page's own rule, that it does
 * not appear to exist — where **a missing or dead session is a 401**: the page
 * is there and wants a sign-in, and the client refreshes to the form on it.
 */
export async function GET(request: Request) {
  const access = logsAccess(
    process.env,
    sessionFromCookieHeader(request.headers.get("cookie")),
    process.env.NODE_ENV === "production",
  );
  if (!access.ok) {
    const error: ApiErrorPayload =
      access.reason === "denied"
        ? { error: "Not found" }
        : { error: "Sign in to read the visit log" };
    return NextResponse.json(error, {
      status: access.reason === "denied" ? 404 : 401,
      headers: NO_STORE,
    });
  }
  if (access.warning) console.warn(`[logs] ${access.warning}`);

  const params = new URL(request.url).searchParams;
  const hours = integer(params, "hours", {
    min: 1,
    max: MAX_WINDOW_HOURS,
    fallback: 24,
  });
  if (!hours.ok) {
    const error: ApiErrorPayload = { error: hours.error };
    return NextResponse.json(error, { status: 400, headers: NO_STORE });
  }
  // `fallback` is a number, so the null arm of `integer`'s return is unreachable
  // here; named rather than asserted so a later edit to the fallback is a
  // compile error rather than a NaN interval.
  const windowHours = hours.value ?? 24;

  try {
    const { entries, truncated } = await getVisitorLogs(windowHours * HOUR_MS);
    const payload: VisitorLogsPayload = {
      window_hours: windowHours,
      entries,
      truncated,
    };
    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    console.error("[logs] visit query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load visits" };
    return NextResponse.json(payload, { status: 500, headers: NO_STORE });
  }
}
