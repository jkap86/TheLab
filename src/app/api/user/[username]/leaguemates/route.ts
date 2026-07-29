import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeaguematePayload,
  ManagerLeaguematesPayload,
} from "@/shared/contract";
import { getManagerLeaguemates, resolveManagerUser } from "@/shared/manager";
import { DEFAULT_SEASON, sleeperAvatarUrl } from "@/shared/sleeper";

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
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }

  const searchParams = new URL(request.url).searchParams;
  const season = searchParams.get("season")?.trim() || DEFAULT_SEASON;

  const { members, users } = await getManagerLeaguemates(
    resolved.user.user_id,
    season,
  );

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
