import { NextResponse } from "next/server";

import type { ApiErrorPayload, LeagueHistoryPayload } from "@/shared/contract";
import { extendLeagueHistory } from "@/shared/manager";
import type { LeagueHistoryResult } from "@/shared/manager";
import {
  parseKtcBoardChoice,
  parseKtcLineupChoice,
} from "@/shared/ktc/board-choice";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { withInteractiveSleeper } from "@/shared/sleeper";
import { getLeagueTimeline, resolveTimelinePayload } from "@/shared/timeline";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league's rosters at any moment its **stored seasons** reach, with today's
 * boards to price them against — see `RosterTimelinePayload`.
 *
 * **It spans the whole chain**: the league asked for, then each earlier season
 * `previous_league_id` names that this database already holds, each rewound from
 * its own stored rosters. Where the corpus runs out before the league's first
 * season does, the payload says so and the `POST` below is how a reader asks for
 * one more.
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
 * **The narrowing parameters are the lineups route's, deliberately.**
 * `?season=`, `?user=`, `?ktc_board=` and `?qb_board=` decide which boards answer, and
 * a past roster priced on a different board from the card in front of the rail
 * is not a comparison — it is two numbers on two rulers. `?user=` is the one
 * that looks out of place on a league-scoped read and is the one that matters
 * most: the ADP fallback board is built from *that manager's* synced drafts, so
 * without it the three capital metrics have nothing to price against and rank
 * null. Omitting it is allowed and costs exactly that.
 *
 * **`?qb_board=` is the axis `?ktc_board=` always lacked**, and it arrived with
 * the teams pane's column picker: a market is KeepTradeCut's own, where which
 * of the two QB columns a roster is priced on is a fact about the league that
 * *both* priced valuations split on. The card in front of this rail can force
 * one now, so the rail has to be able to follow it — a past stop on the
 * league's own board beside a present one on `sf` is the two-rulers reading
 * every parameter here exists to prevent.
 *
 * A malformed `?season=` is a 400 on `parseRequestedSeason`'s own terms — a
 * season names *which data* this is about — while an unreadable `?ktc_board=`
 * or `?qb_board=` falls back to `auto`, which is the opposite call for the
 * opposite reason. An
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
  context: { params: Promise<{ leagueId: string }> },
) {
  // Interactive Sleeper traffic — a reader is waiting on this handler, so the
  // reads under it are bounded rather than queueing behind a crawl batch. No
  // `signal`: see `shared/sleeper/request-policy`, which is where both halves
  // of that decision are argued.
  return withInteractiveSleeper(() => readLeagueTimeline(request, context));
}

async function readLeagueTimeline(
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
        qbBoard: parseKtcLineupChoice(url.searchParams.get("qb_board")),
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
 * Store the season before the oldest one this database holds for the league —
 * see {@link extendLeagueHistory}, which is where every bound and every decision
 * lives. This handler is the wire and nothing else.
 *
 * **POST beside a GET that reads, on one resource, and the pairing is the
 * point.** The GET answers a league's history and is bound by what is stored;
 * this is how a reader makes there be more of it. Keeping the write on the same
 * path is what stops the read from quietly becoming one — the rule
 * `getLeagueTimeline` states, that it reads stored rows and fetches nothing,
 * survives precisely because extending is a different method rather than a
 * side-effect of asking.
 *
 * **The league id in the path is the card's own**, not the far end of the chain:
 * the walk to the end happens on the server, since the client learns where the
 * end is from a payload that may be a minute old and a stale id would name a
 * season somebody else has since loaded.
 *
 * **Every answer but `unknown` is a 200**, `POST /sync`'s own shape decision: a
 * chain that has genuinely ended, a race and a shed permit are outcomes rather
 * than failures, and a 4xx for any of them would put a browser-console error
 * against a league in perfectly good order.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  try {
    const result = await extendLeagueHistory(leagueId);
    if (result.status === "unknown") {
      const error: ApiErrorPayload = { error: "League not found" };
      return NextResponse.json(error, { status: 404 });
    }
    return NextResponse.json(historyPayload(result));
  } catch (error) {
    // `extendLeagueHistory` turns everything Sleeper can do into a status, so
    // reaching here means the database did not answer — which is not this
    // league's problem and not something a reader can act on by pressing again.
    console.error(`[league] history load failed for ${leagueId}:`, error);
    const body: ApiErrorPayload = { error: "Failed to load the earlier season" };
    return NextResponse.json(body, { status: 500 });
  }
}

/** The union, flattened onto the wire — see {@link LeagueHistoryPayload}. */
function historyPayload(
  result: Exclude<LeagueHistoryResult, { status: "unknown" }>,
): LeagueHistoryPayload {
  return {
    league_id: "leagueId" in result ? result.leagueId : null,
    status: result.status,
    loaded: result.status === "added" || result.status === "fresh",
  };
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
