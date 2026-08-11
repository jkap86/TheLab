import { NextResponse } from "next/server";

import type {
  LeaguematePayload,
  TradeRosterPayload,
  TradeRostersPayload,
} from "@/shared/contract";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import {
  getRosterOwners,
  getTradeManagers,
  getTradeRosters,
  lookupPlayers,
} from "@/shared/trades";
import type { TradeRosterRow } from "@/shared/trades";

import { readFailureResponse } from "../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What each side of one trade held immediately before it — see
 * {@link TradeRostersPayload} for the payload and why it is a route of its own.
 *
 * **Cache-backed and nothing else**, the rule every route here but the resolvers
 * follows: the snapshot is written by the league sync, on the tick where both of
 * its inputs already land, so a trade the crawler has not reached comes back with
 * an empty `rosters` rather than being reconstructed on demand. That is not
 * frugality — the walk behind a snapshot reads a league's *whole* transaction log
 * to answer one trade, which is exactly the read a board page must never make.
 *
 * **A trade id and nothing else.** There is no season, no filter and no scope
 * here, because the question is about one stored trade rather than a population:
 * whatever board a reader pressed the card on, the answer is the same answer, so
 * the client's cache entry is keyed on the id alone.
 *
 * The three lookups behind it are the board's own, cached in-process for the same
 * reason and hitting the same entries — a reader opening cards on a board they
 * have been scrolling is asking about leagues and players those pages already
 * resolved.
 */
export async function GET(request: Request) {
  const trade = new URL(request.url).searchParams.get("trade")?.trim();
  // The one thing that can fail the request, and it is a malformed request
  // rather than a narrowing: every other route here treats an unreadable value
  // as "don't filter", which has no meaning when the value *is* the question.
  if (!trade) {
    return NextResponse.json(
      { error: "A trade id is required" },
      { status: 400 },
    );
  }

  try {
    const byTrade = await getTradeRosters([trade]);
    const rows = byTrade.get(trade) ?? [];

    const payload = await resolvePayload(trade, rows);
    return NextResponse.json(payload, {
      headers: {
        // A past trade's pre-trade roster does not change once it is right, so
        // this is the one read on the board that could be cached hard. It isn't,
        // because a snapshot the crawler has not written *yet* is the common
        // first answer for a freshly discovered league, and caching an empty one
        // for an hour would make the card say "not recorded" long after it was.
        // A minute is enough to cover a reader toggling the same card.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[trades] pre-trade rosters failed:", error);
    return readFailureResponse(error, "Failed to load rosters");
  }
}

/**
 * The stored rows with their ids resolved to names.
 *
 * An empty snapshot short-circuits before any lookup: `rosters: []` is a complete
 * answer and the three reads below would each be a no-op on an empty id list
 * anyway, so this is about saying so plainly rather than about the microseconds.
 */
async function resolvePayload(
  trade: string,
  rows: readonly TradeRosterRow[],
): Promise<TradeRostersPayload> {
  if (rows.length === 0) {
    return { transaction_id: trade, rosters: [], players: {}, managers: {} };
  }

  // Every row of one trade carries the same league — the snapshot is written per
  // trade — so this is one league's map however many sides there are.
  const leagueId = rows[0].league_id;

  const playerIds = [...new Set(rows.flatMap((r) => r.state.players))];

  const [players, ownersByLeague] = await Promise.all([
    lookupPlayers(playerIds),
    getRosterOwners([leagueId]),
  ]);
  const owners = ownersByLeague.get(leagueId) ?? new Map<number, string>();

  const rosters: TradeRosterPayload[] = rows.map((row) => ({
    roster_id: row.roster_id,
    players: row.state.players,
    picks: row.state.picks.map((pick) => ({
      season: pick.season,
      round: pick.round,
      roster_id: pick.roster_id,
      user_id: owners.get(pick.roster_id) ?? null,
    })),
  }));

  // Only the origins actually named above — a league's map covers every roster in
  // it, and a portfolio names a handful. The same narrowing `resolvePickSlots`
  // makes one route over.
  const originIds = [
    ...new Set(
      rosters.flatMap((r) =>
        r.picks.map((p) => p.user_id).filter((id): id is string => id !== null),
      ),
    ),
  ];
  const managers = await getTradeManagers(originIds);

  const resolvedManagers: Record<string, LeaguematePayload> = {};
  for (const [id, m] of managers) {
    resolvedManagers[id] = {
      user_id: id,
      display_name: m.display_name,
      avatar_url: sleeperAvatarUrl(m.avatar, "thumb"),
    };
  }

  return {
    transaction_id: trade,
    rosters,
    players: Object.fromEntries(players),
    managers: resolvedManagers,
  };
}
