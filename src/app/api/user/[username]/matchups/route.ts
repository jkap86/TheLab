import { NextResponse } from "next/server";

import type {
  LeagueMatchupPayload,
  ManagerMatchupsPayload,
} from "@/shared/contract";
import { getManagerMatchups } from "@/shared/manager";
import { getUpcomingWeek } from "@/shared/projections";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the manager plays this week in each of their leagues, read from cache and
 * nothing else — see {@link ManagerMatchupsPayload}.
 *
 * One batch request rather than one per league, for the reason the sibling
 * `ranks` and `ktc` routes are batched: the lineup checker draws a hundred-odd
 * rows at once, and a row that cost a request would spend the account's whole
 * page load resolving one number each.
 *
 * The two reads are **sequential rather than parallel**, and not by oversight:
 * which week to look up is the answer to the first one. A season with nothing
 * stored ahead of today has no week to ask about, so the matchups read is skipped
 * entirely rather than run against a week invented from a clock.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, season } = resolved;

  try {
    const week = await getUpcomingWeek(season);
    if (week === null) {
      const empty: ManagerMatchupsPayload = { season, week: null, matchups: {} };
      return NextResponse.json(empty);
    }

    const rows = await getManagerMatchups(userId, season, week);

    const matchups: Record<string, LeagueMatchupPayload> = {};
    for (const row of rows) {
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
      };
    }

    const payload: ManagerMatchupsPayload = { season, week, matchups };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[matchups] query failed:", error);
    return readFailureResponse(error, "Failed to load matchups");
  }
}
