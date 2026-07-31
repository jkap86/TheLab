import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeaguematePayload,
  ManagerTradesPayload,
} from "@/shared/contract";
import { getPlayersByIds } from "@/shared/players";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import { getManagerTrades, getTradeManagers } from "@/shared/trades";

import { resolveManagerRequest } from "../manager-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every completed trade in the manager's leagues for a season — see
 * {@link ManagerTradesPayload}.
 *
 * Read-only over what the sibling `leagues` route synced, like `players`,
 * `leaguemates` and `ranks`: transactions are mirrored by that stream, so a
 * manager it has never run for gets an empty list rather than a sync of their
 * own. Resolving the username is the one thing it reaches Sleeper for.
 *
 * Every filter the trades page offers is applied on the client, against the
 * league list it already holds — which is why this route takes no query string
 * beyond the season. The narrowing is a filter *set* whose options are read off
 * the trades themselves (which players moved, which managers dealt), so the
 * client needs the unnarrowed list in hand either way; filtering here would cost
 * a round trip per chip and hand back an option list that had shrunk to the
 * selection.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const resolved = await resolveManagerRequest(request, params);
  if (!resolved.ok) return resolved.response;
  const { userId, season } = resolved;

  try {
    const trades = await getManagerTrades(userId, season);

    // Which players and managers to resolve is the answer to the first read, so
    // these follow it — but they are independent of each other.
    const playerIds = new Set<string>();
    const managerIds = new Set<string>();
    for (const trade of trades) {
      for (const side of trade.sides) {
        side.players.forEach((id) => playerIds.add(id));
        if (side.user_id) managerIds.add(side.user_id);
      }
    }

    const [players, managers] = await Promise.all([
      getPlayersByIds([...playerIds]),
      getTradeManagers([...managerIds]),
    ]);

    const resolvedManagers: Record<string, LeaguematePayload> = {};
    for (const [id, m] of managers) {
      resolvedManagers[id] = {
        user_id: id,
        display_name: m.display_name,
        avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
      };
    }

    const payload: ManagerTradesPayload = {
      season,
      trades,
      players,
      managers: resolvedManagers,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[trades] query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load trades" };
    return NextResponse.json(payload, { status: 500 });
  }
}
