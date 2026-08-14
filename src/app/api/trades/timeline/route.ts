import { NextResponse } from "next/server";

import { getTradeTimeline, resolveTimelinePayload } from "@/shared/trades";

import { readFailureResponse } from "../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the league sheet needs to read a league's rosters at any moment
 * between one trade and today — see {@link RosterTimelinePayload}.
 *
 * **One of two routes answering that payload**, and the other is
 * `/api/league/[leagueId]/timeline`, which runs the same replay with no trade to
 * stop at. What each owns is a walk and a cache header; the resolution from ids to
 * names is `resolveTimelinePayload`, once, so the two cannot come to different
 * conclusions about which players a stop is allowed to name.
 *
 * **The one route on this board that derives rather than reads a cache**, and the
 * exception is argued where the derivation lives (`getTradeTimeline`): the rule
 * these routes follow is that a *board page* never walks a league's whole
 * transaction log, because a page names twenty trades from twenty leagues. This
 * is one league, on a press, behind a modal — the same class of read as
 * `/api/league/[leagueId]`, which the same sheet already makes.
 *
 * **A trade id and nothing else**, the sibling routes' rule: the question is
 * about one stored trade rather than a population, so whatever board a reader
 * pressed the card on, the answer is the same answer and the client's cache entry
 * is keyed on the id alone.
 */
export async function GET(request: Request) {
  const trade = new URL(request.url).searchParams.get("trade")?.trim();
  // The one thing that can fail the request, and it is a malformed request
  // rather than a narrowing: every other route here reads an unreadable value as
  // "don't filter", which has no meaning when the value *is* the question.
  if (!trade) {
    return NextResponse.json(
      { error: "A trade id is required" },
      { status: 400 },
    );
  }

  try {
    const payload = await resolveTimelinePayload(await getTradeTimeline(trade));
    return NextResponse.json(payload, {
      headers: {
        // Short, for the reason the board's other reads are: what a roster held
        // on a past date cannot change, but *whether this league has been
        // crawled far enough to say* changes as the syncs run — and a freshly
        // discovered league's first answer is the one worth not caching for an
        // hour. A minute covers a reader opening the same sheet twice.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[trades] timeline failed:", error);
    return readFailureResponse(error, "Failed to load the league's timeline");
  }
}
