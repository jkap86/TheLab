/**
 * One league's expanded-card answer, composed whole: every roster solved and
 * totalled (`league-ranks`), every portfolio named (`draft-picks`), every team
 * labelled — so the route stays a handler and the naming rule has one home.
 *
 * Pure on the same terms as both modules it composes: runtime imports are
 * relative with `.ts`, the contract import is type-only, and the query layer
 * hands it the rows — `ManagerLeagueRow` satisfies {@link LineupLeagueRow}
 * structurally, which is what keeps this testable without `pg`.
 */

import type { LeagueLineupEntry, LeagueTeam } from "@/shared/contract";

import type { RosProjections } from "../projections/ros.ts";
import { leagueRosterPicks } from "./draft-picks.ts";
import type { PickLeague } from "./draft-picks.ts";
import { rankLeagueLineups } from "./league-ranks.ts";
import type { RankLeague } from "./league-ranks.ts";

/**
 * What one league's entry is built from: the solve's half and the picks' half
 * of the same stored graph. The two name the `rosters` field at different
 * widths and the intersection resolves to the wider one, so a query row
 * carrying `players` satisfies both.
 */
export type LineupLeagueRow = RankLeague & PickLeague;

/**
 * How a team is labelled, which is Sleeper's own rule for a league page: the
 * team's chosen name, else its owner's display name, else the roster number.
 * Blank strings fold in with null at each step — Sleeper stores an unset name
 * as `""` about as often as it omits it. One spelling here, because the teams
 * pane and anything later that lists a league's teams must agree on it.
 */
export function leagueTeamName(
  users: PickLeague["users"],
  rosterId: number,
  ownerId: string | null,
): string {
  const user = ownerId === null ? null : users.find((u) => u.user_id === ownerId);
  return (
    user?.team_name?.trim() || user?.display_name?.trim() || `Roster ${rosterId}`
  );
}

/**
 * Solve one league into its {@link LeagueLineupEntry}: the manager's ranks,
 * plus every team's lineup, totals and picks for the card's team picker.
 *
 * Null where the manager holds no roster — the query already filters those
 * leagues out, so hitting it means the store moved between reads, and the
 * route omits the league the way it always has.
 */
export function solveLeagueEntry(
  league: LineupLeagueRow,
  managerUserId: string,
  season: string,
  projections: RosProjections,
  adp: ReadonlyMap<string, number>,
): LeagueLineupEntry | null {
  const { lineup, ranks, rosters } = rankLeagueLineups(
    league,
    managerUserId,
    projections,
    adp,
  );
  if (!lineup) return null;

  const picks = leagueRosterPicks(league, season);
  const teams: LeagueTeam[] = rosters.map(({ roster, lineup, totals }) => ({
    roster_id: roster.roster_id,
    name: leagueTeamName(league.users, roster.roster_id, roster.owner_id),
    is_manager: roster.owner_id === managerUserId,
    lineup,
    totals,
    picks: picks.get(roster.roster_id) ?? [],
  }));

  return { teams, ranks };
}
