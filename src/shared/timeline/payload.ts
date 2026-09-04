import type {
  KtcBoardChoice,
  RosterTimelinePayload,
  TimelineRosterPayload,
} from "@/shared/contract";
import { leagueTeamName } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";

import { readTimelinePricing } from "./pricing";
import type { LeagueTimeline } from "./read";

/**
 * A replay's ids resolved to the names a reader sees, and today's boards to
 * price a past stop against.
 *
 * A null timeline short-circuits before any lookup: it is a complete answer,
 * and every read below would be a no-op on an empty league anyway.
 */
export async function resolveTimelinePayload(
  timeline: LeagueTimeline | null,
  {
    managerUserId,
    season,
    board,
  }: { managerUserId: string | null; season: string; board: KtcBoardChoice },
): Promise<RosterTimelinePayload> {
  if (!timeline) return { timeline: null, players: {}, pricing: null };

  const { league, events } = timeline;

  // **Every player the timeline can name, not just the ones held now.** A stop's
  // whole point is the players who are no longer there, so the union covers the
  // current rosters plus everyone who was added or dropped in the window —
  // reversing a drop puts a player back on a roster, and a name the payload does
  // not carry is one nothing else on the page can supply.
  const playerIds = new Set<string>();
  for (const roster of league.rosters) {
    for (const id of roster.players) {
      if (typeof id === "string" && id) playerIds.add(id);
    }
  }
  for (const event of events) {
    for (const id of Object.keys(event.adds)) playerIds.add(id);
    for (const id of Object.keys(event.drops)) playerIds.add(id);
  }

  const [players, priced] = await Promise.all([
    getPlayersByIds([...playerIds]),
    readTimelinePricing({
      league,
      playerIds,
      managerUserId,
      season,
      board,
    }),
  ]);

  // The grid the rewind starts from is the same enumeration the price table is
  // keyed by — see `readTimelinePricing`'s own note on why it comes back from
  // there rather than being laid a second time here.
  const held = priced.owned;

  const rosters: TimelineRosterPayload[] = league.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    // `leagueTeamName` rather than a second reading of the same two columns:
    // the teams pane this rail swaps for calls the team the same thing, and two
    // spellings is how "now" and "then" come to disagree about whose roster a
    // reader is looking at.
    name: leagueTeamName(league.users, roster.roster_id, roster.owner_id),
    user_id: roster.owner_id,
    players: roster.players.filter((id) => typeof id === "string" && id),
    picks: (held.get(roster.roster_id) ?? []).map((pick) => ({
      season: pick.season,
      round: pick.round,
      // `ownedDraftPicks` names the origin `original_roster_id`; on the wire and
      // in the transactions being reversed it is Sleeper's `roster_id`.
      roster_id: pick.original_roster_id,
    })),
  }));

  return {
    timeline: { league_id: league.league_id, rosters, events },
    players,
    pricing: priced.pricing,
  };
}
