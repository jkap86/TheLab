import { NextResponse } from "next/server";

import type { ApiErrorPayload, PicktrackerPayload } from "@/shared/contract";
import { trackPlaceholderDraft } from "@/shared/picktracker";
import { sleeperAvatarUrl } from "@/shared/sleeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A league's placeholder draft: its kicker picks renumbered as the rookie
 * picks they stand for, plus the one on the clock.
 *
 *   {"league":{…},"draft_status":"drafting","teams":12,"picks":[…],"next_pick":"2.05"}
 *
 * This route asks Sleeper directly rather than reading a synced cache — with
 * `/api/user/[username]`, one of the two deliberate exceptions to the
 * cache-backed rule. Following a draft while it happens is what the tool is
 * for, and it takes any league id, not just ones a sync has seen.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  const result = await trackPlaceholderDraft(leagueId);
  if (!result.ok) {
    const error: ApiErrorPayload = { error: result.error };
    return NextResponse.json(error, { status: result.status });
  }

  const payload: PicktrackerPayload = {
    league: {
      league_id: result.league.league_id,
      name: result.league.name,
      avatar_url: sleeperAvatarUrl(result.league.avatar),
    },
    draft_status: result.draft_status,
    teams: result.teams,
    picks: result.picks.map(({ picked_by, ...pick }) => ({
      ...pick,
      picked_by: picked_by
        ? {
            user_id: picked_by.user_id,
            display_name: picked_by.display_name,
            avatar_url: sleeperAvatarUrl(picked_by.avatar, "thumb"),
          }
        : null,
    })),
    next_pick: result.next_pick,
  };

  return NextResponse.json(payload);
}
