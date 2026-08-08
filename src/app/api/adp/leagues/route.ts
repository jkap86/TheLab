import { NextResponse } from "next/server";

import type { AdpLeaguesPayload } from "@/shared/contract";
import { getAdpLeagues } from "@/shared/manager";
import { isSeason } from "@/shared/query";
import { getActiveSeason } from "@/shared/season";

import { readFailureResponse } from "../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every league behind the ADP board, for one season — see
 * {@link AdpLeaguesPayload}.
 *
 * **The board's league filters are the shared league-filters dialog, and this is
 * what they run over.** They are slot-group, scoring-key and size rules over
 * Sleeper's settings blobs, derived from the solver's own slot tables so a new
 * flex counts the moment the solver learns it; a second implementation in SQL
 * would drift silently, and the symptom would be a filter quietly returning the
 * wrong leagues rather than an error. The rules therefore stay in one place, the
 * browser evaluates them over this list, and the answer goes back to `/api/adp`
 * as `league_id`/`xleague_id` — or as a POST body where it is too long for a
 * request line. `/api/trades/leagues` is the same arrangement for the same
 * reason; the two populations genuinely differ (a trade there, a draft here), so
 * they are two reads rather than one shared one.
 *
 * `?season=all` spans every season on file, which is the drawer's own widest
 * board and the one case worth naming: it is the largest answer this route gives
 * and a reader has to have asked for it.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("season");
  const all = requested?.toLowerCase() === "all";
  const season =
    all || (requested && isSeason(requested))
      ? requested!
      : await getActiveSeason();

  try {
    const leagues = await getAdpLeagues(all ? null : [season]);
    const payload: AdpLeaguesPayload = { season, leagues };
    return NextResponse.json(payload, {
      headers: {
        // The crawler's own corpus: it changes when a league is discovered
        // rather than when a draft is made, so it outlives a board read by a
        // good margin. The same five minutes `/api/trades/leagues` holds.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[adp] league list failed:", error);
    return readFailureResponse(error, "Failed to load leagues");
  }
}
