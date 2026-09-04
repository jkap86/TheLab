import { NextResponse } from "next/server";

import type { ApiErrorPayload, VisitorLogsPayload } from "@/shared/contract";
import { getVisitorLogs, logsAccess } from "@/shared/logs";
import { integer } from "@/shared/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The header the page sends its token on. */
export const LOGS_KEY_HEADER = "x-logs-key";

/**
 * The longest window the page offers, in hours — thirty days.
 *
 * A bound rather than a preference: the read is capped at
 * `VISITOR_LOG_CAP` rows either way, so a wider window would only move which
 * rows fall off the end without saying it had.
 */
const MAX_WINDOW_HOURS = 24 * 30;

const HOUR_MS = 60 * 60 * 1000;

/**
 * `GET /api/logs` — recent visits, newest first.
 *
 * **A failed token answers 404, not 401.** The page's protection is that it
 * does not appear to exist, and a 401 from this route would confirm that it
 * does — which is the whole of what somebody guessing URLs wants to know.
 */
export async function GET(request: Request) {
  const access = logsAccess(
    process.env,
    request.headers.get(LOGS_KEY_HEADER),
    process.env.NODE_ENV === "production",
  );
  if (!access.ok) {
    const error: ApiErrorPayload = { error: "Not found" };
    return NextResponse.json(error, { status: 404 });
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
    return NextResponse.json(error, { status: 400 });
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
    // No `Cache-Control`. Every other read in this app can afford a minute of
    // staleness; this one is somebody watching who is on the site right now.
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[logs] visit query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load visits" };
    return NextResponse.json(payload, { status: 500 });
  }
}
