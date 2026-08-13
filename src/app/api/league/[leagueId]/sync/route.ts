import { NextResponse } from "next/server";

import type { ApiErrorPayload, LeagueSyncPayload } from "@/shared/contract";
import { refreshLeague } from "@/shared/manager";
import type { LeagueRefreshResult } from "@/shared/manager";

import { readFailureResponse } from "../../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-read one league from Sleeper, because a reader asked.
 *
 * **This is the one route under `/api/league` that is not cache-backed, and the
 * exception is the same one `/api/user/[username]/leagues` claims.** The rule is
 * that a route reads what the background syncs have stored and never fetches
 * upstream on demand — and its exceptions are the routes that *are* the thing
 * that resolves or follows: a manager's leagues, because resolving a manager is
 * what that route is for, and the pick tracker, because it follows a draft while
 * it happens. This is the third: it is the thing that **refreshes**, and there
 * is nothing else it could read from. A reader who has just set a lineup in
 * Sleeper's own app cannot wait out the crawler's TTL to see it here, and no TTL
 * short enough to serve them is affordable across the whole corpus.
 *
 * The prefix is a coincidence of the subject rather than a claim about the
 * route, which is why it is `sync` under the league it syncs rather than filed
 * with the operator routes: `/api/players/sync` and `/api/projections/sync`
 * spend tens of megabytes of somebody else's budget on a whole cache, and are
 * secret-gated for it. This spends ~11 small requests on one league — less than
 * the public leagues route spends *per league*, a hundred at a time — and its
 * bounds are in `refreshLeague`, where they can be read together.
 *
 * **POST, and GET is a 405.** A request that re-reads a league from Sleeper and
 * rewrites its graph is a state change whatever method it wears, which is the
 * operator routes' own rule; it also keeps the browser and any proxy between
 * from replaying it.
 *
 * **Every answer but "we don't store this league" is a 200** — see
 * {@link LeagueSyncPayload} for why a cooldown and a race are outcomes rather
 * than errors. The caller refetches the panel either way, since the point of the
 * press is what is on screen and not what this route did.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  try {
    const result = await refreshLeague(leagueId);

    if (result.status === "unknown") {
      // The same answer the read beside it gives for an id nothing is stored
      // for, and the same words: a league this app has never seen is not a
      // league it will fetch on request — see `refreshLeague`.
      const error: ApiErrorPayload = { error: "League not found" };
      return NextResponse.json(error, { status: 404 });
    }

    return NextResponse.json(payload(leagueId, result));
  } catch (error) {
    console.error(`[league] refresh failed for ${leagueId}:`, error);
    // A database failure and nothing else reaches here — everything Sleeper can
    // do comes back as a status — so this is the app's own read-failure answer:
    // a busy pool is a 503 the client may retry rather than a 500 telling it to
    // stop asking.
    return readFailureResponse(error, "Failed to refresh league");
  }
}

/**
 * 405 for a read of a write.
 *
 * Spelled out rather than left to Next's own default so the answer carries this
 * app's error shape, which is what `apiFetch` reads a message out of.
 */
export async function GET() {
  const error: ApiErrorPayload = {
    error: "Use POST to refresh a league",
  };
  return NextResponse.json(error, { status: 405, headers: { Allow: "POST" } });
}

/**
 * The refresh result as the wire shape.
 *
 * `synced` is written here rather than left to the client, the rule the payload
 * states: two statuses mean "the stored graph is current" and a caller deriving
 * that from the union is one that gets a case wrong the next time the union
 * grows.
 */
function payload(
  leagueId: string,
  // `unknown` is answered above and is the one outcome with no payload — as an
  // `Exclude` rather than a widened union so the compiler holds the two apart.
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
