import { NextResponse } from "next/server";

import type { ManagerKtcPayload } from "@/shared/contract";
import {
  getKtcValuesBySleeperId,
  isSuperflexLineup,
  rosterKtcValue,
} from "@/shared/ktc";
import { getManagerLeagueRosters } from "@/shared/manager";
import { getOptimalLineups } from "@/shared/projections";
import { errorMessage } from "@/shared/util";

import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the manager's roster in each of their leagues is worth on KeepTradeCut,
 * read from cache and nothing else — see {@link ManagerKtcPayload}.
 *
 * One batch request rather than a value per league card, for the reason the
 * sibling `ranks` route is batched: the leagues page shows a hundred-plus
 * collapsed cards at once and a collapsed card costs no request of its own, so
 * the reads behind the chip are shared across every league instead of repeated
 * per card.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { username, userId, season } = resolved;

  // Sequential rather than parallel: which rosters to price is the answer to
  // the first read.
  const leagues = await getManagerLeagueRosters(userId, season);

  // Only the manager's own roster is priced here, so every other team is dropped
  // *before* the projections read rather than after it. A hundred leagues of
  // twelve rosters is twelve times the lineup solving for eleven answers nobody
  // asked for, and it narrows the stat-line read to the players actually held.
  const own = leagues.flatMap((league) => {
    const team = league.teams.find((t) => t.owner_id === userId);
    return team ? [{ league, team }] : [];
  });

  if (own.length === 0) {
    const empty: ManagerKtcPayload = {
      season,
      updated_at: null,
      weeks: [],
      leagues: {},
    };
    return NextResponse.json(empty);
  }

  const playerIds = [...new Set(own.flatMap(({ team }) => team.players))].filter(
    Boolean,
  );

  const [lineups, ktc] = await Promise.all([
    // The same lineup the expanded panel lists as Starters, so the chip and the
    // card it opens can't disagree about who starts. A projections read that
    // fails costs the split and not the value — pricing a roster needs no
    // projection, so the totals still answer.
    getOptimalLineups({
      season,
      leagues: own.map(({ league, team }) => ({
        league_id: league.league_id,
        rosterPositions: league.roster_positions,
        scoringSettings: league.scoring_settings,
        teams: [team],
      })),
    }).catch((error) => {
      console.error(`[ktc] lineups failed for ${username}:`, errorMessage(error));
      return null;
    }),
    getKtcValuesBySleeperId(playerIds),
  ]);

  const priced: ManagerKtcPayload["leagues"] = {};
  for (const { league, team } of own) {
    // Per league, because the board is: the same quarterback is worth one number
    // in a superflex league and another in a 1QB one.
    const superflex = isSuperflexLineup(league.roster_positions);
    const values = new Map<string, number>();
    for (const id of team.players) {
      const board = superflex ? ktc.values[id]?.sf : ktc.values[id]?.oneqb;
      if (typeof board === "number") values.set(id, board);
    }

    priced[league.league_id] = {
      superflex,
      ...rosterKtcValue({
        players: team.players,
        starters:
          lineups?.lineups.get(league.league_id)?.get(team.roster_id) ?? null,
        values,
      }),
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
