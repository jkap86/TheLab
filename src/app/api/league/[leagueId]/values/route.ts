import { NextResponse } from "next/server";

import type { LeagueValuesPayload } from "@/shared/contract";
import {
  getKtcValuesBySleeperId,
  isSuperflexLineup,
  ktcBoardValue,
} from "@/shared/ktc";
import type { KtcValueSet } from "@/shared/ktc";
import {
  ADP_VALUE_PARAMS,
  adpBoardFor,
  adpBoardTypeOf,
  adpValue,
  getDraftAdpForPlayers,
  leagueAdpPool,
  parseAdpBoardChoices,
  parseSteepness,
} from "@/shared/manager";
import type { LeagueDetail, PlayerBoardAdp } from "@/shared/manager";
import { readOptional } from "@/shared/util";

import { resolveLeagueRequest } from "../league-request";
import { readFailureResponse } from "../../../read-failure";
import { withReadTiming } from "../../../read-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The league panel's two value columns: every rostered player's KeepTradeCut
 * price and his crawled-ADP draft capital, on the board this league reads.
 *
 * **The one enrichment that depends on the ADP drawer**, which is why it is a
 * route of its own rather than a field on the core payload. A reader narrowing
 * the board to startup drafts re-prices these two columns and nothing else on
 * the panel; carried on one payload, that narrowing re-fetched a dozen rosters,
 * their managers, their picks and several hundred player names to move two
 * numbers.
 *
 * Board matters and travels with the numbers: a quarterback is a first-round
 * asset on the superflex board and a bench piece on the 1QB one, so a roster read
 * off the wrong board is wrong at every position. KTC and ADP are fetched
 * independently and each guards its own failure — pricing a roster is a bonus on
 * top of the standings, so a lens that can't answer costs its column and nothing
 * more, and a failure here never reaches the rosters at all now that they are
 * somebody else's response.
 *
 * It answers a POST as readily as a GET, for `/api/adp`'s own reason: the
 * board's league rules resolve to more ids than a request line can carry.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  return leagueValues(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  return leagueValues(request, context);
}

async function leagueValues(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const resolved = await resolveLeagueRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { leagueId, detail, searchParams, scope } = resolved;

  // Resolved after the league, because the league's own season is what an
  // unbounded board falls back to. Rejected rather than defaulted, the answer
  // `/api/adp` gives the same vocabulary — this string is one the client builds
  // from its own controls, so a 400 is a bug on that side of the wire.
  const board = parseAdpBoardChoices(searchParams, detail.season, scope);
  if (!board.ok) return NextResponse.json({ error: board.error }, { status: 400 });
  const halvings = parseSteepness(searchParams.get(ADP_VALUE_PARAMS.steepness));

  try {
    const payload: LeagueValuesPayload = await withReadTiming(
      "league.values",
      `league=${leagueId}`,
      () => priceRosters({ leagueId, detail, board: board.board, halvings }),
    );
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[league] values failed for ${leagueId}:`, error);
    return readFailureResponse(error, "Failed to price this league");
  }
}

/**
 * Prices every rostered player on the two lenses the roster panel offers as
 * value columns — KeepTradeCut and crawled ADP — resolved to the board this
 * league reads.
 *
 * **Two reads where there used to be three.** The third was
 * `getLeagueAdpBoards([leagueId])`, asking `leagues` which market this one
 * league plays in — a fact the league read above had already selected and then
 * dropped. It is carried out as `LeagueDetail.league_type` now, so the board
 * type is `adpBoardTypeOf` over something already in hand rather than a second
 * round trip for one row of a table this request has read.
 *
 * The two that remain start together and each guards its own failure inside the
 * `Promise.all`: nothing here rejects, so this is a join and not a fail-fast
 * batch.
 */
async function priceRosters(args: {
  leagueId: string;
  detail: LeagueDetail;
  /** The ADP drawer's board and curve. */
  board: Parameters<typeof adpBoardFor>[0]["board"];
  halvings: number;
}): Promise<LeagueValuesPayload> {
  const { leagueId, detail, board: chosenBoard, halvings } = args;
  const { season, roster_positions: rosterPositions } = detail;
  const scoringSettings = detail.scoring_settings;
  const playerIds = [...new Set(detail.teams.flatMap((t) => t.players))];
  const superflex = isSuperflexLineup(rosterPositions);

  // Which population the ADP is averaged over: the reader's board, matched to
  // this league's own scoring and lineup.
  const board = adpBoardFor({
    season,
    rosterPositions,
    scoringSettings,
    board: chosenBoard,
  });

  // Each guards its own failure, so one lens going down costs its column and not
  // the other's — that half is unchanged and is the whole reason this is a join
  // rather than a fail-fast batch. What is new is that the guard *reports*:
  // the empty `{}`/`new Map()` these used to substitute is precisely what a
  // roster of unpriced players legitimately produces, so a failed read arrived as
  // a successful "nothing priced" and sat in the browser cache as one.
  const [ktcRead, adpRead] = await Promise.all([
    readOptional(`[league] KTC for ${leagueId}`, () =>
      getKtcValuesBySleeperId(playerIds),
    ),
    readOptional(`[league] ADP for ${leagueId}`, () =>
      getDraftAdpForPlayers(board, playerIds),
    ),
  ]);

  // The empty forms are still what the payload is built from — a failed lens
  // draws em dashes, not zeroes — but they are now reached only through a
  // `status` that says so.
  const ktcSet: KtcValueSet = ktcRead.value ?? { values: {}, updated_at: null };
  const adpResult: {
    draft_count: number;
    redraft_drafts: number;
    dynasty_drafts: number;
    values: Map<string, PlayerBoardAdp>;
  } = adpRead.value ?? {
    draft_count: 0,
    redraft_drafts: 0,
    dynasty_drafts: 0,
    values: new Map(),
  };

  const ktc: Record<string, number> = {};
  for (const [id, value] of Object.entries(ktcSet.values)) {
    // An id KTC prices on neither board (a kicker, a defence) is left absent, not
    // zeroed — being off the board is a different claim from being worth nothing.
    const priced = ktcBoardValue(superflex, value);
    if (priced !== null) ktc[id] = priced;
  }

  // The fetch answers both league-type boards; this league reads its own side,
  // off the type its own row already carries.
  const boardType = adpBoardTypeOf(detail.league_type);

  // The pool is this league's own — teams × its starting slots — where the curve
  // applied across it is the reader's. Both halves matter: two leagues on one
  // board are still priced on their own size, and a panel and the card that
  // opened it are priced on one curve.
  const pool = leagueAdpPool(detail.teams.length, rosterPositions);

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
    ktc_status: ktcRead.status,
    adp_status: adpRead.status,
    adp_board: boardType,
    adp_draft_count:
      boardType === "dynasty" ? adpResult.dynasty_drafts : adpResult.redraft_drafts,
    ktc,
    adp,
    adp_position,
  };
}
