import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import {
  parseTradeQuery,
  readTradeFacets,
  readTradeParams,
} from "@/shared/trades";

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
 *
 * It answers a POST for the same reason the board does, and it has to answer
 * one wherever the board does: the two take the same query string, so a scope
 * too long for a request line here is the same scope that was too long there —
 * see `shared/trades/transport`.
 */
export async function GET(request: Request) {
  return readFacets(request);
}

export async function POST(request: Request) {
  return readFacets(request);
}

async function readFacets(request: Request) {
  const read = await readTradeParams(request);
  if (!read.ok) {
    const error: ApiErrorPayload = { error: read.error };
    return NextResponse.json(error, { status: read.status });
  }
  const { params } = read;

  const requested = parseRequestedSeason(params.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const payload = await readTradeFacets(parseTradeQuery(params, season));
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("[trades] facets query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load filter options" };
    return NextResponse.json(payload, { status: 500 });
  }
}
