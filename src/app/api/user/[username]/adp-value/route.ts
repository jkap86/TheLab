import { NextResponse } from "next/server";

import type { ManagerAdpValuePayload } from "@/shared/contract";
import { databaseBudget } from "@/shared/db";
import { isSuperflexLineup } from "@/shared/ktc";
import {
  ADP_VALUE_PARAMS,
  adpBoardFor,
  adpValue,
  boardSignature,
  getDraftAdpForPlayers,
  getLeagueAdpBoards,
  getManagerLeagueRosters,
  leagueAdpPool,
  parseAdpBoardChoices,
  parseSteepness,
  rankOf,
  rosterAdpValue,
} from "@/shared/manager";
import type { AdpBoardChoices, AdpBoardType, AdpFilters } from "@/shared/manager";
import { getOptimalLineups } from "@/shared/projections";
import { collectWithConcurrency, errorMessage } from "@/shared/util";

import { readLeagueScope } from "../../../league-scope";
import { readFailureResponse } from "../../../read-failure";
import { resolveManagerIdRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the manager's roster in each of their leagues is worth valued off crawled
 * ADP, and where its starter value ranks among their leaguemates — see
 * {@link ManagerAdpValuePayload}.
 *
 * A third team-value lens beside the `ktc` and `ranks` routes: KTC prices a
 * *dynasty* asset and the projected ranks model a *season*, where this reads the
 * *market consensus* of the drafts this app has crawled. It is batched like those
 * two and for the same reason — a collapsed card costs no request, so the reads
 * behind the column are shared across every league rather than repeated per card.
 *
 * ADP pooled across different games is meaningless, so each league is priced
 * against the board most like it: superflex and scoring pick the fetch, and the
 * fetch answers the redraft and dynasty markets side by side. Leagues that share
 * a fetch share a single query: the boards are grouped by {@link boardSignature}
 * and fetched once each, not once per league.
 *
 * **Both league-type boards are priced for every league**, where this used to
 * read only the side matching the league's own type. One reading made a column
 * of these incomparable down a list holding leagues of both kinds, and the other
 * side is not a mistake to be guarded against but a second lens on the same
 * roster — a dynasty team's redraft value is what a win-now market would pay for
 * it. It costs no extra query: the values for both markets are already in the
 * fetch, so what doubles is a curve and a sum over ids already in memory. The
 * league's own market still travels, as `board`, to say which column is native.
 *
 * The population *inside* that match is the reader's, sent by the ADP drawer —
 * the window, the kind of draft, the league size and the format. See
 * {@link AdpBoardChoices} for why those cross the wire and `scoring`/`superflex`
 * deliberately don't, and {@link parseAdpBoardChoices} for why the season arrives
 * under a name of its own. The expanded panel this card opens prices its own two
 * value columns off the same board, through the same parser.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
) {
  return adpValues(request, context);
}

/**
 * The same read, with the board's league scope in the body.
 *
 * A read answering a POST, for the reason `/api/adp` and `/api/trades` do: the
 * drawer's league rules resolve to a list of ids that a request line cannot
 * carry, and the whole point of the board reaching these cards is that they are
 * priced on the board the drawer is showing. Nothing else about the request
 * differs — same query string, same parser, same handler — which is what keeps
 * the long-scope case from being a second code path.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ username: string }> },
) {
  return adpValues(request, context);
}

async function adpValues(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerIdRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { username, userId, season, searchParams } = resolved;

  // The steepness of the value curve, chosen on the ADP drawer's slider and sent
  // as a number of halvings; junk falls back to the default and an out-of-range
  // value clamps rather than being trusted.
  const halvings = parseSteepness(searchParams.get(ADP_VALUE_PARAMS.steepness));

  // Rejected rather than clamped, unlike the steepness beside it: an
  // out-of-range curve is a caller asking for more of something real, where an
  // unparseable date has no nearest sane value to fall back to. The same answer
  // `/api/adp` gives the same vocabulary, and this string is one the client
  // builds from its own controls — a 400 here is a bug on this side of the wire.
  const board = parseAdpBoardChoices(
    searchParams,
    season,
    await readLeagueScope(request),
  );
  if (!board.ok) return NextResponse.json({ error: board.error }, { status: 400 });

  try {
    return await adpValuePayload(username, userId, season, halvings, board.board);
  } catch (error) {
    console.error("[adp-value] query failed:", error);
    return readFailureResponse(error, "Failed to load ADP values");
  }
}

async function adpValuePayload(
  username: string,
  userId: string,
  season: string,
  halvings: number,
  chosenBoard: AdpBoardChoices,
) {
  const leagues = await getManagerLeagueRosters(userId, season);
  const withOwn = leagues.filter((league) =>
    league.teams.some((t) => t.owner_id === userId),
  );

  if (withOwn.length === 0) {
    const empty: ManagerAdpValuePayload = { season, weeks: [], leagues: {} };
    return NextResponse.json(empty);
  }

  // The league type isn't carried on the roster set (only the ADP board needs
  // it), so read it here — it decides which side of its fetch each league reads.
  const adpBoards = await getLeagueAdpBoards(withOwn.map((l) => l.league_id));

  // Group the leagues by the fetch that prices them, collecting each fetch's
  // rostered player ids as we go — one query per distinct board rather than one
  // per league. Both league types share a fetch now that it answers both sides.
  const boards = new Map<string, { filters: AdpFilters; playerIds: Set<string> }>();
  const leagueBoard = new Map<string, string>();
  for (const league of withOwn) {
    const filters = adpBoardFor({
      season,
      rosterPositions: league.roster_positions,
      scoringSettings: league.scoring_settings,
      board: chosenBoard,
    });
    const signature = boardSignature(filters);
    leagueBoard.set(league.league_id, signature);

    let grouped = boards.get(signature);
    if (!grouped) {
      grouped = { filters, playerIds: new Set() };
      boards.set(signature, grouped);
    }
    for (const team of league.teams) {
      for (const id of team.players) if (id) grouped.playerIds.add(id);
    }
  }

  const [lineups, boardResults] = await Promise.all([
    // The same lineup the expanded panel lists as Starters, so a column and the
    // card it opens can't disagree about who starts. A projections read that
    // fails costs the split and the rank and not the value — pricing a roster
    // needs no projection, so the totals still answer.
    getOptimalLineups({
      season,
      leagues: withOwn.map((league) => ({
        league_id: league.league_id,
        rosterPositions: league.roster_positions,
        scoringSettings: league.scoring_settings,
        teams: league.teams,
      })),
    }).catch((error) => {
      console.error(
        `[adp-value] lineups failed for ${username}:`,
        errorMessage(error),
      );
      return null;
    }),
    // The raw ADP per board — the curve is applied per league below, since it
    // depends on each league's startable pool, not on the board alone.
    //
    // Bounded rather than `Promise.all`'d, because the width is data: an
    // account spread across superflex and 1QB leagues at three scoring rules is
    // six boards, each holding a connection across a pair of queries, so one
    // request took most of the pool and two of them took all of it — leaving
    // every other route queueing until the platform gave up on it. The boards
    // still overlap, just not without limit.
    collectWithConcurrency(
      [...boards],
      databaseBudget().fanout,
      async ([signature, board]) => {
        const result = await getDraftAdpForPlayers(
          board.filters,
          [...board.playerIds],
        );
        return [signature, result] as const;
      },
    ),
  ]);

  const boardValues = new Map(boardResults);

  const priced: ManagerAdpValuePayload["leagues"] = {};
  for (const league of withOwn) {
    const own = league.teams.find((t) => t.owner_id === userId)!;
    const board = boardValues.get(leagueBoard.get(league.league_id)!)!;
    const pool = leagueAdpPool(league.teams.length, league.roster_positions);
    const lineup = lineups?.lineups.get(league.league_id) ?? null;

    /**
     * This league's rosters read off one side of the fetch. Both sides are
     * priced now rather than only the league's own market: a column mixing a
     * dynasty league's total with a redraft league's is two markets under one
     * heading, so the payload answers both and the column chooses. The other
     * market is a real reading of the same roster — what a win-now market would
     * pay for those players — not a mistake to be guarded against.
     */
    const priceOn = (boardType: AdpBoardType) => {
      // Curve this board's ADP into values for this league's pool. The pool is
      // per league, so two leagues sharing a fetch are priced on their own size.
      const values = new Map<string, number>();
      for (const [id, boardAdp] of board.values) {
        const entry = boardAdp[boardType];
        if (entry) values.set(id, adpValue(entry.adp, pool, halvings));
      }

      // Every team's starter value, so the manager's can be ranked against them;
      // the manager's own full value is kept aside for the payload. The rank is
      // per board for the same reason the total is — a roster can be third by
      // win-now value and eighth by dynasty value, and those are the two facts
      // the split exists to tell apart.
      const starterValue = new Map<number, number>();
      let ownValue = null as ReturnType<typeof rosterAdpValue> | null;
      for (const team of league.teams) {
        const value = rosterAdpValue({
          players: team.players,
          starters: lineup?.get(team.roster_id) ?? null,
          values,
        });
        if (value.split) starterValue.set(team.roster_id, value.split.starters);
        if (team.roster_id === own.roster_id) ownValue = value;
      }

      const { rostered, ...rest } = ownValue!;
      return {
        rostered,
        value: {
          ...rest,
          draft_count:
            boardType === "dynasty" ? board.dynasty_drafts : board.redraft_drafts,
          starters_rank: rankOf(starterValue, own.roster_id),
        },
      };
    };

    const redraft = priceOn("redraft");
    const dynasty = priceOn("dynasty");

    priced[league.league_id] = {
      superflex: isSuperflexLineup(league.roster_positions),
      // Which market the league itself plays in. It gates neither reading now —
      // it says which of the two columns is this league's native answer.
      board: adpBoards.get(league.league_id) ?? "redraft",
      // The same roster on both sides, so either count answers for it.
      rostered: redraft.rostered,
      redraft: redraft.value,
      dynasty: dynasty.value,
    };
  }

  const payload: ManagerAdpValuePayload = {
    season,
    weeks: lineups?.weeks ?? [],
    leagues: priced,
  };
  return NextResponse.json(payload);
}
