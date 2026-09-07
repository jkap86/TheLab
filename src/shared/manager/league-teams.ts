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
 * `ktc_picks` is one of the ranked metrics and a pick's price is not on
 * any player, so the portfolios have to exist before `rankLeagueLineups` can
 * total anything. Resolving them afterwards — which is what this did until the
 * KTC columns landed — would mean either a second reconstruction of the same
 * grid or a rank computed without the picks and a card showing them, and the
 * two would disagree with nothing on screen saying so.
 */

import type {
  LeagueLineupEntry,
  LeagueTeam,
  LineupPosition,
} from "@/shared/contract";

import { ktcPickPrice, pickTier } from "../ktc/picks.ts";
import type { KtcPickPrice } from "../ktc/picks.ts";
import { ktcBoardValue } from "../ktc/roster.ts";
import type { RosProjections } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";
import { leaguePickBoard, pickCellKey } from "./draft-picks.ts";
import type { LeaguePickBoard, PickLeague } from "./draft-picks.ts";
import { rankLeagueLineups } from "./league-ranks.ts";
import type { AdpVariant, RankLeague, RankVariant } from "./league-ranks.ts";

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
 * A stand-in for "no manager", used where the reader holds no roster in this
 * league — or where the question has no manager in it at all.
 *
 * A space, because no Sleeper user id is one and **an orphaned roster's owner
 * is `null`**: a bare `null` sentinel would mark every ownerless team as the
 * reader's own and rank the page against it. The one spelling, so the
 * league-scoped route and the browser's own rewind cannot disagree about what
 * "nobody" is — `timeline-entry.ts` reads it from here.
 */
export const NO_MANAGER = " ";

/**
 * Solve one league into its {@link LeagueLineupEntry}: the manager's ranks,
 * plus every team's lineup, totals and picks for the card's team picker.
 *
 * **The manager is optional, and the two absences are different absences.**
 * A *named* manager who holds no roster answers null: the manager route's query
 * already filters those leagues out, so hitting it means the store moved
 * between reads, and the route omits the league the way it always has. A
 * **null** manager is a different question — "solve this league", with nobody
 * in it — which is what a league-scoped caller asks: the trade card lists
 * leagues the reader may have no team in at all, and refusing to solve one
 * because of that would empty the card over a fact about the *reader*. So a
 * null manager solves every roster, marks none of them and ranks nothing,
 * which is exactly what {@link rankLeagueLineups} already does with an owner it
 * cannot find.
 *
 * That is the same split the queries behind it draw: `getManagerLeagueRosters`
 * gates on `HOLDS_A_ROSTER_SQL` and `getLeagueLineupRow` deliberately does not,
 * because there is no manager in *that* question either.
 */
export function solveLeagueEntry(
  league: LineupLeagueRow,
  /** Null for a league-scoped read — see the note above. */
  managerUserId: string | null,
  season: string,
  projections: RosProjections,
  adp: ReadonlyMap<string, AdpEntry>,
  ktc: KtcPricing = NO_KTC,
  /**
   * The extra boards this page's columns have forced, already resolved against
   * this league. Empty for a page whose KTC columns all read `auto`, which is
   * every page until a reader sets a bay's market or lineup by hand.
   */
  variants: readonly KtcVariantPricing[] = [],
  /**
   * The distinct position narrowings this page's columns carry, already parsed
   * off the request. Empty for a page whose columns all count every position,
   * which is every page until a reader narrows a bay.
   *
   * **They ride through to the ranks and stop there**, and that is a decision
   * rather than an omission. A narrowing decides what a *rank* counts; it
   * touches neither the picks resolved above nor the lineups the teams pane
   * renders, and a {@link LeagueTeam} still carries the ten whole-roster
   * totals it always did. Shipping a per-position total beside them was the
   * alternative and nothing would read it: the expanded browser sorts and
   * prints by a bare {@link LineupMetricId} (`team.totals[metric]`) and the
   * timeline re-solves through {@link rankLeagueLineups} for the same ten, so
   * a narrowed total would be a field on every team of every league that no
   * reader could name — the dead weight the next reader has to prove is dead.
   * It arrives with a browser that can ask the question.
   */
  positionSets: readonly (readonly LineupPosition[])[] = [],
  /**
   * The extra ADP boards this page's capital columns have forced. Page-wide
   * rather than per league, which is where they differ from the KeepTradeCut
   * variants above: a QB board choice is `sf` or `oneqb` outright — `auto` is
   * dropped before it gets here, being what the base ranks answer — so there is
   * nothing left to resolve against a league. What *is* league-specific is the
   * pool the curve is anchored to, and that is `rankLeagueLineups`' to compute.
   */
  adpVariants: readonly AdpVariant[] = [],
): LeagueLineupEntry | null {
  const board = leaguePickBoard(league, season, (pick) =>
    pickValue(ktc, league.total_rosters, pick),
  );
  const picks = board.byRoster;

  const pickValues = new Map<number, number>();
  for (const [rosterId, owned] of picks) {
    pickValues.set(
      rosterId,
      owned.reduce((sum, pick) => sum + (pick.value ?? 0), 0),
    );
  }

  const { lineup, ranks, rosters } = rankLeagueLineups(
    league,
    managerUserId ?? NO_MANAGER,
    projections,
    adp,
    ktc.values,
    pickValues,
    variants.map((variant): RankVariant => ({
      key: variant.key,
      values: variant.values,
      pickValues: variantPickValues(board, league.total_rosters, variant),
    })),
    positionSets,
    adpVariants,
  );
  // Only where a manager was *named*: a league-scoped read has no lineup of its
  // own to miss, and answering null there would be refusing to draw a league
  // over the absence of somebody the question never mentioned.
  if (managerUserId !== null && !lineup) return null;
  const teams: LeagueTeam[] = rosters.map(({ roster, lineup, totals }) => ({
    roster_id: roster.roster_id,
    name: leagueTeamName(league.users, roster.roster_id, roster.owner_id),
    // Never `roster.owner_id === managerUserId` unguarded: an orphan roster's
    // owner is null, and a null manager would mark every one of them.
    is_manager: managerUserId !== null && roster.owner_id === managerUserId,
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
 * One forced board, named. The route resolves a column's `auto` halves against
 * the league and hands the resulting pricing in under the key the card will
 * look its rank up by.
 */
export type KtcVariantPricing = KtcPricing & { key: string };

/**
 * What one forced board prices each roster's picks at.
 *
 * **Off the grid already laid, never a second one.** A market changes what a
 * pick is worth and nothing about which cell it is or which slot it falls on,
 * so this re-prices the cells `leaguePickBoard` resolved once rather than
 * calling it again per variant — which would be the second reconstruction of a
 * draft order that `draft-picks` is arranged to avoid, and the one way a forced
 * board's `ktc_picks` could come to disagree with the pills on the card.
 */
function variantPickValues(
  board: LeaguePickBoard,
  teams: number,
  ktc: KtcPricing,
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const [rosterId, owned] of board.owned) {
    let sum = 0;
    for (const pick of owned) {
      const cell = board.cells.get(
        pickCellKey(pick.season, pick.round, pick.original_roster_id),
      );
      if (!cell) continue;
      sum += pickValue(ktc, teams, cell) ?? 0;
    }
    totals.set(rosterId, sum);
  }
  return totals;
}

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
