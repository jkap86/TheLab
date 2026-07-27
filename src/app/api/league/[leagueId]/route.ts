import { NextResponse } from "next/server";

import { getLeagueDetail } from "@/shared/manager";
import type { ApiErrorPayload, LeagueDetailPayload } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { sleeperAvatarUrl } from "@/shared/sleeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * League detail for the expanded league view: standings + every team's roster,
 * with player ids resolved to names and manager avatar ids resolved to URLs.
 *
 *   {"league_id":"...","name":"...","teams":[...],"players":{id:{name,position,team}}}
 *
 * 404s when the league isn't cached (the manager's leagues must be synced first).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  const detail = await getLeagueDetail(leagueId);
  if (!detail) {
    const error: ApiErrorPayload = { error: "League not found" };
    return NextResponse.json(error, { status: 404 });
  }

  const playerIds = [...new Set(detail.teams.flatMap((t) => t.players))];
  const players = await getPlayersByIds(playerIds);

  const payload: LeagueDetailPayload = {
    league_id: detail.league_id,
    name: detail.name,
    season: detail.season,
    status: detail.status,
    roster_positions: detail.roster_positions,
    teams: detail.teams.map(({ manager, ...team }) => ({
      ...team,
      manager: manager
        ? {
            user_id: manager.user_id,
            display_name: manager.display_name,
            team_name: manager.team_name,
            avatar_url: sleeperAvatarUrl(manager.avatar, "thumb"),
          }
        : null,
    })),
    players,
  };

  return NextResponse.json(payload);
}
