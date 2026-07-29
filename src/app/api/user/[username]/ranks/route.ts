import { NextResponse } from "next/server";

import type { ManagerRanksPayload } from "@/shared/contract";
import { getManagerLeagueRosters, projectedRank } from "@/shared/manager";
import { getWeeklyTeamPoints } from "@/shared/projections";

import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manager's projected-points rank in each of their leagues, read from cache
 * and nothing else — see {@link ManagerRanksPayload}.
 *
 * One batch request rather than a rank per league card because the leagues page
 * shows a hundred-plus collapsed cards at once, and a collapsed card costs no
 * request of its own; the batch read shares the projection queries across every
 * league where a per-league loop would repeat them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, season } = resolved;

  // Sequential rather than parallel: which rosters to project is the answer to
  // the first read.
  const leagues = await getManagerLeagueRosters(userId, season);
  const { weeks, points } = await getWeeklyTeamPoints({
    season,
    leagues: leagues.map((l) => ({
      league_id: l.league_id,
      rosterPositions: l.roster_positions,
      scoringSettings: l.scoring_settings,
      teams: l.teams,
    })),
  });

  const ranks: ManagerRanksPayload["ranks"] = {};
  for (const league of leagues) {
    const own = league.teams.find((t) => t.owner_id === userId);
    const totals = points.get(league.league_id);
    if (!own || !totals) continue;

    const rank = projectedRank(totals, own.roster_id);
    if (rank) ranks[league.league_id] = rank;
  }

  const payload: ManagerRanksPayload = { season, weeks, ranks };
  return NextResponse.json(payload);
}
