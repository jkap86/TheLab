import { NextResponse } from "next/server";

import type { ApiErrorPayload, ManagerLineupsPayload } from "@/shared/contract";
import { isSuperflexLineup } from "@/shared/ktc";
import {
  LAST_REGULAR_WEEK,
  getManagerDraftAdp,
  getManagerLeagueRosters,
  managerRosterPicks,
  rankLeagueLineups,
} from "@/shared/manager";
import { getRosProjections } from "@/shared/projections";
import type { RosProjections } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every league's rosters solved into rest-of-season lineups and the manager's
 * rank among them — one request for the whole page, like the leagues stream it
 * rides beside, because the projections span is shared across every league and
 * per-card requests would refetch nothing but re-enter everything. Every
 * stored roster is solved (a rank needs the other eleven), but only the
 * manager's lineup ships — see `manager/league-ranks`.
 *
 * The solve is projections first, draft capital second — see
 * `manager/ros-lineups` for the arithmetic. What this route decides is only
 * **which weeks are the rest of the season**, and it is deliberately
 * conservative about claiming any:
 *
 * - the page's season and Sleeper's current season agree → from the current
 *   week (floored at 1: preseason is week 0, and the season ahead is whole);
 * - the page is on an *older* season → there is no rest-of-season, and no
 *   projections are read at all;
 * - the state call failed or named some other future — week 1, the widest
 *   honest window.
 *
 * A failed projections span degrades the same way rather than failing the
 * route: `from_week: null` plus per-player null points is the fallback working,
 * and the reader can see which lens priced the page.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }
  const userId = resolved.user.user_id;

  // Three states, not two, exactly as the leagues route reads it: `null` is
  // "not asked" and is the only one filled from the resolver.
  const requested = parseRequestedSeason(
    new URL(request.url).searchParams.get("season"),
  );
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const [leagues, adp] = await Promise.all([
      getManagerLeagueRosters(userId, season),
      getManagerDraftAdp(userId, season),
    ]);

    if (leagues.length === 0) {
      const empty: ManagerLineupsPayload = {
        season,
        from_week: null,
        leagues: {},
      };
      return NextResponse.json(empty);
    }

    const fromWeek = await restOfSeasonStart(season);
    let projections: RosProjections = {};
    let coveredFrom: number | null = null;
    if (fromWeek !== null) {
      try {
        projections = await getRosProjections(season, fromWeek);
        coveredFrom = fromWeek;
      } catch (error) {
        // The fallback's case, not the route's failure: every player prices on
        // draft capital and `from_week: null` says which lens answered.
        console.warn(`[lineups] projections unavailable for ${season}:`, error);
      }
    }

    const solved: ManagerLineupsPayload["leagues"] = {};
    for (const league of leagues) {
      const board = isSuperflexLineup(league.roster_positions)
        ? adp.superflex
        : adp.standard;
      const { lineup, ranks } = rankLeagueLineups(
        league,
        userId,
        projections,
        board,
      );
      // A null lineup means the store moved between the query and here — the
      // league drops out of the payload, as it always has for roster-less ones.
      if (lineup) {
        solved[league.league_id] = {
          lineup,
          ranks,
          picks: managerRosterPicks(league, season, userId),
        };
      }
    }

    const payload: ManagerLineupsPayload = {
      season,
      from_week: coveredFrom,
      leagues: solved,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[lineups] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load lineups" };
    return NextResponse.json(payload, { status: 500 });
  }
}

/**
 * The first week "rest of season" means for this page, or null when the season
 * has none left to project — see the route note for the three cases.
 */
async function restOfSeasonStart(season: string): Promise<number | null> {
  // A failed state call must not fail the page — week 1 is the widest honest
  // window, and the projections span has its own fallback behind it.
  const state = await getNflState().catch(() => null);
  if (!state) return 1;

  if (state.season === season) {
    return Math.min(Math.max(state.week, 1), LAST_REGULAR_WEEK);
  }
  const requested = Number(season);
  const current = Number(state.season);
  if (Number.isFinite(requested) && Number.isFinite(current) && requested < current) {
    return null;
  }
  return 1;
}
