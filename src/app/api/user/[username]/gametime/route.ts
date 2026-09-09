import { NextResponse } from "next/server";

import type { ApiErrorPayload, ManagerGametimePayload } from "@/shared/contract";
import { buildGametimePayload, readWeekFeeds } from "@/shared/gametime";
import { getManagerWeekLineups } from "@/shared/manager";
import { currentWeek, parseRequestedWeek } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One week of every league's lineup, priced live — see
 * {@link ManagerGametimePayload}.
 *
 * The lineup-check route's twin: the same manager, the same season and week
 * resolution, the same stored lineups, the same `?league=` narrowing for the
 * re-read that follows a Sync press. What differs is what the lineups are read
 * *against* — three feeds rather than one, each degrading on its own (see
 * `readWeekFeeds`) — and that the page reads this over the stream beside it
 * rather than once: this route is the first paint, the narrowed re-read, and
 * the answer for anything that cannot hold a stream open.
 *
 * Two of the checker's three failures are the same here: the database read is
 * a 500, and a failed projections read is `projections: "error"` with no
 * leagues. The third is two feeds instead of one, and neither empties the page
 * — a failed stats read prices the week as a projection and a failed
 * scoreboard read prices every projection whole, each said on the payload.
 */
export async function GET(
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
  const requestedLeague = searchParams.get("league")?.trim() || undefined;

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
        leagues: {},
      };
      return NextResponse.json(empty);
    }

    const leagues = await getManagerWeekLineups(userId, season, week, requestedLeague);
    const feeds = await readWeekFeeds(season, week);
    const payload = buildGametimePayload({ season, week, leagues, feeds });
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[gametime] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load lineups" };
    return NextResponse.json(payload, { status: 500 });
  }
}
