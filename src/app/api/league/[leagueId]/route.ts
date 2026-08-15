import { NextResponse } from "next/server";

import type { LeagueCorePayload } from "@/shared/contract";
import { getPlayersByIds } from "@/shared/players";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import { resolveLeagueRequest } from "./league-request";
import { readFailureResponse } from "../../read-failure";
import { withReadTiming } from "../../read-timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The **core** of one league's detail panel: its settings, every roster and the
 * standings they imply, the managers behind them, each team's owned draft picks,
 * and the names its player ids resolve to.
 *
 *   {"league_id":"...","teams":[...],"players":{id:{…}}}
 *
 * 404s when the league isn't cached (the manager's leagues must be synced
 * first).
 *
 * **It used to carry three enrichments and now carries none, which is the whole
 * change.** KTC and ADP prices, the rest-of-season outlook and — where a week
 * was asked for — that week's projections and points per game all hung off one
 * `Promise.all` here, so the first paint of a panel whose subject is *rosters
 * and standings* waited on the slowest of four reads. Measured against a seeded
 * corpus: ~53ms of core against ~305–490ms for the join, and ~535–600ms once a
 * week was asked for. Each of the three is its own route now — `./values`,
 * `./outlook`, `./week` — and fills into the rendered panel as it lands.
 *
 * Three things follow from the split and are worth stating here, because each
 * looks like an omission from this file alone:
 *
 * - **The league read underneath is cached and coalesced**
 *   (`readLeagueDetail`), so the four requests one open now fires cost one
 *   league read between them rather than four. A split that multiplied the
 *   structural read would have traded blocking for load.
 * - **This route no longer parses an ADP board.** Nothing on this payload
 *   depends on one, which is exactly why the board can move without re-fetching
 *   a roster — the client keys the two apart for the same reason.
 * - **It stamps demand and its siblings don't.** Opening a panel is one act of
 *   interest however many requests it takes; see `resolveLeagueRequest`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  return leagueCore(request, context);
}

/**
 * The same read, tolerated as a POST.
 *
 * Nothing here reads a body — the league scope belongs to the board, and the
 * board belongs to `./values` — but the client's scoped fetcher is one function
 * that chooses its method off the size of what it has to send, and refusing the
 * method here would make the core read the one request in the app that had to
 * know about that choice.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  return leagueCore(request, context);
}

async function leagueCore(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const resolved = await resolveLeagueRequest(request, params, {
    stampDemand: true,
  });
  if (!resolved.ok) return resolved.response;
  const { detail } = resolved;

  const playerIds = [...new Set(detail.teams.flatMap((t) => t.players))];

  try {
    const players = await withReadTiming(
      "league.core",
      `league=${detail.league_id}`,
      () => getPlayersByIds(playerIds),
    );

    const payload: LeagueCorePayload = {
      league_id: detail.league_id,
      name: detail.name,
      season: detail.season,
      status: detail.status,
      roster_positions: detail.roster_positions,
      scoring_settings: detail.scoring_settings,
      settings: detail.settings,
      best_ball: detail.best_ball,
      league_type: detail.league_type,
      teams: detail.teams.map(({ manager, ...team }) => ({
        ...team,
        manager: manager
          ? {
              user_id: manager.user_id,
              display_name: manager.display_name,
              team_name: manager.team_name,
              avatar_url: sleeperAvatarUrl(manager.avatar, "thumb"),
            }
          : null,
      })),
      players,
    };

    return NextResponse.json(payload);
  } catch (error) {
    // Not caught per read, unlike the enrichments: the names *are* the rosters
    // as far as a reader is concerned, so a panel of bare Sleeper ids is not a
    // degraded answer, it is an unreadable one.
    console.error(`[league] core failed for ${detail.league_id}:`, error);
    return readFailureResponse(error, "Failed to load league");
  }
}
