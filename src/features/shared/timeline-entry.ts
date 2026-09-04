import type { AdpEntry } from "../../shared/manager/adp-value.ts";
import { pickCellKey } from "../../shared/manager/draft-picks.ts";
import { rankLeagueLineups } from "../../shared/manager/league-ranks.ts";
import type { RosProjections } from "../../shared/projections/ros.ts";
import type {
  LeagueLineupEntry,
  LeagueTeam,
  RosterPick,
  RosterTimelinePayload,
} from "@/shared/contract";

import { timelineRosters } from "./timeline.ts";
import type { TimelineRoster } from "./timeline.ts";

/**
 * A past roster priced at **what it would be worth today**.
 *
 * **This is a counterfactual, and it is a different question from the one the
 * rail's rosters answer.** Nothing in this app keeps a history of a projection,
 * an ADP or a KeepTradeCut price — the three boards are only ever *now* — so
 * "what was that team worth in October" is not answerable, and pretending
 * otherwise would be the claim the whole timeline is arranged to avoid. What is
 * answerable, and is the thing a reader scrubbing back actually wants, is *what
 * that team would be worth if it still existed*: the roster from then, the
 * market from today. That is what makes a trade or a drop legible after the
 * fact, and it is why the metrics are priced rather than blanked.
 *
 * **It is the card's own solve over different rosters.** `rankLeagueLineups` is
 * the same function the lineups route runs, reached directly because every
 * module in that chain is pure for exactly this reason — so a past total and a
 * present one cannot be computed two ways, and the seat order, the edge rules
 * and the all-zero rule are the ones already documented. What this adds is only
 * the substitution: rewound players in place of today's, and a rewound
 * portfolio looked up in a price table the server resolved once.
 *
 * **A stop is arithmetic, not a request.** There is a stop per move and the
 * solve runs over a dozen rosters, which is microseconds; the alternative — a
 * priced answer per stop from the server — is the request-per-notch the
 * payload's whole shape exists to avoid.
 *
 * Null only where there is no timeline at all. **A payload with no `pricing`
 * still returns an entry**, every total zero: `LeagueTeams` draws dashes under
 * the all-zero rule, so a league whose boards could not be read shows its past
 * rosters with no numbers rather than nothing at all.
 */
export function timelineEntry(
  payload: RosterTimelinePayload | null,
  back: number,
  /** Which roster is the reader's own — the card knows, the payload does not. */
  managerRosterId: number | null,
): LeagueLineupEntry | null {
  const timeline = payload?.timeline;
  if (!timeline) return null;

  const rosters = timelineRosters(payload, back);
  const pricing = payload?.pricing ?? null;

  // The manager is named by roster on the card and by owner in the solve, and
  // this is the join. Null — an account whose lineups have not landed, or a
  // league they hold no roster in — ranks nothing and marks no team, which is
  // what `rankLeagueLineups` already does with an owner it cannot find.
  const managerUserId =
    rosters.find((r) => r.roster_id === managerRosterId)?.user_id ?? null;

  const projections: RosProjections = pricing?.projections ?? {};
  const adp = new Map<string, AdpEntry>(Object.entries(pricing?.adp ?? {}));
  const ktc = new Map<string, number>(Object.entries(pricing?.ktc_values ?? {}));

  const picks = new Map<number, RosterPick[]>();
  const pickValues = new Map<number, number>();
  for (const roster of rosters) {
    const owned = timelinePicks(roster, pricing);
    picks.set(roster.roster_id, owned);
    pickValues.set(
      roster.roster_id,
      owned.reduce((sum, pick) => sum + (pick.value ?? 0), 0),
    );
  }

  const solved = rankLeagueLineups(
    {
      league_id: timeline.league_id,
      total_rosters: pricing?.league.total_rosters ?? rosters.length,
      roster_positions: pricing?.league.roster_positions ?? null,
      scoring_settings: pricing?.league.scoring_settings ?? null,
      rosters: rosters.map((roster) => ({
        roster_id: roster.roster_id,
        owner_id: roster.user_id,
        players: roster.players,
      })),
    },
    managerUserId ?? NO_MANAGER,
    projections,
    adp,
    ktc,
    pickValues,
  );

  const named = new Map(rosters.map((r) => [r.roster_id, r.name]));
  const teams: LeagueTeam[] = solved.rosters.map(({ roster, lineup, totals }) => ({
    roster_id: roster.roster_id,
    // The timeline's own name, which is `leagueTeamName`'s answer resolved on
    // the server — so a team is called the same thing at every stop and on the
    // card the rail swaps for.
    name: named.get(roster.roster_id) ?? `Roster ${roster.roster_id}`,
    // By roster rather than by owner, because the card knows which roster is
    // the reader's even where the payload's owner column is null.
    is_manager: roster.roster_id === managerRosterId,
    lineup,
    totals,
    picks: picks.get(roster.roster_id) ?? [],
  }));

  return { teams, ranks: solved.ranks };
}

/**
 * A stand-in for "no manager", used where the reader's own roster is unknown.
 *
 * A space, because no Sleeper user id is one and an orphaned roster's owner is
 * `null` rather than empty — so this matches nothing on either side.
 * `rankLeagueLineups` answers a manager it cannot find with every rank null and
 * every roster still solved, which is exactly right here: the pane is a table
 * of teams, and the ranks are not drawn in it.
 */
const NO_MANAGER = " ";

/**
 * One rewound portfolio, in the shape the card's own `DraftPicks` draws.
 *
 * **The rewind moves cells between rosters and changes nothing about a cell**,
 * so a pick's slot and its price are looked up rather than re-resolved: the
 * server resolved every cell in the grid once (`PickCell`), which is what keeps
 * a past pick from being priced off a different third of its round than the one
 * the present card shows.
 *
 * `from` is the one field that *is* relative to the holder — the same asset is
 * "from Slim" in one portfolio and origin-less in the one it came out of — so it
 * is decided here, at the stop, rather than on the wire.
 *
 * A cell the table has no row for still draws: the slot and the price go null,
 * which is what an unplaced or unpriced pick already means everywhere else, and
 * the origin falls back to the roster number rather than to nothing.
 */
function timelinePicks(
  roster: TimelineRoster,
  pricing: RosterTimelinePayload["pricing"],
): RosterPick[] {
  return roster.picks.map((pick) => {
    const cell =
      pricing?.picks[pickCellKey(pick.season, pick.round, pick.roster_id)] ??
      null;
    return {
      season: pick.season,
      round: pick.round,
      slot: cell?.slot ?? null,
      from:
        pick.roster_id === roster.roster_id
          ? null
          : (cell?.origin_name ?? `Roster ${pick.roster_id}`),
      value: cell?.value ?? null,
    };
  });
}
