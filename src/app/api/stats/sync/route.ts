import { NextResponse } from "next/server";

import type { ApiErrorPayload, StatsSyncPayload } from "@/shared/contract";
import { parseWeeks } from "@/shared/projections";
import { isSeason } from "@/shared/query";
import { syncStats } from "@/shared/stats";

import { authorizeInternalRequest, methodNotAllowed } from "../../internal-auth";
import { readFailureResponse } from "../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh stored weekly stat lines.
 *
 *   POST /api/stats/sync                    whatever is stale, on both clocks
 *   POST /api/stats/sync?force=1            the live weeks regardless
 *   POST /api/stats/sync?week=1,2,3         backfill specific weeks
 *   POST /api/stats/sync?season=2024&week=17
 *
 * The manual counterpart to the background loop, and the sibling of
 * `/api/projections/sync` in every respect — same auth, same method rule, same
 * lock semantics. With no week it does exactly what a tick does: the live window
 * if it is past the hourly gate, plus a couple of settled weeks if they are past
 * the monthly one. Naming weeks skips both gates and both caps.
 *
 * **Naming a season is what this endpoint is really for.** The loop keeps this
 * season and the one before it, which is all a points-per-game average ever
 * reads; anything older exists only because an operator asked for it, and there
 * is deliberately no automatic path that would quietly download a decade.
 *
 * `week` accepts repeated params or commas and is bounded by
 * `MAX_REQUESTED_WEEKS` — it is `parseWeeks` from the projections module rather
 * than a second copy, since "an NFL regular-season week" means the same thing on
 * both sides and two parsers is one place for them to disagree.
 *
 * Each week is a multi-megabyte download, which is what makes this an
 * **operator endpoint**: it requires the internal secret and is POST-only,
 * because a GET that pulls tens of megabytes off Sleeper is a state change
 * wearing a safe method.
 *
 * A run already in flight loses the advisory lock and comes back `locked: true`;
 * that answers 409 rather than 200, so a caller retrying in a loop is told to
 * wait instead of reading success off someone else's work.
 */
export async function POST(request: Request) {
  const auth = authorizeInternalRequest(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;

  const weeks = parseWeeks(params.getAll("week"));
  if (!weeks.ok) {
    const error: ApiErrorPayload = { error: weeks.error };
    return NextResponse.json(error, { status: 400 });
  }

  const season = params.get("season");
  if (season !== null && !isSeason(season)) {
    const error: ApiErrorPayload = { error: "season must be a 4-digit year" };
    return NextResponse.json(error, { status: 400 });
  }

  try {
    const result: StatsSyncPayload = await syncStats({
      season: season ?? undefined,
      weeks: weeks.weeks,
      // An explicit week is a request to fetch it, not to consult the cache.
      force: params.get("force") === "1" || weeks.weeks.length > 0,
    });
    return NextResponse.json(result, { status: result.locked ? 409 : 200 });
  } catch (error) {
    console.error("[stats] sync failed:", error);
    return readFailureResponse(error, "Failed to sync stats");
  }
}

export function GET() {
  return methodNotAllowed();
}
