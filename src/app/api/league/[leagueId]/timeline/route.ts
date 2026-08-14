import { NextResponse } from "next/server";

import { getLeagueTimeline, resolveTimelinePayload } from "@/shared/trades";

import { readFailureResponse } from "../../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league's rosters at any moment from its **oldest stored move** to today —
 * see {@link RosterTimelinePayload}.
 *
 * **The same answer `/api/trades/timeline` gives with its far end taken off.**
 * That route is opened from a trade card and stops at that trade; this one is
 * opened from a league card, which was pressed for the league rather than for any
 * moment in it, so there is nothing to anchor on and the rail runs all the way
 * back. Both walks are `roster-history`'s and both resolve their ids through
 * `resolveTimelinePayload`, so the two screens cannot disagree about a stop.
 *
 * **It reads stored rows and fetches nothing**, which is what keeps it inside the
 * rule its siblings under this prefix follow: `transactions` and `rosters` are
 * what the league crawler already wrote, and a league it has never reached comes
 * back with no timeline rather than being synced on demand. What it does that
 * they do not is *derive* — the exception `getTradeTimeline` argues and this
 * inherits, on the same terms: one league, on a press, behind a disclosure.
 *
 * **The `sync` sibling is still the only exception under this prefix**, and this
 * is not a second one. It answers about a league the same way the base route does;
 * it simply answers a different question about it.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await context.params;
  // A blank segment cannot reach here — Next would not have matched the route —
  // so there is no malformed-request branch to draw, unlike the trades sibling
  // whose trade id is a query parameter a caller can simply omit.
  try {
    const payload = await resolveTimelinePayload(
      await getLeagueTimeline(leagueId),
    );
    return NextResponse.json(payload, {
      headers: {
        // The trades sibling's header and its reasoning: what a roster held on a
        // past date cannot change, but *how far back this league has been
        // crawled* moves as the syncs run, and a freshly discovered league's
        // first answer is the one worth not caching for an hour. A minute covers
        // a reader opening the same card twice.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[league] timeline failed:", error);
    return readFailureResponse(error, "Failed to load the league's timeline");
  }
}
