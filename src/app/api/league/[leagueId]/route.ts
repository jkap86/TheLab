import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeagueDetailPayload,
  LeagueRosterValues,
  LeagueWeekViewPayload,
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
import { getLeagueOutlook, LAST_REGULAR_WEEK } from "@/shared/projections";
import { integer } from "@/shared/query";
import type { LeagueScopeBody } from "@/shared/query";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { getLeagueWeekView } from "@/shared/stats";
import type { LeagueWeekView } from "@/shared/stats";
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

  // Absent is the common case — the leagues list and the trades board open this
  // panel on a season, not a week — so the whole week read below is skipped
  // rather than run against a week nobody asked about.
  const week = integer(searchParams, "week", {
    min: 1,
    max: LAST_REGULAR_WEEK,
    fallback: null,
  });
  if (!week.ok) return NextResponse.json({ error: week.error }, { status: 400 });

  const playerIds = [...new Set(detail.teams.flatMap((t) => t.players))];

  const [players, outlook, values, weekView] = await Promise.all([
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
    // Judged per read, like the outlook above it and for the same reason: this
    // is two columns on top of a panel whose point is the rosters, so a week
    // that can't be read costs the columns rather than the league. Undefined
    // where none was asked for, which is what keeps "not requested" distinct
    // from "requested and empty" on the wire.
    week.value === null
      ? Promise.resolve(undefined)
      : getLeagueWeekView({
          leagueId,
          season: detail.season,
          week: week.value,
          teams: detail.teams,
          rosterPositions: detail.roster_positions,
          scoringSettings: detail.scoring_settings,
          bestBall: detail.best_ball,
        }).catch((error) => {
          console.error(
            `[league] week ${week.value} failed for ${leagueId}:`,
            errorMessage(error),
          );
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
    best_ball: detail.best_ball,
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
    week_view: weekView === undefined ? undefined : serializeWeekView(weekView),
  };

  return NextResponse.json(payload);
}

/**
 * The week view's `Map`s as JSON objects.
 *
 * Maps are the right shape in the domain — the keys are ids and the lookups are
 * per row — and they serialise to `{}`, so the conversion has to be explicit.
 * Roster ids are numbers there and become strings here, which is what JSON keys
 * are; the client indexes with a template string rather than pretending
 * otherwise.
 *
 * `ppg_source.weeks` crosses as a **count** rather than the list: what a reader
 * needs is how much the average is out of, and each row already carries its own
 * `games` for the case that actually varies (a player who missed two of them).
 */
function serializeWeekView(
  view: LeagueWeekView | null,
): LeagueDetailPayload["week_view"] {
  if (!view) return null;

  const projection: Record<string, number> = {};
  for (const [id, points] of view.projection) projection[id] = points;

  const ppg: Record<string, { average: number; games: number }> = {};
  for (const [id, reading] of view.ppg) {
    ppg[id] = { average: reading.average, games: reading.games };
  }

  const team_projection: LeagueWeekViewPayload["team_projection"] = {};
  for (const [rosterId, lineup] of view.team_projection) {
    // Structurally the payload's own shape already — the lineup's points were
    // dropped upstream, where the reason belongs — so this is the key conversion
    // and nothing else.
    team_projection[String(rosterId)] = lineup;
  }

  const team_ppg: LeagueWeekViewPayload["team_ppg"] = {};
  for (const [rosterId, reading] of view.team_ppg) {
    team_ppg[String(rosterId)] = {
      average: reading.average,
      games: reading.games,
    };
  }

  // Already the payload's own shape — the domain type *is* the wire type here —
  // so this is the `Map` → object conversion and nothing else. Every team the
  // schedule named crosses, not only the ones these rosters hold: a team absent
  // from a non-empty map is what says "bye", so trimming it to the rosters would
  // make every unrostered club read as one.
  const games: LeagueWeekViewPayload["games"] = {};
  for (const [team, game] of view.games) games[team] = game;

  return {
    week: view.week,
    ppg_source: {
      season: view.ppg_source.season,
      weeks: view.ppg_source.weeks.length,
      prior: view.ppg_source.prior,
    },
    projection,
    ppg,
    team_projection,
    team_ppg,
    games,
  };
}
