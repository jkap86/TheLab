import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { getLeagueTimeline, resolveTimelinePayload } from "@/shared/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league's rosters at any moment from its **oldest stored move** to today —
 * see `RosterTimelinePayload`.
 *
 * **It reads stored rows and fetches nothing**, which keeps it inside the rule
 * its sibling under this prefix is the documented exception to: `transactions`,
 * `rosters` and `traded_picks` are what the crawler and the manager sync already
 * wrote, and a league neither has reached comes back with no timeline rather
 * than being synced on demand. What it does that a plain read does not is
 * *derive* — one league, on a reader's own press, behind a disclosure.
 *
 * **A blank segment cannot reach here**, since Next would not have matched the
 * route, so there is no malformed-request branch to draw. An unknown league is
 * not a 404 either: it is a league with nothing stored, which is exactly the
 * `timeline: null` this answers with — the rail draws a word rather than an
 * error, and the card beside it is unaffected.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  try {
    const payload = await resolveTimelinePayload(
      await getLeagueTimeline(leagueId),
    );
    return NextResponse.json(payload, {
      headers: {
        // What a roster held on a past date cannot change, but *how far back
        // this league has been crawled* moves as the syncs run, and a freshly
        // discovered league's first answer is the one worth not caching for an
        // hour. A minute covers a reader opening the same card twice.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error(`[league] timeline failed for ${leagueId}:`, error);
    const body: ApiErrorPayload = { error: "Failed to load the league's history" };
    return NextResponse.json(body, { status: 500 });
  }
}
