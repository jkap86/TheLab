import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeagueDetailPayload,
  LeagueRosterValues,
} from "@/shared/contract";
import { getKtcValuesBySleeperId, isSuperflexLineup } from "@/shared/ktc";
import type { KtcValueSet } from "@/shared/ktc";
import {
  adpBoardFor,
  adpValue,
  getDraftAdpForPlayers,
  getLeagueDetail,
  getLeagueTypes,
} from "@/shared/manager";
import type { LeagueType, PlayerAdp } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { getLeagueOutlook } from "@/shared/projections";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prices every rostered player on the two lenses the roster panel offers as
 * value columns — KeepTradeCut and crawled ADP — resolved to the board this
 * league reads.
 *
 * Board matters and travels with the numbers: a quarterback is a first-round
 * asset on the superflex board and a bench piece on the 1QB one, so a roster read
 * off the wrong board is wrong at every position. KTC and ADP are fetched
 * independently and each guards its own failure — pricing a roster is a bonus on
 * top of the standings, so a lens that can't answer costs its column and nothing
 * more.
 */
async function priceRosters(args: {
  leagueId: string;
  season: string;
  playerIds: string[];
  rosterPositions: string[] | null;
  scoringSettings: Record<string, number> | null;
}): Promise<LeagueRosterValues> {
  const { leagueId, season, playerIds, rosterPositions, scoringSettings } = args;
  const superflex = isSuperflexLineup(rosterPositions);

  const [ktcSet, leagueTypes] = await Promise.all([
    getKtcValuesBySleeperId(playerIds).catch((error): KtcValueSet => {
      console.error(`[league] KTC failed for ${leagueId}:`, errorMessage(error));
      return { values: {}, updated_at: null };
    }),
    getLeagueTypes([leagueId]).catch((error): Map<string, LeagueType> => {
      console.error(
        `[league] league type failed for ${leagueId}:`,
        errorMessage(error),
      );
      return new Map();
    }),
  ]);

  const ktc: Record<string, number> = {};
  for (const [id, value] of Object.entries(ktcSet.values)) {
    // An id KTC prices on neither board (a kicker, a defence) is left absent, not
    // zeroed — being off the board is a different claim from being worth nothing.
    const priced = superflex ? value.sf : value.oneqb;
    if (priced !== null && priced !== undefined) ktc[id] = priced;
  }

  const leagueType = leagueTypes.get(leagueId) ?? "redraft";
  const board = adpBoardFor({ season, rosterPositions, scoringSettings, leagueType });
  const adpResult = await getDraftAdpForPlayers(board, playerIds).catch(
    (error): { draft_count: number; values: Map<string, PlayerAdp> } => {
      console.error(`[league] ADP failed for ${leagueId}:`, errorMessage(error));
      return { draft_count: 0, values: new Map() };
    },
  );

  const adp: Record<string, number> = {};
  const adp_position: Record<string, number> = {};
  for (const [id, { adp: position }] of adpResult.values) {
    adp[id] = adpValue(position);
    adp_position[id] = position;
  }

  return {
    superflex,
    ktc_updated_at: ktcSet.updated_at,
    adp_league_type: leagueType,
    adp_draft_count: adpResult.draft_count,
    ktc,
    adp,
    adp_position,
  };
}

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

  const [players, outlook, values] = await Promise.all([
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
    priceRosters({
      leagueId,
      season: detail.season,
      playerIds,
      rosterPositions: detail.roster_positions,
      scoringSettings: detail.scoring_settings,
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
    values,
  };

  return NextResponse.json(payload);
}
