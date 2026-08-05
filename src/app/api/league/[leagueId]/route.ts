import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeagueDetailPayload,
  LeagueRosterValues,
} from "@/shared/contract";
import {
  getKtcValuesBySleeperId,
  isSuperflexLineup,
  ktcBoardValue,
} from "@/shared/ktc";
import type { KtcValueSet } from "@/shared/ktc";
import {
  DEFAULT_STEEPNESS,
  adpBoardFor,
  adpValue,
  getDraftAdpForPlayers,
  getLeagueAdpBoards,
  getLeagueDetail,
  leagueAdpPool,
} from "@/shared/manager";
import type { AdpBoardType, PlayerBoardAdp } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { getLeagueOutlook } from "@/shared/projections";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { readFailureResponse } from "../../read-failure";

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
  teams: number;
  playerIds: string[];
  rosterPositions: string[] | null;
  scoringSettings: Record<string, number> | null;
}): Promise<LeagueRosterValues> {
  const { leagueId, season, teams, playerIds, rosterPositions, scoringSettings } =
    args;
  const superflex = isSuperflexLineup(rosterPositions);

  const [ktcSet, adpBoards] = await Promise.all([
    getKtcValuesBySleeperId(playerIds).catch((error): KtcValueSet => {
      console.error(`[league] KTC failed for ${leagueId}:`, errorMessage(error));
      return { values: {}, updated_at: null };
    }),
    getLeagueAdpBoards([leagueId]).catch((error): Map<string, AdpBoardType> => {
      console.error(
        `[league] ADP board failed for ${leagueId}:`,
        errorMessage(error),
      );
      return new Map();
    }),
  ]);

  const ktc: Record<string, number> = {};
  for (const [id, value] of Object.entries(ktcSet.values)) {
    // An id KTC prices on neither board (a kicker, a defence) is left absent, not
    // zeroed — being off the board is a different claim from being worth nothing.
    const priced = ktcBoardValue(superflex, value);
    if (priced !== null) ktc[id] = priced;
  }

  // The fetch answers both league-type boards; this league reads its own side.
  const boardType = adpBoards.get(leagueId) ?? "redraft";
  const board = adpBoardFor({ season, rosterPositions, scoringSettings });
  const adpResult = await getDraftAdpForPlayers(board, playerIds).catch(
    (error): {
      draft_count: number;
      redraft_drafts: number;
      dynasty_drafts: number;
      values: Map<string, PlayerBoardAdp>;
    } => {
      console.error(`[league] ADP failed for ${leagueId}:`, errorMessage(error));
      return { draft_count: 0, redraft_drafts: 0, dynasty_drafts: 0, values: new Map() };
    },
  );

  // This panel offers no steepness control, so it reads the default the
  // collapsed card's ADP metric also starts from.
  const pool = leagueAdpPool(teams, rosterPositions);
  const halvings = DEFAULT_STEEPNESS;

  const adp: Record<string, number> = {};
  const adp_position: Record<string, number> = {};
  for (const [id, boards] of adpResult.values) {
    const entry = boards[boardType];
    if (!entry) continue;
    adp[id] = adpValue(entry.adp, pool, halvings);
    adp_position[id] = entry.adp;
  }

  return {
    superflex,
    ktc_updated_at: ktcSet.updated_at,
    adp_board: boardType,
    adp_draft_count:
      boardType === "dynasty" ? adpResult.dynasty_drafts : adpResult.redraft_drafts,
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

  try {
    return await leaguePayload(leagueId);
  } catch (error) {
    console.error(`[league] query failed for ${leagueId}:`, error);
    return readFailureResponse(error, "Failed to load league");
  }
}

async function leaguePayload(leagueId: string) {
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
      teams: detail.teams.length,
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
