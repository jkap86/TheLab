import { NextResponse } from "next/server";

import type {
  LeaguematePayload,
  ManagerLeaguematesPayload,
} from "@/shared/contract";
import { getManagerLeaguemates } from "@/shared/manager";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every member of every league the manager is in, read from cache and nothing
 * else — see {@link ManagerLeaguematesPayload}.
 *
 * The sibling `leagues` route is what fills `league_users` in, so this one is
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

  const { members, users } = await getManagerLeaguemates(userId, season);

  const resolvedUsers: Record<string, LeaguematePayload> = {};
  for (const [id, u] of Object.entries(users)) {
    resolvedUsers[id] = {
      user_id: u.user_id,
      display_name: u.display_name,
      avatar_url: sleeperAvatarUrl(u.avatar, "thumb"),
    };
  }

  const payload: ManagerLeaguematesPayload = {
    season,
    members,
    users: resolvedUsers,
  };
  return NextResponse.json(payload);
}
