import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { parseTradeQuery, readTradeFacets } from "@/shared/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The search panel's three menus and their counts — see `TradeFacetsPayload`
 * in the contract for what each half of the payload is for.
 *
 * It takes the **same query string** as the board itself, and reads it with the
 * same parser: the menus describe the population the reader is looking at, so a
 * second spelling of "which trades are on this board" is a panel that counts a
 * different set from the one behind it. `readTradeFacets` strips the selection
 * before counting, which is the one difference and the one the shared layer
 * owns rather than this route.
 *
 * Asked for only while the panel is open, which is what makes three grouped
 * aggregates acceptable: a reader who never opens it never pays for them.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  const requested = parseRequestedSeason(url.searchParams.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const payload = await readTradeFacets(
      parseTradeQuery(url.searchParams, season),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("[trades] facets query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load filter options" };
    return NextResponse.json(payload, { status: 500 });
  }
}
