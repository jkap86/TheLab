import { NextResponse } from "next/server";

import type { ApiErrorPayload, LeagueDetailPayload } from "@/shared/contract";
import { getLeagueDetail } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { getLeagueOutlook } from "@/shared/projections";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * League detail for the expanded league view: standings + every team's roster,
 * with player ids resolved to names, manager avatar ids resolved to URLs, and
 * each roster's optimal rest-of-season lineup.
 *
 *   {"league_id":"...","teams":[...],"players":{id:{…}},"outlook":{"teams":[…]}}
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

  const [players, outlook] = await Promise.all([
    getPlayersByIds(playerIds),
    // The rosters are the point of this route and the projections are a bonus on
    // top, so a projections read that fails costs the lineups, not the league.
    getLeagueOutlook({
      season: detail.season,
      rosterPositions: detail.roster_positions,
      scoringSettings: detail.scoring_settings,
      teams: detail.teams,
    }).catch((error) => {
      console.error(`[league] outlook failed for ${leagueId}:`, errorMessage(error));
      return null;
    }),
  ]);

  const payload: LeagueDetailPayload = {
    league_id: detail.league_id,
    name: detail.name,
    season: detail.season,
    status: detail.status,
    roster_positions: detail.roster_positions,
    scoring_settings: detail.scoring_settings,
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
    outlook,
  };

  return NextResponse.json(payload);
}
