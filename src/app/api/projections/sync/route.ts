import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  ProjectionsSyncPayload,
} from "@/shared/contract";
import { parseWeeks, syncProjections } from "@/shared/projections";
import { isSeason } from "@/shared/query";

import { authorizeInternalRequest, methodNotAllowed } from "../../internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh stored weekly projections.
 *
 *   POST /api/projections/sync                 whatever is stale, on both clocks
 *   POST /api/projections/sync?force=1         current + next week regardless
 *   POST /api/projections/sync?week=1,2,3      backfill specific weeks
 *   POST /api/projections/sync?season=2025&week=17
 *
 * A manual counterpart to the background loop. With no week it does exactly what a
 * tick does: this week and next if they're past the hourly gate, plus a couple of
 * rest-of-season weeks if they're past the daily one. Naming weeks skips both
 * gates and both caps, which is the only way to pull a past season or to fill the
 * horizon in one go rather than over the next two hours. `week` accepts repeated
 * params or commas, as elsewhere, and is bounded by `MAX_REQUESTED_WEEKS`.
 *
 * Each week is a ~5.6MB download; a request that syncs several is slow by nature.
 * That cost is what makes this an **operator endpoint**: it requires the internal
 * secret (see `app/api/internal-auth.ts`) and is POST-only, because a GET that
 * pulls tens of megabytes off Sleeper is a state change wearing a safe method —
 * one crawler or link preview away from running itself.
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
    const result: ProjectionsSyncPayload = await syncProjections({
      season: season ?? undefined,
      weeks: weeks.weeks,
      // An explicit week is a request to fetch it, not to consult the cache.
      force: params.get("force") === "1" || weeks.weeks.length > 0,
    });
    return NextResponse.json(result, { status: result.locked ? 409 : 200 });
  } catch (error) {
    console.error("[proj] sync failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to sync projections" };
    return NextResponse.json(payload, { status: 500 });
  }
}

export function GET() {
  return methodNotAllowed();
}
