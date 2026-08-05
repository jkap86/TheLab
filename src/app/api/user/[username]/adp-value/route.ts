import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  ManagerAdpValuePayload,
} from "@/shared/contract";
import { isSuperflexLineup } from "@/shared/ktc";
import {
  adpBoardFor,
  adpValue,
  boardSignature,
  getDraftAdpForPlayers,
  getLeagueAdpBoards,
  getManagerLeagueRosters,
  leagueAdpPool,
  parseSteepness,
  rankOf,
  rosterAdpValue,
} from "@/shared/manager";
import type { AdpFilters } from "@/shared/manager";
import { getOptimalLineups } from "@/shared/projections";
import { errorMessage } from "@/shared/util";

import { resolveManagerRequest } from "../manager-request";

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
 * fetch answers the redraft and dynasty markets side by side, with each league
 * reading the side matching its own type. Leagues that share a fetch share a
 * single query: the boards are grouped by {@link boardSignature} and fetched
 * once each, not once per league.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { username, userId, season, searchParams } = resolved;

  // The steepness of the value curve, chosen on the ADP drawer's slider and sent
  // as a number of halvings; junk falls back to the default and an out-of-range
  // value clamps rather than being trusted.
  const halvings = parseSteepness(searchParams.get("steepness"));

  try {
    return await adpValuePayload(username, userId, season, halvings);
  } catch (error) {
    console.error("[adp-value] query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load ADP values" };
    return NextResponse.json(payload, { status: 500 });
  }
}

async function adpValuePayload(
  username: string,
  userId: string,
  season: string,
  halvings: number,
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
    });
    const signature = boardSignature(filters);
    leagueBoard.set(league.league_id, signature);

    let board = boards.get(signature);
    if (!board) {
      board = { filters, playerIds: new Set() };
      boards.set(signature, board);
    }
    for (const team of league.teams) {
      for (const id of team.players) if (id) board.playerIds.add(id);
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
    Promise.all(
      [...boards].map(async ([signature, board]) => {
        const result = await getDraftAdpForPlayers(
          board.filters,
          [...board.playerIds],
        );
        return [signature, result] as const;
      }),
    ),
  ]);

  const boardValues = new Map(boardResults);

  const priced: ManagerAdpValuePayload["leagues"] = {};
  for (const league of withOwn) {
    const own = league.teams.find((t) => t.owner_id === userId)!;
    const board = boardValues.get(leagueBoard.get(league.league_id)!)!;
    // Which side of the fetch this league reads: its own market, not the pool
    // of both — a dynasty roster priced off redraft drafts is wrong at every
    // rookie, and the other way round at every veteran.
    const boardType = adpBoards.get(league.league_id) ?? "redraft";

    const pool = leagueAdpPool(league.teams.length, league.roster_positions);

    // Curve this board's ADP into values for this league's pool. The pool is per
    // league, so two leagues sharing a board are still priced on their own size.
    const values = new Map<string, number>();
    for (const [id, boardAdp] of board.values) {
      const entry = boardAdp[boardType];
      if (entry) values.set(id, adpValue(entry.adp, pool, halvings));
    }

    // Every team's starter value, so the manager's can be ranked against them;
    // the manager's own full value is kept aside for the payload.
    const starterValue = new Map<number, number>();
    let ownValue = null as ReturnType<typeof rosterAdpValue> | null;
    for (const team of league.teams) {
      const value = rosterAdpValue({
        players: team.players,
        starters:
          lineups?.lineups.get(league.league_id)?.get(team.roster_id) ?? null,
        values,
      });
      if (value.split) starterValue.set(team.roster_id, value.split.starters);
      if (team.roster_id === own.roster_id) ownValue = value;
    }

    priced[league.league_id] = {
      ...ownValue!,
      superflex: isSuperflexLineup(league.roster_positions),
      board: boardType,
      draft_count:
        boardType === "dynasty" ? board.dynasty_drafts : board.redraft_drafts,
      starters_rank: rankOf(starterValue, own.roster_id),
    };
  }

  const payload: ManagerAdpValuePayload = {
    season,
    weeks: lineups?.weeks ?? [],
    leagues: priced,
  };
  return NextResponse.json(payload);
}
