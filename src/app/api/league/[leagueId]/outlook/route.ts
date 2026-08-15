import { NextResponse } from "next/server";

import type { LeagueOutlookPayload } from "@/shared/contract";
import { getLeagueOutlook } from "@/shared/projections";

import { resolveLeagueRequest } from "../league-request";
import { withReadTiming } from "../../../read-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every roster's best rest-of-season lineup for one league — see
 * {@link LeagueOutlookPayload}.
 *
 * **Its own route because it is the panel's most expensive number and its least
 * urgent one.** It is a lineup solve per team per remaining week (a dozen teams
 * over eighteen weeks in the offseason), and what it fills in are two columns
 * of a table whose rows, records and points-for are already on screen. Carried
 * on the core payload it was ~180ms of a ~300–490ms first paint that nothing
 * else in it needed.
 *
 * **A failure is a null body and a 200**, which is the same judgement this read
 * has always had — "the rosters are the point of that route and the lineups are
 * a bonus on top" — read from the other side of the split. The columns draw an
 * em dash; nothing else on the panel notices.
 *
 * It takes no board and no week, so its cache key is the league alone: a reader
 * re-tuning the ADP drawer or stepping through weeks never re-runs these solves.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  const resolved = await resolveLeagueRequest(request, context.params);
  if (!resolved.ok) return resolved.response;
  const { leagueId, detail } = resolved;

  const outlook: LeagueOutlookPayload = await withReadTiming(
    "league.outlook",
    `league=${leagueId}`,
    () =>
      getLeagueOutlook({
        season: detail.season,
        rosterPositions: detail.roster_positions,
        scoringSettings: detail.scoring_settings,
        teams: detail.teams,
      }).catch((error) => {
        console.error(`[league] outlook failed for ${leagueId}:`, error);
        return null;
      }),
  );

  return NextResponse.json(outlook);
}
