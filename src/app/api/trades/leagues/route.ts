import { NextResponse } from "next/server";

import type { TradeLeaguesPayload } from "@/shared/contract";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";
import { getSeasonTradeLeagues } from "@/shared/trades";

import { readFailureResponse } from "../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every league with a trade on a season's board — see {@link TradeLeaguesPayload}.
 *
 * **A route of its own because it is asked for once and the pages are asked for
 * many times.** The stream sent leagues alongside the trades that named them,
 * which was right when there was one request per season and is wrong when there
 * is one per scroll: a few hundred leagues' worth of `settings`,
 * `roster_positions` and `scoring_settings` blobs would ride along with every
 * page for the sake of the handful the page happened to name.
 *
 * Separated, it is one request the client holds for fifteen minutes and three
 * readers share — the filter dialog's counts and breakdown rows, the ids the
 * trades query is narrowed by, and the name every card puts on its league.
 *
 * The league *rules* stay on the client, which is what this route is in service
 * of. They are a slot-group and scoring-key engine over Sleeper's JSONB blobs,
 * derived from the solver's own slot tables so a new flex counts the moment the
 * solver learns it; a second implementation in SQL would drift silently, and the
 * symptom would be a filter quietly returning the wrong leagues rather than an
 * error. So the rules run in one place, over this, and the answer comes back as
 * `?leagues=`.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("season");
  const season =
    requested && isSeason(requested) ? requested : await getActiveSeason();

  try {
    const leagues = await getSeasonTradeLeagues(season);
    const payload: TradeLeaguesPayload = { season, leagues };
    return NextResponse.json(payload, {
      headers: {
        // Longer than a page's: this is the crawler's own corpus, which changes
        // when a league is discovered rather than when a trade is made.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[trades] league list failed:", error);
    return readFailureResponse(error, "Failed to load leagues");
  }
}
