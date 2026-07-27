import { NextResponse } from "next/server";

import { parseWeeks, syncProjections } from "@/shared/projections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh stored weekly projections.
 *
 *   POST /api/projections/sync                 current + next week, if stale
 *   POST /api/projections/sync?force=1         same weeks, ignoring freshness
 *   POST /api/projections/sync?week=1,2,3      backfill specific weeks
 *   POST /api/projections/sync?season=2025&week=17
 *
 * A manual counterpart to the background loop, which only ever keeps the current
 * window fresh — past weeks are frozen once their games are played, so pulling one
 * in is a deliberate act. `week` accepts repeated params or commas, as elsewhere.
 *
 * Each week is a ~5.6MB download; a request that syncs several is slow by nature.
 */
async function handler(request: Request) {
  const params = new URL(request.url).searchParams;

  const weeks = parseWeeks(params.getAll("week"));
  if (!weeks.ok) {
    return NextResponse.json({ error: weeks.error }, { status: 400 });
  }

  const season = params.get("season");
  if (season !== null && !/^\d{4}$/.test(season)) {
    return NextResponse.json(
      { error: "season must be a 4-digit year" },
      { status: 400 },
    );
  }

  try {
    const result = await syncProjections({
      season: season ?? undefined,
      weeks: weeks.weeks,
      // An explicit week is a request to fetch it, not to consult the cache.
      force: params.get("force") === "1" || weeks.weeks.length > 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[proj] sync failed:", error);
    return NextResponse.json(
      { error: "Failed to sync projections" },
      { status: 500 },
    );
  }
}

export const GET = handler;
export const POST = handler;
