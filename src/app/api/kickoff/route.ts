import { NextResponse } from "next/server";

import type { ApiErrorPayload, KickoffPayload } from "@/shared/contract";
import { getFirstKickoff } from "@/shared/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * When the season's first regular-season game kicks off.
 *
 *   GET /api/kickoff?season=2026
 *
 * The one route that isn't cache-backed *or* a resolver: it reads Sleeper's
 * schedule call through `getFirstKickoff`'s in-memory read-through cache — one
 * small request per process per half-day, which is too light to earn a table
 * and a sync loop, while the cache still keeps page views from fanning out to
 * Sleeper. A null `kickoff` is a real answer (season not scheduled yet), never
 * an error.
 */
export async function GET(request: Request) {
  const season = new URL(request.url).searchParams.get("season") ?? "";
  if (!/^\d{4}$/.test(season)) {
    const payload: ApiErrorPayload = { error: "season must be a 4-digit year" };
    return NextResponse.json(payload, { status: 400 });
  }

  const kickoff = await getFirstKickoff(season);
  const payload: KickoffPayload = { season, kickoff };
  return NextResponse.json(payload);
}
