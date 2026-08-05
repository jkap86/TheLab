import { NextResponse } from "next/server";

import type { ManagerPlayersPayload } from "@/shared/contract";
import { getManagerRosters } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";

import { readFailureResponse } from "../../../read-failure";
import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The manager's roster in each of their leagues, read from cache and nothing
 * else — see {@link ManagerPlayersPayload}.
 *
 * The sibling `leagues` route is what fills those rosters in, so this one is
 * only worth calling after it has streamed a result; a manager it has never run
 * for gets `{}` back rather than a sync of their own. Resolving the username is
 * the one thing it does reach Sleeper for, which is what every route under
 * `/api/user/[username]` is for.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, season } = resolved;

  try {
    // Sequential rather than parallel: which players to resolve is the answer
    // to the first read.
    const rosters = await getManagerRosters(userId, season);
    const players = await getPlayersByIds([
      ...new Set(Object.values(rosters).flat()),
    ]);

    const payload: ManagerPlayersPayload = { season, rosters, players };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[players] query failed:", error);
    return readFailureResponse(error, "Failed to load rosters");
  }
}
