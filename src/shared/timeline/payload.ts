import type { RosterTimelinePayload, TimelineRosterPayload } from "@/shared/contract";
import { getPlayersByIds } from "@/shared/players";

import type { LeagueTimeline } from "./read";

/**
 * A replay's ids resolved to the names a reader sees.
 *
 * A null timeline short-circuits before any lookup: it is a complete answer,
 * and the read below would be a no-op on an empty id list anyway.
 */
export async function resolveTimelinePayload(
  timeline: LeagueTimeline | null,
): Promise<RosterTimelinePayload> {
  if (!timeline) return { timeline: null, players: {} };

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

  const players = await getPlayersByIds([...playerIds]);

  const rosters: TimelineRosterPayload[] = timeline.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    name: roster.name,
    players: roster.state.players,
    picks: roster.state.picks,
  }));

  return {
    timeline: {
      league_id: timeline.league_id,
      rosters,
      events: timeline.events,
    },
    players,
  };
}
