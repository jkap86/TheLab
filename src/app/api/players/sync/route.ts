import { NextResponse } from "next/server";

import type { ApiErrorPayload, PlayersSyncPayload } from "@/shared/contract";
import { syncPlayers } from "@/shared/players";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refresh the cached Sleeper players map. `?force=1` bypasses the freshness gate. */
async function handler(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const result: PlayersSyncPayload = await syncPlayers({ force });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[players] sync failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to sync players" };
    return NextResponse.json(payload, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
