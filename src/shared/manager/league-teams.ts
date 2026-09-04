/**
 * One league's expanded-card answer, composed whole: every roster solved and
 * totalled (`league-ranks`), every portfolio named (`draft-picks`), every team
 * labelled — so the route stays a handler and the naming rule has one home.
 *
 * Pure on the same terms as every module it composes — the KTC halves it
 * reaches (`ktc/picks`, `ktc/roster`) are pure for exactly this reason, since
 * that folder's barrel is server-only. Runtime imports are relative with `.ts`,
 * the contract import is type-only, and the query layer hands it the rows —
 * `ManagerLeagueRow` satisfies {@link LineupLeagueRow} structurally, which is
 * what keeps this testable without `pg`.
 *
 * **The picks are resolved before the ranks, and the order is load-bearing.**
 * `ktc_picks` is one of the nine ranked metrics and a pick's price is not on
 * any player, so the portfolios have to exist before `rankLeagueLineups` can
 * total anything. Resolving them afterwards — which is what this did until the
 * KTC columns landed — would mean either a second reconstruction of the same
 * grid or a rank computed without the picks and a card showing them, and the
 * two would disagree with nothing on screen saying so.
 */

import type { LeagueLineupEntry, LeagueTeam } from "@/shared/contract";

import { ktcPickPrice, pickTier } from "../ktc/picks.ts";
import type { KtcPickPrice } from "../ktc/picks.ts";
import { ktcBoardValue } from "../ktc/roster.ts";
import type { RosProjections } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";
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
  adp: ReadonlyMap<string, AdpEntry>,
  ktc: KtcPricing = NO_KTC,
): LeagueLineupEntry | null {
  const picks = leagueRosterPicks(league, season, (pick) =>
    pickValue(ktc, league.total_rosters, pick),
  );

  const pickValues = new Map<number, number>();
  for (const [rosterId, owned] of picks) {
    pickValues.set(
      rosterId,
      owned.reduce((sum, pick) => sum + (pick.value ?? 0), 0),
    );
  }

  const { lineup, ranks, rosters } = rankLeagueLineups(
    league,
    managerUserId,
    projections,
    adp,
    ktc.values,
    pickValues,
  );
  if (!lineup) return null;
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

/**
 * What this league reads KeepTradeCut on: the player prices for its market and
 * QB board, and the rookie-pick rows of that same market.
 *
 * The two travel together because they are one answer to one question — which
 * market, which of its two numbers — asked once per league by the route rather
 * than once per player here.
 */
export type KtcPricing = {
  /** Sleeper player id → price on this league's board; unpriced ids absent. */
  values: ReadonlyMap<string, number>;
  /** KTC's pick rows for this market, keyed by `ktcPickKey`. */
  picks: Readonly<Record<string, KtcPickPrice>>;
  /** Which of the two QB numbers this league reads — `isSuperflexLineup`. */
  superflex: boolean;
};

/** No board read at all: every player and every pick prices to null. */
const NO_KTC: KtcPricing = { values: new Map(), picks: {}, superflex: false };

/**
 * What KTC prices one resolved pick at, or null where it prices nothing for it.
 *
 * The two vocabularies meet here. KTC names a pick by a third of its round;
 * Sleeper holds one by a roster, and `leagueRosterPicks` has already turned
 * that into the slot it falls on. {@link pickTier} places the slot in the
 * round — using the league's own size, since that is the width of the board the
 * thirds divide — and `pickTier` answers null both for a pick with no slot yet
 * (most of them: the draft does not exist) and for a league too small for the
 * word "early" to mean anything. {@link ktcPickPrice} reads both cases
 * correctly, taking KTC's untiered row first and its middle third as the
 * stand-in, which is the convention every trade calculator uses for an unplaced
 * future pick.
 *
 * Null where KTC carries no row for the season and round at all — every pick
 * past its three-season horizon, every round past the fourth, and every pick in
 * a league read on the redraft market, which has no pick rows. That is a
 * genuine gap and reads as one: the pick falls out of the total rather than
 * dragging it toward zero.
 *
 * Exported for `shared/timeline`, which prices the same league's pick grid for
 * a rewound portfolio: the two vocabularies meet in exactly one place, and a
 * second meeting is a past pick priced off a different third of its round from
 * the one the card beside it shows.
 */
export function pickValue(
  ktc: KtcPricing,
  teams: number,
  pick: { season: string; round: number; slot: number | null },
): number | null {
  const tier =
    pick.slot === null ? null : pickTier(pick.slot, teams);
  const match = ktcPickPrice(ktc.picks, pick, tier);
  return match ? ktcBoardValue(ktc.superflex, match.price) : null;
}
