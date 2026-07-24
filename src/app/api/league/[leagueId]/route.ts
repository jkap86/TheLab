import { NextResponse } from "next/server";

import { getLeagueDetail } from "@/shared/manager";
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
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const playerIds = [...new Set(detail.teams.flatMap((t) => t.players))];
  const players = await getPlayersByIds(playerIds);

  return NextResponse.json({
    league_id: detail.league_id,
    name: detail.name,
    season: detail.season,
    status: detail.status,
    roster_positions: detail.roster_positions,
    teams: detail.teams.map((t) => ({
      ...t,
      manager: t.manager
        ? { ...t.manager, avatar_url: sleeperAvatarUrl(t.manager.avatar, "thumb") }
        : null,
    })),
    players,
  });
}
