import type {
  KtcBoardChoice,
  RosterTimelinePayload,
  TimelineRosterPayload,
  TimelineSeasonPayload,
} from "@/shared/contract";
import { leagueTeamName } from "@/shared/manager";
import type { DraftPickAsset } from "@/shared/manager";
import { getPlayersByIds } from "@/shared/players";

import { readTimelinePricing } from "./pricing";
import type { LeagueTimeline, TimelineSeason } from "./read";

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

  const { seasons, earlierLeagueId } = timeline;

  // **Every player the timeline can name, across every season it spans.** A
  // stop's whole point is the players who are no longer there, so the union
  // covers each season's stored rosters plus everyone added or dropped in it —
  // reversing a drop puts a player back on a roster, and a name the payload does
  // not carry is one nothing else on the page can supply. Ten years of a dynasty
  // league is the case that makes this worth doing once rather than per season.
  const playerIds = new Set<string>();
  for (const { league, events } of seasons) {
    for (const roster of league.rosters) {
      for (const id of roster.players) {
        if (typeof id === "string" && id) playerIds.add(id);
      }
    }
    for (const event of events) {
      for (const id of Object.keys(event.adds)) playerIds.add(id);
      for (const id of Object.keys(event.drops)) playerIds.add(id);
    }
  }

  const [players, priced] = await Promise.all([
    getPlayersByIds([...playerIds]),
    readTimelinePricing({ seasons, playerIds, managerUserId, season, board }),
  ]);

  // The grid each rewind starts from is the same enumeration the price table is
  // keyed by — see `readTimelinePricing`'s own note on why they come back from
  // there rather than being laid a second time here.
  const seasonPayloads: TimelineSeasonPayload[] = seasons.map((entry) =>
    resolveSeason(entry, priced.owned.get(entry.league.league_id)),
  );

  return {
    timeline: {
      league_id: seasons[0].league.league_id,
      seasons: seasonPayloads,
      earlier_league_id: earlierLeagueId,
    },
    players,
    pricing: priced.pricing,
  };
}

/**
 * One season's rosters, named.
 *
 * **Named from that season's own `league_users`**, which is the one place a
 * chain must not take the newest year's answer. A manager who left after 2024
 * is in that season's member rows and not in this one's, so naming its rosters
 * off today's list would leave the teams they held reading `Roster 7` — and a
 * team that changed hands would be labelled with a manager who never held it
 * that year. `leagueTeamName` is still the one spelling of the rule, applied to
 * each season's own two columns.
 *
 * That is a deliberate divergence from how a *stop within* a season is named,
 * where the holder is today's: there, Sleeper stores no past ownership at all,
 * so today's name is the only one available. Here each season really does carry
 * its own, and using it is strictly more true.
 */
function resolveSeason(
  { league, season, events }: TimelineSeason,
  owned: ReadonlyMap<number, DraftPickAsset[]> | undefined,
): TimelineSeasonPayload {
  const rosters: TimelineRosterPayload[] = league.rosters.map((roster) => ({
    roster_id: roster.roster_id,
    name: leagueTeamName(league.users, roster.roster_id, roster.owner_id),
    user_id: roster.owner_id,
    players: roster.players.filter((id) => typeof id === "string" && id),
    picks: (owned?.get(roster.roster_id) ?? []).map((pick) => ({
      season: pick.season,
      round: pick.round,
      // `ownedDraftPicks` names the origin `original_roster_id`; on the wire and
      // in the transactions being reversed it is Sleeper's `roster_id`.
      roster_id: pick.original_roster_id,
    })),
  }));

  return { league_id: league.league_id, season, rosters, events };
}
