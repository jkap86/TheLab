import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { parseKtcBoardChoice } from "@/shared/ktc/board-choice";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getLeagueTimeline, resolveTimelinePayload } from "@/shared/timeline";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league's rosters at any moment from its **oldest stored move** to today,
 * with today's boards to price them against — see `RosterTimelinePayload`.
 *
 * **It reads stored rows and fetches no league graph**, which keeps it inside
 * the rule its sibling under this prefix is the documented exception to:
 * `transactions`, `rosters`, `traded_picks` and `drafts` are what the crawler
 * and the manager sync already wrote, and a league neither has reached comes
 * back with no timeline rather than being synced on demand. What it *does*
 * reach outward for is the same three boards the lineups route reads — the
 * projections feed, the ADP the manager's drafts measure, the KTC market — all
 * of them cached reads shared with that route rather than work of this one's.
 *
 * **The three narrowing parameters are the lineups route's, deliberately.**
 * `?season=`, `?user=` and `?ktc_board=` are what decide which boards answer, and
 * a past roster priced on a different board from the card in front of the rail
 * is not a comparison — it is two numbers on two rulers. `?user=` is the one
 * that looks out of place on a league-scoped read and is the one that matters
 * most: the ADP fallback board is built from *that manager's* synced drafts, so
 * without it the three capital metrics have nothing to price against and rank
 * null. Omitting it is allowed and costs exactly that.
 *
 * A malformed `?season=` is a 400 on `parseRequestedSeason`'s own terms — a
 * season names *which data* this is about — while an unreadable `?ktc_board=`
 * falls back to `auto`, which is the opposite call for the opposite reason. An
 * unknown `?user=` is neither: the read answers without an ADP board rather than
 * failing a league's history over a name that is not this route's subject.
 *
 * **A blank league segment cannot reach here**, since Next would not have
 * matched the route. An unknown league is not a 404 either: it is a league with
 * nothing stored, which is exactly the `timeline: null` this answers with — the
 * rail draws a word rather than an error, and the card beside it is unaffected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;
  const url = new URL(request.url);

  // Three states, not two, exactly as every other route reads it: `null` is
  // "not asked" and is the only one filled from the resolver.
  const requested = parseRequestedSeason(url.searchParams.get("season"));
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }

  try {
    const season = requested?.season ?? (await getActiveSeason());
    const managerUserId = await resolveManager(url.searchParams.get("user"));

    const payload = await resolveTimelinePayload(
      await getLeagueTimeline(leagueId),
      {
        managerUserId,
        season,
        board: parseKtcBoardChoice(url.searchParams.get("ktc_board")),
      },
    );
    return NextResponse.json(payload, {
      headers: {
        // What a roster held on a past date cannot change, but *how far back
        // this league has been crawled* moves as the syncs run, and so do the
        // boards it is priced on. A minute covers a reader opening the same
        // card twice; the boards behind it have TTLs of their own.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error(`[league] timeline failed for ${leagueId}:`, error);
    const body: ApiErrorPayload = { error: "Failed to load the league's history" };
    return NextResponse.json(body, { status: 500 });
  }
}

/**
 * Whose ADP board this prices against, or null where the request named nobody
 * this app can resolve.
 *
 * **An unknown name is not an error here**, which is where this parts company
 * with every route whose *subject* is a manager. This route answers about a
 * league; the manager only decides which drafts the capital metrics average, so
 * a name that does not resolve costs those three columns and nothing else.
 */
async function resolveManager(username: string | null): Promise<string | null> {
  if (!username) return null;
  try {
    const resolved = await resolveManagerUser(username);
    return resolved.ok ? resolved.user.user_id : null;
  } catch {
    return null;
  }
}
