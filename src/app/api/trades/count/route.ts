import { NextResponse } from "next/server";

import type { TradeCountPayload } from "@/shared/contract";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";
import {
  countTrades,
  getStoredTradeCount,
  isUnnarrowed,
  parseTradeQuery,
  refreshTradeStats,
} from "@/shared/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many trades a query matches — the number the filter dialog's footer
 * states as its draft changes.
 *
 * **A route of its own because it moves at a different rate from the menus.**
 * Both are read by the same dialog, and folding them into one response was the
 * obvious thing and the wrong one: the menus are counted *without* the
 * selection, so pressing a checkbox cannot change them — while the footer's
 * number is counted *with* it and changes on every press. Together, one
 * checkbox re-ran a grouped aggregate over the season (~1.5s) to move a number
 * a `count(*)` answers in ten milliseconds.
 *
 * Split, the expensive half is fetched once per league scope and window, and
 * this is what a checkbox costs. It is the same predicate, the same population
 * and the same stored-count shortcut as `/api/trades` — one filter vocabulary,
 * three routes reading it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  const query = parseTradeQuery(url.searchParams, season);

  try {
    const total = isUnnarrowed(query)
      ? // The unnarrowed board's size is stored rather than counted — see
        // `shared/trades/stats`. It is not the dialog's usual case, but it is
        // its *opening* case, and a scan for a number already on a row would be
        // the exact cost this route exists to avoid.
        ((await getStoredTradeCount(season)) ?? (await refreshTradeStats(season)))
      : await countTrades(query);

    const payload: TradeCountPayload = { season, total };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("[trades] count failed:", error);
    return NextResponse.json({ error: "Failed to count trades" }, { status: 500 });
  }
}
