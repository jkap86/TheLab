import type { LeagueOutlookPayload } from "@/shared/contract";
import { getLeagueOutlook } from "@/shared/projections";

import { resolveLeagueRequest } from "../league-request";
import { readResponse } from "../../../read-response";

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
 * **A failure costs the two columns rather than the league** — the judgement this
 * read has always had, "the rosters are the point of that route and the lineups
 * are a bonus on top", read from the other side of the split. It is the
 * *client's* composition that holds it up, where the outlook is a query of its
 * own and only the core's error is the panel's error, so the route is free to
 * report what actually happened.
 *
 * **Null is this route's one real answer and stays a 200.** A league with no
 * slots on file, no scoring settings to score with, or nothing left on the
 * schedule cannot be projected, and `getLeagueOutlook` says so by returning
 * null — that is a fact about the league, and the columns draw an em dash on it.
 * A read that *threw* was answering with the same null until now, which meant a
 * one-second database timeout was cached as "this league cannot be projected"
 * for the entry's whole stale time, with nothing on the wire able to tell the
 * two apart and no retry, since the browser had been told the request worked.
 * The throw is a failure status now ({@link readResponse}); the null is
 * untouched.
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

  return readResponse({
    label: "league.outlook",
    subject: `league=${leagueId}`,
    failure: "Failed to project this league",
    // Annotated on the read rather than on the call, so the contract type sits
    // on the value that actually crosses — including its null, which is the
    // league's answer and not this route's failure.
    read: (): Promise<LeagueOutlookPayload> =>
      getLeagueOutlook({
        season: detail.season,
        rosterPositions: detail.roster_positions,
        scoringSettings: detail.scoring_settings,
        teams: detail.teams,
      }),
  });
}
