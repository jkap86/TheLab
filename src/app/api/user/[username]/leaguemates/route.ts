import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeaguematePayload,
  ManagerLeaguematesPayload,
} from "@/shared/contract";
import { getManagerLeaguemates } from "@/shared/manager";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { sleeperAvatarUrl, withInteractiveSleeper } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is in the manager's leagues this season — the leaguemate shares drawer's
 * input, and the sibling of the players route in every respect: membership
 * rather than a count, Postgres only, folded on the client so the counting
 * respects the page's league filters.
 *
 * `members` carries the manager's own id, which the fold drops. It is a
 * sentinel rather than an oversight — see `getManagerLeaguemates`.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
) {
  // Interactive Sleeper traffic — a reader is waiting on this handler, so the
  // reads under it are bounded rather than queueing behind a crawl batch. No
  // `signal`: see `shared/sleeper/request-policy`, which is where both halves
  // of that decision are argued.
  return withInteractiveSleeper(() => readLeaguemates(request, context));
}

async function readLeaguemates(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }

  const requested = parseRequestedSeason(
    new URL(request.url).searchParams.get("season"),
  );
  if (requested && !requested.ok) {
    const error: ApiErrorPayload = { error: requested.error };
    return NextResponse.json(error, { status: 400 });
  }
  const season = requested?.season ?? (await getActiveSeason());

  try {
    const { members, users } = await getManagerLeaguemates(
      resolved.user.user_id,
      season,
    );

    // Resolved here rather than on the client, so a `"use client"` module never
    // imports `shared/sleeper` to render a face.
    const resolvedUsers: Record<string, LeaguematePayload> = {};
    for (const [id, user] of Object.entries(users)) {
      resolvedUsers[id] = {
        user_id: user.user_id,
        display_name: user.display_name,
        avatar_url: sleeperAvatarUrl(user.avatar, "thumb"),
      };
    }

    const payload: ManagerLeaguematesPayload = {
      season,
      members,
      users: resolvedUsers,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[leaguemates] failed for ${username} ${season}:`, error);
    const payload: ApiErrorPayload = { error: "Failed to load leaguemates" };
    return NextResponse.json(payload, { status: 500 });
  }
}
