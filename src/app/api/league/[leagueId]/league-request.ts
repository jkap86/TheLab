import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { markLeaguesAccessed, readLeagueDetail } from "@/shared/manager";
import type { LeagueDetail } from "@/shared/manager";
import type { LeagueScopeBody } from "@/shared/query";
import { errorMessage } from "@/shared/util";

import { readLeagueScope } from "../../league-scope";
import { readFailureResponse } from "../../read-failure";

/**
 * The ten lines the four League Details routes open with.
 *
 * **They are four routes over one read**, which is the whole shape of the split:
 * the core panel, its two value columns, its rest-of-season outlook and its week
 * each need the same league, the same rosters and the same slots and scoring
 * before they can do their own work. So every one of them resolves the league
 * the same way, 404s the same way, stamps demand the same way, and turns a
 * database failure into the same response — and that is `resolveLeagueRequest`,
 * for the reason `resolveManagerRequest` is those ten lines one prefix over.
 *
 * It sits in `src/app` rather than beside `readLeagueDetail` because the only
 * thing it adds is the `NextResponse`: every decision it makes already belongs
 * to a module it calls. A non-route file in the app directory is fine — only
 * `route.ts`/`page.tsx` are special.
 *
 * **The read behind it is cached and coalesced** ({@link readLeagueDetail}), and
 * that is what makes four requests cost one league read rather than four. It is
 * also what makes the split cheap enough to be worth having: the enrichment
 * routes pay for their own computation and nothing for the structure under it.
 */
export type ResolvedLeagueRequest =
  | {
      ok: true;
      leagueId: string;
      detail: LeagueDetail;
      /** The query string, for a route that reads a board or a week off it. */
      searchParams: URLSearchParams;
      /** League ids off a POST body, for the routes that answer one. */
      scope: LeagueScopeBody;
    }
  | { ok: false; response: NextResponse };

export async function resolveLeagueRequest(
  request: Request,
  params: Promise<{ leagueId: string }>,
  options: {
    /**
     * Whether opening this route counts as *demand* for the league — see
     * `shared/manager/crawl-priority`, where demand is observed and never
     * inferred.
     *
     * Only the core read stamps it, and that is the point rather than a
     * micro-optimisation: a panel now fires up to four requests where it used to
     * fire one, and stamping on each would write the same row three extra times
     * per open for a signal that means "somebody looked at this league" either
     * way.
     */
    stampDemand?: boolean;
  } = {},
): Promise<ResolvedLeagueRequest> {
  const { leagueId } = await params;
  const searchParams = new URL(request.url).searchParams;

  try {
    const scope = await readLeagueScope(request);
    const detail = await readLeagueDetail(leagueId);
    if (!detail) {
      const error: ApiErrorPayload = { error: "League not found" };
      return { ok: false, response: NextResponse.json(error, { status: 404 }) };
    }

    if (options.stampDemand) {
      // Fired off rather than awaited: it moves the league up the crawler's
      // refresh queue and does nothing this response reads.
      void markLeaguesAccessed([leagueId]).catch((error) => {
        console.warn(
          `[league] demand stamp failed for ${leagueId}:`,
          errorMessage(error),
        );
      });
    }

    return { ok: true, leagueId, detail, searchParams, scope };
  } catch (error) {
    console.error(`[league] query failed for ${leagueId}:`, error);
    return {
      ok: false,
      response: readFailureResponse(error, "Failed to load league"),
    };
  }
}
