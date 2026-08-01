import { NextResponse } from "next/server";

import type { ApiErrorPayload, ManagerKtcPayload } from "@/shared/contract";
import {
  getKtcValuesBySleeperId,
  isSuperflexLineup,
  ktcBoardValue,
  rosterKtcValue,
} from "@/shared/ktc";
import { getManagerLeagueRosters, rankOf } from "@/shared/manager";
import { getOptimalLineups } from "@/shared/projections";
import { errorMessage } from "@/shared/util";

import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the manager's roster in each of their leagues is worth on KeepTradeCut,
 * and where its starter value ranks among their leaguemates — see
 * {@link ManagerKtcPayload}.
 *
 * One batch request rather than a value per league card, for the reason the
 * sibling `ranks` route is batched: the leagues page shows a hundred-plus
 * collapsed cards at once and a collapsed card costs no request of its own, so
 * the reads behind the chip are shared across every league instead of repeated
 * per card.
 *
 * Every team is priced and solved, not just the manager's. The card now carries
 * a starter-value *rank*, and a rank of one roster can't be known without the
 * others' starter values — so the earlier shortcut of dropping every other team
 * before the projections read is gone. It cost eleven answers nobody asked for
 * back when the card showed only the manager's own number; a rank is worth the
 * extra solve, and the aggregate lineup is the cheapest of the three batch
 * entry points (see {@link getOptimalLineups}).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { username, userId, season } = resolved;

  try {
    return await ktcPayload(username, userId, season);
  } catch (error) {
    console.error("[ktc] query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load KTC values" };
    return NextResponse.json(payload, { status: 500 });
  }
}

async function ktcPayload(username: string, userId: string, season: string) {
  // Sequential rather than parallel: which rosters to price is the answer to
  // the first read.
  const leagues = await getManagerLeagueRosters(userId, season);
  const withOwn = leagues.filter((league) =>
    league.teams.some((t) => t.owner_id === userId),
  );

  if (withOwn.length === 0) {
    const empty: ManagerKtcPayload = {
      season,
      updated_at: null,
      weeks: [],
      leagues: {},
    };
    return NextResponse.json(empty);
  }

  // Every rostered player across every team, since every team is priced now.
  const playerIds = [
    ...new Set(
      withOwn.flatMap((league) => league.teams.flatMap((t) => t.players)),
    ),
  ].filter(Boolean);

  const [lineups, ktc] = await Promise.all([
    // The same lineup the expanded panel lists as Starters, so a chip and the
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
      console.error(`[ktc] lineups failed for ${username}:`, errorMessage(error));
      return null;
    }),
    getKtcValuesBySleeperId(playerIds),
  ]);

  const priced: ManagerKtcPayload["leagues"] = {};
  for (const league of withOwn) {
    const own = league.teams.find((t) => t.owner_id === userId)!;
    // Per league, because the board is: the same quarterback is worth one number
    // in a superflex league and another in a 1QB one.
    const superflex = isSuperflexLineup(league.roster_positions);

    // Every team's starter value, so the manager's can be ranked against them;
    // the manager's own full value is kept aside for the payload.
    const starterValue = new Map<number, number>();
    let ownValue = null as ReturnType<typeof rosterKtcValue> | null;
    for (const team of league.teams) {
      const values = new Map<string, number>();
      for (const id of team.players) {
        const board = ktcBoardValue(superflex, ktc.values[id]);
        if (board !== null) values.set(id, board);
      }
      const value = rosterKtcValue({
        players: team.players,
        starters:
          lineups?.lineups.get(league.league_id)?.get(team.roster_id) ?? null,
        values,
      });
      if (value.split) starterValue.set(team.roster_id, value.split.starters);
      if (team.roster_id === own.roster_id) ownValue = value;
    }

    priced[league.league_id] = {
      superflex,
      ...ownValue!,
      starters_rank: rankOf(starterValue, own.roster_id),
    };
  }

  const payload: ManagerKtcPayload = {
    season,
    updated_at: ktc.updated_at,
    weeks: lineups?.weeks ?? [],
    leagues: priced,
  };
  return NextResponse.json(payload);
}
