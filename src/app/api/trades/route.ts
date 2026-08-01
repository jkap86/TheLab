import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  LeaguematePayload,
  TradesPayload,
} from "@/shared/contract";
import { getLeaguesByIds } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";
import { isSeason } from "@/shared/query";
import { DEFAULT_SEASON, sleeperAvatarUrl } from "@/shared/sleeper";
import { getAllTrades, getTradeManagers } from "@/shared/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every completed trade in every crawled league for a season — see
 * {@link TradesPayload}.
 *
 * It sits at the top level rather than under `/api/user/[username]` because it
 * asks nothing about a manager: the page it serves is a window on the whole
 * market this database has seen, and narrowing to one account's leagues is what
 * its managers filter does afterwards. That also makes it the plainest kind of
 * cache-backed route — no username to resolve, so a season nothing has been
 * crawled for comes back empty rather than syncing anything.
 *
 * Every filter the trades page offers is applied on the client, which is why
 * this takes no query string beyond the season. The narrowing is a filter *set*
 * whose options are read off the trades themselves (which players moved, which
 * managers dealt) and off the leagues they happened in, so the client needs the
 * unnarrowed list in hand either way; filtering here would cost a round trip per
 * chip and hand back an option list that had shrunk to the selection.
 */
export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("season");
  const season = requested && isSeason(requested) ? requested : DEFAULT_SEASON;

  try {
    const { trades, total } = await getAllTrades(season);

    // What to resolve is the answer to the first read, so these follow it — but
    // the three are independent of each other.
    const playerIds = new Set<string>();
    const managerIds = new Set<string>();
    const leagueIds = new Set<string>();
    for (const trade of trades) {
      leagueIds.add(trade.league_id);
      for (const side of trade.sides) {
        side.players.forEach((id) => playerIds.add(id));
        if (side.user_id) managerIds.add(side.user_id);
      }
    }

    const [players, managers, leagues] = await Promise.all([
      getPlayersByIds([...playerIds]),
      getTradeManagers([...managerIds]),
      getLeaguesByIds([...leagueIds]),
    ]);

    const resolvedManagers: Record<string, LeaguematePayload> = {};
    for (const [id, m] of managers) {
      resolvedManagers[id] = {
        user_id: id,
        display_name: m.display_name,
        avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
      };
    }

    const payload: TradesPayload = {
      season,
      trades,
      total,
      leagues,
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
