import { NextResponse } from "next/server";

import type { ApiErrorPayload, ManagerGametimePayload } from "@/shared/contract";
import { buildGametimePayload, readWeekFeeds } from "@/shared/gametime";
import { getManagerWeekLineups } from "@/shared/manager";
import { currentWeek, parseRequestedWeek } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState, withInteractiveSleeper } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One week of every league's lineup, priced live — see
 * {@link ManagerGametimePayload}.
 *
 * The lineup-check route's twin: the same manager, the same season and week
 * resolution, the same stored lineups. What differs is what they are read
 * *against* — three feeds rather than one, each degrading on its own (see
 * `readWeekFeeds`).
 *
 * **What this route is for is the stream failing.** The page follows the week
 * over the SSE route beside this one and asks for a body here only when that
 * connection cannot be established or kept — one snapshot, held and marked not
 * live, rather than a poll (see `useGametime`). It is also the answer for
 * anything that cannot hold a stream open at all.
 *
 * **It carries no `?league=` narrowing.** The checker's route has one because
 * that page reads once and its Sync key re-reads a single card; nothing on a
 * page whose numbers move on their own ever asked for one league, and the
 * parameter's only caller went with that key.
 *
 * Two of the checker's three failures are the same here: the database read is
 * a 500, and a failed projections read is `projections: "error"` with no
 * leagues. The third is two feeds instead of one, and neither empties the page
 * — a failed stats read prices the week as a projection and a failed
 * scoreboard read prices every projection whole, each said on the payload.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
) {
  // Interactive Sleeper traffic — a reader is waiting on this handler, so the
  // reads under it are bounded rather than queueing behind a crawl batch. No
  // `signal`: see `shared/sleeper/request-policy`, which is where both halves
  // of that decision are argued.
  return withInteractiveSleeper(() => readGametime(request, context));
}

async function readGametime(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }
  const userId = resolved.user.user_id;

  const searchParams = new URL(request.url).searchParams;
  const requestedSeason = parseRequestedSeason(searchParams.get("season"));
  if (requestedSeason && !requestedSeason.ok) {
    const error: ApiErrorPayload = { error: requestedSeason.error };
    return NextResponse.json(error, { status: 400 });
  }
  const requestedWeek = parseRequestedWeek(searchParams.get("week"));
  if (requestedWeek && !requestedWeek.ok) {
    const error: ApiErrorPayload = { error: requestedWeek.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requestedSeason?.season ?? (await getActiveSeason());

  try {
    const week = requestedWeek?.week ?? (await currentWeek(season, getNflState));
    if (week === null) {
      const empty: ManagerGametimePayload = {
        season,
        week: null,
        projections: "ok",
        stats: "ok",
        scores: "ok",
        read_at: Date.now(),
        games: { pre: 0, live: 0, final: 0 },
        board: {},
        players: {},
        leagues: {},
      };
      return NextResponse.json(empty);
    }

    const leagues = await getManagerWeekLineups(userId, season, week);
    const feeds = await readWeekFeeds(season, week);
    const payload = buildGametimePayload({ season, week, leagues, feeds });
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[gametime] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load lineups" };
    return NextResponse.json(payload, { status: 500 });
  }
}
