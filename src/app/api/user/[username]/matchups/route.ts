import { NextResponse } from "next/server";

import type {
  LeagueMatchupPayload,
  ManagerMatchupsPayload,
} from "@/shared/contract";
import { getManagerLeagueRosters, getManagerMatchups } from "@/shared/manager";
import type { LeagueRosterSet, ManagerMatchup } from "@/shared/manager";
import { getUpcomingWeek, getWeekLineups } from "@/shared/projections";
import type { LeagueTeamsInput, WeekLineups } from "@/shared/projections";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the manager plays this week in each of their leagues and what both sides
 * project, read from cache and nothing else — see {@link ManagerMatchupsPayload}.
 *
 * One batch request rather than one per league, for the reason the sibling
 * `ranks` and `ktc` routes are batched: the lineup checker draws a hundred-odd
 * rows at once, and a row that cost a request would spend the account's whole
 * page load resolving one number each.
 *
 * The week is resolved **first and alone**, and not by oversight: which week to
 * look up is the answer to that read. A season with nothing stored ahead of
 * today has no week to ask about, so everything below is skipped entirely rather
 * than run against a week invented from a clock.
 *
 * The two reads under it *are* parallel — the pairings and the rosters answer
 * different questions of the same week — and the projections are a third step,
 * because which rosters to solve is what the first two say.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, username, season } = resolved;

  try {
    const week = await getUpcomingWeek(season);
    if (week === null) {
      const empty: ManagerMatchupsPayload = { season, week: null, matchups: {} };
      return NextResponse.json(empty);
    }

    const [rows, leagues] = await Promise.all([
      getManagerMatchups(userId, season, week),
      getManagerLeagueRosters(userId, season),
    ]);

    const lineups = await weekLineups({ season, week, username, rows, leagues });

    const matchups: Record<string, LeagueMatchupPayload> = {};
    for (const row of rows) {
      const byRoster = lineups.teams.get(row.league_id);
      const own = byRoster?.get(row.roster_id) ?? null;
      const opponent = row.opponent
        ? (byRoster?.get(row.opponent.roster_id) ?? null)
        : null;

      matchups[row.league_id] = {
        roster_id: row.roster_id,
        opponent: row.opponent
          ? {
              roster_id: row.opponent.roster_id,
              user_id: row.opponent.owner_id,
              display_name: row.opponent.display_name,
              team_name: row.opponent.team_name,
              avatar_url: sleeperAvatarUrl(row.opponent.avatar, "thumb"),
            }
          : null,
        projection: own
          ? {
              optimal: own.optimal_points,
              current: own.current_points,
              points_left: own.points_left,
            }
          : null,
        // The opponent's *current* lineup — see the payload's own note on why it
        // is never their best one.
        opponent_projection: opponent ? opponent.current_points : null,
      };
    }

    const payload: ManagerMatchupsPayload = { season, week, matchups };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[matchups] query failed:", error);
    return readFailureResponse(error, "Failed to load matchups");
  }
}

/**
 * The week's lineups for the two rosters in each matchup.
 *
 * **Two rosters per league, not twelve.** `getWeekLineups` solves everything it
 * is handed, and the only teams this payload can say anything about are the ones
 * in a game — so a hundred-league account solves ~200 lineups rather than
 * ~1,200. The pairing is what decides that, which is why this runs after the
 * matchups read rather than beside it.
 *
 * **A failure here costs the projections and not the page.** The pairings are
 * what the lineup checker's list is built on and they are already in hand; the
 * numbers are a column on top of them. That is the same call
 * `/api/league/[leagueId]` makes for its outlook and the `ranks` route makes for
 * its projected ranks — decided per read rather than per route, and this read is
 * not what the route is for. The fallback is the empty shape `getWeekLineups`
 * itself returns when there is nothing to project, so the degraded answer is one
 * the payload already describes.
 */
async function weekLineups({
  season,
  week,
  username,
  rows,
  leagues,
}: {
  season: string;
  week: number;
  username: string;
  rows: readonly ManagerMatchup[];
  leagues: readonly LeagueRosterSet[];
}): Promise<WeekLineups> {
  const playing = new Map<string, Set<number>>();
  for (const row of rows) {
    const rosters = playing.get(row.league_id) ?? new Set<number>();
    rosters.add(row.roster_id);
    if (row.opponent) rosters.add(row.opponent.roster_id);
    playing.set(row.league_id, rosters);
  }

  const input: LeagueTeamsInput[] = leagues.flatMap((league) => {
    const rosters = playing.get(league.league_id);
    if (!rosters) return [];
    const teams = league.teams.filter((team) => rosters.has(team.roster_id));
    return teams.length === 0
      ? []
      : [
          {
            league_id: league.league_id,
            rosterPositions: league.roster_positions,
            scoringSettings: league.scoring_settings,
            teams,
          },
        ];
  });

  return getWeekLineups({ season, week, leagues: input }).catch(
    (error): WeekLineups => {
      console.error(
        `[matchups] week lineups failed for ${username}:`,
        errorMessage(error),
      );
      return { week, teams: new Map() };
    },
  );
}
