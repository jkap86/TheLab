import type {
  LeaguematePayload,
  RosterTimelinePayload,
  RosterTimelineRosterPayload,
} from "@/shared/contract";
import { sleeperAvatarUrl } from "@/shared/sleeper";

import { lookupPlayers } from "./enrich";
import { getTradeManagers } from "./queries";
import type { RosterTimeline } from "./roster-history";

/**
 * A replay's ids resolved to the names a reader sees.
 *
 * **It is one function because there are two routes.** `/api/trades/timeline`
 * anchors on a trade and `/api/league/[leagueId]/timeline` runs the whole log,
 * and the *only* thing that differs between them is which walk produced the
 * timeline — the union of players to name, the manager lookup and the shape that
 * comes out are identical. Written twice they would be one edit away from two
 * screens disagreeing about which players a stop can name, which is a bug with no
 * symptom but a missing name at exactly the moment somebody scrubbed to.
 *
 * A null timeline short-circuits before any lookup: it is a complete answer, and
 * the two reads below would each be a no-op on an empty id list anyway.
 */
export async function resolveTimelinePayload(
  timeline: RosterTimeline | null,
): Promise<RosterTimelinePayload> {
  if (!timeline) return { timeline: null, players: {}, managers: {} };

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

  const rosters: RosterTimelineRosterPayload[] = timeline.rosters.map(
    (roster) => ({
      roster_id: roster.roster_id,
      user_id: roster.owner_id,
      players: roster.state.players,
      picks: roster.state.picks.map((pick) => ({
        season: pick.season,
        round: pick.round,
        roster_id: pick.roster_id,
      })),
    }),
  );

  // Everyone holding a roster in this league. That covers the pick origins too,
  // which is why nothing here resolves one: the timeline draws the whole league,
  // so a pick's origin is always a roster on this list and naming its holder is a
  // lookup the client can make for itself — see {@link RosterTimelineRosterPayload}.
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
    timeline: {
      league_id: timeline.league_id,
      anchor: timeline.anchor,
      rosters,
      events: timeline.events,
    },
    players: Object.fromEntries(players),
    managers: resolvedManagers,
  };
}
