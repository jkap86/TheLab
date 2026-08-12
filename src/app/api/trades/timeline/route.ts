import { NextResponse } from "next/server";

import type {
  LeaguematePayload,
  TradeTimelinePayload,
  TradeTimelineRosterPayload,
} from "@/shared/contract";
import { sleeperAvatarUrl } from "@/shared/sleeper";
import {
  getTradeManagers,
  getTradeTimeline,
  lookupPlayers,
} from "@/shared/trades";
import type { TradeTimeline } from "@/shared/trades";

import { readFailureResponse } from "../../read-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the league sheet needs to read a league's rosters at any moment
 * between one trade and today — see {@link TradeTimelinePayload}.
 *
 * **The one route on this board that derives rather than reads a cache**, and the
 * exception is argued where the derivation lives (`getTradeTimeline`): the rule
 * these routes follow is that a *board page* never walks a league's whole
 * transaction log, because a page names twenty trades from twenty leagues. This
 * is one league, on a press, behind a modal — the same class of read as
 * `/api/league/[leagueId]`, which the same sheet already makes.
 *
 * **A trade id and nothing else**, the sibling routes' rule: the question is
 * about one stored trade rather than a population, so whatever board a reader
 * pressed the card on, the answer is the same answer and the client's cache entry
 * is keyed on the id alone.
 */
export async function GET(request: Request) {
  const trade = new URL(request.url).searchParams.get("trade")?.trim();
  // The one thing that can fail the request, and it is a malformed request
  // rather than a narrowing: every other route here reads an unreadable value as
  // "don't filter", which has no meaning when the value *is* the question.
  if (!trade) {
    return NextResponse.json(
      { error: "A trade id is required" },
      { status: 400 },
    );
  }

  try {
    const timeline = await getTradeTimeline(trade);
    const payload = await resolvePayload(trade, timeline);
    return NextResponse.json(payload, {
      headers: {
        // Short, for the reason the board's other reads are: what a roster held
        // on a past date cannot change, but *whether this league has been
        // crawled far enough to say* changes as the syncs run — and a freshly
        // discovered league's first answer is the one worth not caching for an
        // hour. A minute covers a reader opening the same sheet twice.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("[trades] timeline failed:", error);
    return readFailureResponse(error, "Failed to load the league's timeline");
  }
}

/**
 * The walk's output with its ids resolved to names.
 *
 * An unanswerable trade short-circuits before any lookup: `timeline: null` is a
 * complete answer, and the three reads below would each be a no-op on an empty id
 * list anyway.
 */
async function resolvePayload(
  trade: string,
  timeline: TradeTimeline | null,
): Promise<TradeTimelinePayload> {
  if (!timeline) {
    return { transaction_id: trade, timeline: null, players: {}, managers: {} };
  }

  // **Every player the timeline can name, not just the ones held now.** A stop's
  // whole point is the players who are no longer there, so the union covers the
  // current rosters plus everyone who was added or dropped in the window —
  // reversing a drop puts a player back on a roster, and a name the payload does
  // not carry is one nothing else on the page can supply.
  const playerIds = new Set<string>();
  for (const roster of timeline.rosters) {
    for (const id of roster.state.players) playerIds.add(id);
  }
  for (const event of timeline.events) {
    for (const id of Object.keys(event.adds)) playerIds.add(id);
    for (const id of Object.keys(event.drops)) playerIds.add(id);
  }

  const players = await lookupPlayers([...playerIds]);

  const rosters: TradeTimelineRosterPayload[] = timeline.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    user_id: roster.owner_id,
    players: roster.state.players,
    picks: roster.state.picks.map((pick) => ({
      season: pick.season,
      round: pick.round,
      roster_id: pick.roster_id,
    })),
  }));

  // Everyone holding a roster in this league. That covers the pick origins too,
  // which is why nothing here resolves one: the timeline draws the whole league,
  // so a pick's origin is always a roster on this list and naming its holder is a
  // lookup the client can make for itself — see {@link TradeTimelineRosterPayload}.
  const userIds = new Set<string>();
  for (const roster of rosters) {
    if (roster.user_id) userIds.add(roster.user_id);
  }
  const managers = await getTradeManagers([...userIds]);

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
    timeline: {
      league_id: timeline.league_id,
      traded_at: timeline.traded_at,
      rosters,
      events: timeline.events,
    },
    players: Object.fromEntries(players),
    managers: resolvedManagers,
  };
}
