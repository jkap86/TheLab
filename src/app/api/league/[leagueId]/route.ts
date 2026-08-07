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
  ADP_VALUE_PARAMS,
  adpBoardFor,
  adpValue,
  getDraftAdpForPlayers,
  getLeagueAdpBoards,
  getLeagueDetail,
  leagueAdpPool,
  markLeaguesAccessed,
  parseAdpBoardChoices,
  parseSteepness,
} from "@/shared/manager";
import type { AdpBoardChoices, AdpBoardType, PlayerBoardAdp } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import type { LeagueScopeBody } from "@/shared/query";
import { getLeagueOutlook } from "@/shared/projections";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { readLeagueScope } from "../../league-scope";
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
  /** The ADP drawer's board and curve — see {@link GET}. */
  board: AdpBoardChoices;
  halvings: number;
}): Promise<LeagueRosterValues> {
  const {
    leagueId,
    season,
    teams,
    playerIds,
    rosterPositions,
    scoringSettings,
    board: chosenBoard,
    halvings,
  } = args;
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
  const board = adpBoardFor({
    season,
    rosterPositions,
    scoringSettings,
    board: chosenBoard,
  });
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

  // The pool is this league's own — teams × its starting slots — where the curve
  // applied across it is the reader's. Both halves matter: two leagues on one
  // board are still priced on their own size, and a panel and the card that
  // opened it are priced on one curve.
  const pool = leagueAdpPool(teams, rosterPositions);

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
 *
 * Its two value columns are priced off the ADP drawer, exactly as the collapsed
 * card above it is — the same query string, the same parser, the same curve. The
 * panel used to read `DEFAULT_STEEPNESS` and an unnarrowed board on the grounds
 * that it offers no controls of its own, which was true and stopped being the
 * point once the drawer started driving the card: a rookie's ADP in this list
 * would read off a pool of rookie drafts while the card that opened it was
 * priced off startups. A panel driven by a selection has to be driven by the
 * *same* selection.
 *
 * The board's season still arrives as `board_season` though nothing here reads
 * `?season` — see {@link parseAdpBoardChoices} for why one spelling beats a
 * second that is only accidentally free. With no board sent at all this answers
 * exactly as it did before: the league's own season, whole, at the default curve.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  return leagueDetail(request, context);
}

/**
 * The same read, with the board's league scope in the body — see `/api/adp`'s
 * own POST for why a read answers one at all. The rosters don't depend on the
 * board; the panel's two value columns do, and they have to read the same board
 * the card that opened them was priced on.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  return leagueDetail(request, context);
}

async function leagueDetail(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;
  const searchParams = new URL(request.url).searchParams;

  try {
    return await leaguePayload(leagueId, searchParams, await readLeagueScope(request));
  } catch (error) {
    console.error(`[league] query failed for ${leagueId}:`, error);
    return readFailureResponse(error, "Failed to load league");
  }
}

async function leaguePayload(
  leagueId: string,
  searchParams: URLSearchParams,
  scope: LeagueScopeBody,
) {
  const detail = await getLeagueDetail(leagueId);
  if (!detail) {
    const error: ApiErrorPayload = { error: "League not found" };
    return NextResponse.json(error, { status: 404 });
  }

  // Somebody opened this league's panel, which is the second of the two places
  // this app can *observe* demand rather than infer it — it moves the league up
  // the crawler's refresh queue and does nothing else, so it is fired off rather
  // than awaited. See `shared/manager/crawl-priority`.
  void markLeaguesAccessed([leagueId]).catch((error) => {
    console.warn(`[league] demand stamp failed for ${leagueId}:`, errorMessage(error));
  });

  // Resolved after the league, because the league's own season is what an
  // unbounded board falls back to. Rejected rather than defaulted, the answer
  // `/api/adp` gives the same vocabulary — this string is one the client builds
  // from its own controls, so a 400 is a bug on that side of the wire.
  const board = parseAdpBoardChoices(searchParams, detail.season, scope);
  if (!board.ok) return NextResponse.json({ error: board.error }, { status: 400 });
  const halvings = parseSteepness(searchParams.get(ADP_VALUE_PARAMS.steepness));

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
      board: board.board,
      halvings,
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
