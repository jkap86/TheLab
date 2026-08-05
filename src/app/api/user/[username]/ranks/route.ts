import { NextResponse } from "next/server";

import type { ManagerRanksPayload } from "@/shared/contract";
import {
  getManagerLeagueRosters,
  projectedRank,
  rankOf,
  standingScore,
} from "@/shared/manager";
import { getWeeklyTeamPoints } from "@/shared/projections";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the manager's roster sits in each of their leagues — by record, by
 * points for, and by projected points — read from cache and nothing else; see
 * {@link ManagerRanksPayload}.
 *
 * One batch request rather than a rank per league card because the leagues page
 * shows a hundred-plus collapsed cards at once, and a collapsed card costs no
 * request of its own; the batch read shares the projection queries across every
 * league where a per-league loop would repeat them. The record and points ranks
 * ride along for free — the rosters read already fetched every team's standings
 * figures — so only the projected rank pays for a projection.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, season } = resolved;

  try {
    return await ranksPayload(userId, season);
  } catch (error) {
    console.error("[ranks] query failed:", error);
    return readFailureResponse(error, "Failed to load ranks");
  }
}

async function ranksPayload(userId: string, season: string) {
  // Sequential rather than parallel: which rosters to project is the answer to
  // the first read.
  const leagues = await getManagerLeagueRosters(userId, season);
  const { weeks, points, bench } = await getWeeklyTeamPoints({
    season,
    leagues: leagues.map((l) => ({
      league_id: l.league_id,
      rosterPositions: l.roster_positions,
      scoringSettings: l.scoring_settings,
      teams: l.teams,
    })),
  });

  const ranks: ManagerRanksPayload["ranks"] = {};
  for (const league of leagues) {
    const own = league.teams.find((t) => t.owner_id === userId);
    if (!own) continue;

    // Standings and points for come straight from the roster settings this read
    // now carries, so they answer even for a league nothing is projected in.
    const standing = rankOf(
      new Map(
        league.teams.map((t) => [
          t.roster_id,
          standingScore(t.record.wins, t.fpts),
        ]),
      ),
      own.roster_id,
    );
    const pointsRank = rankOf(
      new Map(league.teams.map((t) => [t.roster_id, t.fpts])),
      own.roster_id,
    );

    const totals = points.get(league.league_id);
    const proj = totals ? projectedRank(totals, own.roster_id) : null;
    // Ranked by the bench half of the same solve, so depth places a roster the
    // way its starters do — highest bench first, null where nothing is behind a
    // starter (rankOf's all-zero guard).
    const benchTotals = bench.get(league.league_id);
    const projBench = benchTotals
      ? projectedRank(benchTotals, own.roster_id)
      : null;

    if (!standing && !pointsRank && !proj && !projBench) continue;
    ranks[league.league_id] = {
      standing,
      points: pointsRank ? { ...pointsRank, pointsFor: own.fpts } : null,
      proj,
      proj_bench: projBench,
    };
  }

  const payload: ManagerRanksPayload = { season, weeks, ranks };
  return NextResponse.json(payload);
}
