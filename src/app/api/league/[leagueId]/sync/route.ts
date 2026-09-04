import { NextResponse } from "next/server";

import type { ApiErrorPayload, LeagueSyncPayload } from "@/shared/contract";
import { refreshLeague } from "@/shared/manager";
import type { LeagueRefreshResult } from "@/shared/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-read one league from Sleeper — see {@link refreshLeague}, which is where
 * every bound and every decision lives. This handler is the wire and nothing
 * else.
 *
 * **The one route in this app that is not answering from what a background sync
 * stored.** The leagues stream is the other exception, and it earns it the same
 * way: a reader is waiting on data that has just changed, and the alternative is
 * showing them a number they know is wrong.
 *
 * **POST only, and GET is an explicit 405** rather than a fall-through. A
 * re-read plus a rewrite is a state change whatever method it wears, so it must
 * not be replayable by a prefetch, a proxy or a back button — and the 405
 * carries the app's own error shape so `apiFetch` can read a sentence out of it
 * rather than inventing one from the status.
 *
 * **Every answer but `unknown` is a 200**, which is the shape decision worth
 * defending: a cooldown and a race are *outcomes*, not failures. Answering 429
 * or 409 would put a browser-console error and a red note against a league that
 * is in perfectly good order, and would make the client's job distinguishing
 * "the press did nothing" from "the press could not be made" harder rather than
 * easier. `unknown` is the exception because it is genuinely a bad request: there
 * is no such league here to refresh.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  try {
    const result = await refreshLeague(leagueId);
    if (result.status === "unknown") {
      const error: ApiErrorPayload = { error: "League not found" };
      return NextResponse.json(error, { status: 404 });
    }
    return NextResponse.json(payload(leagueId, result));
  } catch (error) {
    // `refreshLeague` turns everything Sleeper can do into a status, so reaching
    // here means the database did not answer — which is not this league's
    // problem and not something the reader can act on by pressing again.
    console.error(`[league] refresh failed for ${leagueId}:`, error);
    const body: ApiErrorPayload = { error: "Failed to refresh league" };
    return NextResponse.json(body, { status: 500 });
  }
}

export async function GET() {
  const error: ApiErrorPayload = { error: "Use POST to refresh a league" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "POST" } });
}

/**
 * The union, flattened onto the wire.
 *
 * `synced` is computed here rather than left to the client, so the two things
 * that read it — the note beside the key and the decision to re-read the card —
 * cannot disagree about one press. `updated_at` is read off whichever arms carry
 * it; the two that do not have nothing to say about a league's last good read.
 */
function payload(
  leagueId: string,
  result: Exclude<LeagueRefreshResult, { status: "unknown" }>,
): LeagueSyncPayload {
  return {
    league_id: leagueId,
    status: result.status,
    synced: result.status === "synced" || result.status === "fresh",
    retry_after_ms: result.status === "cooldown" ? result.retryAfterMs : 0,
    updated_at:
      "updatedAt" in result ? (result.updatedAt?.toISOString() ?? null) : null,
  };
}
