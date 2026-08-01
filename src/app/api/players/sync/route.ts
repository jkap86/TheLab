import { NextResponse } from "next/server";

import type { ApiErrorPayload, PlayersSyncPayload } from "@/shared/contract";
import { syncPlayers } from "@/shared/players";

import { authorizeInternalRequest, methodNotAllowed } from "../../internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh the cached Sleeper players map. `?force=1` bypasses the freshness gate.
 *
 * An operator endpoint, for the same reason as the projections sync beside it:
 * the map is ~5MB and Sleeper asks that it be fetched at most once a day, so
 * `force=1` is precisely the knob that must not be public. Requires the internal
 * secret (see `app/api/internal-auth.ts`) and is POST-only.
 *
 * A refresh already running elsewhere loses the advisory lock and answers 409,
 * rather than a 200 describing someone else's run.
 */
export async function POST(request: Request) {
  const auth = authorizeInternalRequest(request);
  if (!auth.ok) return auth.response;

  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const result: PlayersSyncPayload = await syncPlayers({ force });
    return NextResponse.json(result, { status: result.locked ? 409 : 200 });
  } catch (error) {
    console.error("[players] sync failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to sync players" };
    return NextResponse.json(payload, { status: 500 });
  }
}

export function GET() {
  return methodNotAllowed();
}
