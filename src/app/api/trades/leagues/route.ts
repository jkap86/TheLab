import { NextResponse } from "next/server";

import type { ApiErrorPayload, TradeLeaguesPayload } from "@/shared/contract";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { withInteractiveSleeper } from "@/shared/sleeper";
import { lookupSeasonTradeLeagues } from "@/shared/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every league with a trade on this season's board — the league filters' whole
 * input, and the name every card puts on its league.
 *
 * A separate route rather than a field on the page, because it is asked for
 * **once per season** where pages are asked for on every scroll: bundling it
 * would re-send a few hundred leagues' worth of `settings`, `roster_positions`
 * and `scoring_settings` blobs each time. Those blobs are what the filter rules
 * read, so they cannot be trimmed — see `ManagerLeague`.
 *
 * Memoized per season in `shared/trades/enrich`, since the same few hundred
 * rows were being re-read and re-serialised for every reader; a league write
 * evicts it, so a league's first trade names it on the next read.
 */
export async function GET(request: Request) {
  // A reader is waiting, so the season resolve below — the one Sleeper read on
  // this route — takes the interactive budget. See
  // `shared/sleeper/request-policy`.
  return withInteractiveSleeper(() => readSeasonLeagues(request));
}

async function readSeasonLeagues(request: Request) {
  const requested = parseRequestedSeason(
    new URL(request.url).searchParams.get("season"),
  );
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const payload: TradeLeaguesPayload = {
      season,
      leagues: await lookupSeasonTradeLeagues(season),
    };

    return NextResponse.json(payload, {
      headers: {
        // Longer than a page's: which leagues traded this season changes only
        // when a sync writes a league's first trade, and the client holds it
        // for the session anyway.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[trades] leagues query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load leagues" };
    return NextResponse.json(payload, { status: 500 });
  }
}
