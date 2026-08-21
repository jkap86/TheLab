import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeagueMatchupPayload,
  ManagerMatchupsPayload,
} from "@/shared/contract";
import { getManagerLeagueRosters, getManagerMatchups } from "@/shared/manager";
import type { LeagueRosterSet, ManagerMatchup } from "@/shared/manager";
import {
  getUpcomingWeek,
  getWeekLineups,
  kickoffMoves,
  LAST_REGULAR_WEEK,
  medianScore,
} from "@/shared/projections";
import type { LeagueTeamsInput, WeekLineups } from "@/shared/projections";
import { integer } from "@/shared/query";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { readOptional } from "@/shared/util";
import type { OptionalRead } from "@/shared/util";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerIdRequest } from "../manager-request";

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
 * `?week=` overrides that resolve, which is what the lineup checker's own week
 * control sends. It is a *default* being replaced rather than a filter being
 * added — the same relationship `?season=` has to `getActiveSeason` — so a named
 * week is answered for whether or not it is the one the schedule would have
 * picked, and the week always travels back on the payload so the caller reads
 * one answer rather than assuming its own.
 *
 * The two reads under it *are* parallel — the pairings and the rosters answer
 * different questions of the same week — and the projections are a third step,
 * because which rosters to solve is what the first two say.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerIdRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, username, season, searchParams } = resolved;

  // An explicitly asked-for week is the caller's answer and skips the resolve
  // entirely, the rule `?season=` keeps one layer up: the derived week is a
  // *default*, and a reader who has stepped the control has already decided.
  // It also means a season with nothing stored ahead of today still answers for
  // a week the reader named, rather than reporting no week at all.
  const requested = integer(searchParams, "week", {
    min: 1,
    max: LAST_REGULAR_WEEK,
    fallback: null,
  });
  if (!requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }

  try {
    const week = requested.value ?? (await getUpcomingWeek(season));
    if (week === null) {
      // `"ok"`: a season with nothing stored ahead of today has no week to solve,
      // so there was no read to fail. That is a real answer about the season and
      // not a shortfall — the page says as much rather than offering a retry.
      const empty: ManagerMatchupsPayload = {
        season,
        week: null,
        projections: "ok",
        matchups: {},
      };
      return NextResponse.json(empty);
    }

    const [rows, leagues] = await Promise.all([
      getManagerMatchups(userId, season, week),
      getManagerLeagueRosters(userId, season),
    ]);

    const solved = await weekLineups({ season, week, username, rows, leagues });
    // The empty shape `getWeekLineups` itself returns with nothing to project,
    // which is what a failed solve degrades to — and, until this read started
    // reporting its own status, what a failed solve was *indistinguishable*
    // from.
    const lineups: WeekLineups = solved.value ?? { week, teams: new Map() };
    const medians = leagueMedians(leagues, lineups);

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
              // The count and the panel's per-player marks read one ordering
              // through one function, so the two cannot disagree; null passes
              // through as "no answer", which is not a zero.
              kickoff_moves: own.kickoff_order
                ? kickoffMoves(own.lineup, own.kickoff_order).length
                : null,
            }
          : null,
        // The opponent's *current* lineup — see the payload's own note on why it
        // is never their best one.
        opponent_projection: opponent ? opponent.current_points : null,
        // Absent for every league without the setting, which is the same `null`
        // a median league whose week can't be projected answers with: neither
        // gives a reader a bar to clear.
        median_projection: medians.get(row.league_id) ?? null,
      };
    }

    const payload: ManagerMatchupsPayload = {
      season,
      week,
      projections: solved.status,
      matchups,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[matchups] query failed:", error);
    return readFailureResponse(error, "Failed to load matchups");
  }
}

/**
 * The middle of every team's week, for the leagues that play against it.
 *
 * **Only a median league is in the map at all**, so a lookup miss is the honest
 * `null` for every other league rather than a number nothing on that card would
 * be entitled to print. The population is the league's *whole* team list and not
 * the rosters in this manager's game, which is the reason
 * {@link weekLineups} hands those leagues over whole — a middle taken over two
 * of twelve scores is the mean of two arbitrary teams wearing a median's name.
 *
 * A league the solve could not answer for drops out here rather than being
 * folded over what came back: `getWeekLineups` answers all of a projectable
 * league's teams or none of them, so a partial map is not a case to average
 * across — and {@link medianScore} refuses fewer than two either way.
 */
function leagueMedians(
  leagues: readonly LeagueRosterSet[],
  lineups: WeekLineups,
): Map<string, number> {
  const medians = new Map<string, number>();
  for (const league of leagues) {
    if (!league.median_match) continue;
    const byRoster = lineups.teams.get(league.league_id);
    if (!byRoster) continue;

    // Their current lineups, the same half of the comparison the opponent's
    // number is read from — see the payload's note on why it is never their
    // best one.
    const median = medianScore(
      [...byRoster.values()].map((team) => team.current_points),
    );
    if (median !== null) medians.set(league.league_id, median);
  }
  return medians;
}

/**
 * The week's lineups for the rosters this payload can say something about.
 *
 * **Two rosters per league, not twelve — except where the league plays a
 * median.** `getWeekLineups` solves everything it is handed, and for an ordinary
 * league the only teams this payload speaks for are the ones in a game, so a
 * hundred-league account solves ~200 lineups rather than ~1,200. The pairing is
 * what decides that, which is why this runs after the matchups read rather than
 * beside it.
 *
 * A median league is the one case where that narrowing cannot hold: the bar to
 * clear is the middle of *every* team's week, so there is no smaller set of
 * rosters that answers it and the league goes over whole. The cost is paid per
 * league that carries the setting rather than across the account — most leagues
 * don't, and the ones that do were never going to be answerable any other way.
 *
 * A league with the setting but nobody in a game this week is still skipped, for
 * the reason every league is: a median nothing on the payload compares against
 * is a solve nobody reads.
 *
 * **A failure here costs the projections and not the page.** The pairings are
 * what the lineup checker's list is built on and they are already in hand; the
 * numbers are a column on top of them. That is the same call
 * `/api/league/[leagueId]` makes for its outlook and the `ranks` route makes for
 * its projected ranks — decided per read rather than per route, and this read is
 * not what the route is for.
 *
 * **And the failure is reported.** The degraded answer is the empty shape
 * `getWeekLineups` itself returns with nothing to project, which is exactly the
 * problem: fabricated, it was a hundred leagues each saying "this week cannot be
 * projected" — a claim the client cached as a fresh success for five minutes and
 * no layer could tell from the truth. `readOptional` keeps the degradation and
 * hands back which of the two it is, so the route can put it on
 * {@link ManagerMatchupsPayload.projections}.
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
}): Promise<OptionalRead<WeekLineups>> {
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
    // The whole league where a median has to be taken over it, the two in the
    // game everywhere else — see this function's own note.
    const teams = league.median_match
      ? league.teams
      : league.teams.filter((team) => rosters.has(team.roster_id));
    return teams.length === 0
      ? []
      : [
          {
            league_id: league.league_id,
            rosterPositions: league.roster_positions,
            scoringSettings: league.scoring_settings,
            // Without it a best-ball league reports a gap against a lineup
            // nobody sets — see `compareLineup`. It travels here as well as on
            // the panel's own read because the row and the panel it opens print
            // the same number, and two answers to one question is the drift the
            // solver owning this rule exists to stop.
            bestBall: league.best_ball,
            teams,
          },
        ];
  });

  return readOptional(`[matchups] week lineups for ${username}`, () =>
    getWeekLineups({ season, week, leagues: input }),
  );
}
