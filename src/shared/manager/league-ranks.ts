/**
 * Ranking a manager's roster against the rest of their league.
 *
 * Pure, on the same terms as `./ros-lineups`: the caller supplies the league's
 * stored rosters, the projections board and the ADP map, and the ranking tests
 * without a database or a fetch. Runtime imports are relative with `.ts` for
 * the usual reason.
 *
 * **One solve per roster is the whole design.** `solveLeagueLineup` already
 * prices every player's points *and* draft capital onto the lineup it returns,
 * so all five metrics fall out of the solves the rank needs anyway — there is
 * no second valuation pass to drift from the first. The other rosters' lineups
 * are discarded after their totals are read: the payload carries the manager's
 * seats and everyone else's rank, never eleven strangers' rosters.
 *
 * **A metric ranks null when every roster in the league totals zero on it.**
 * That one rule covers both degenerate cases — no projections read (both ROS
 * metrics zero everywhere) and no synced drafts (all three capital metrics) —
 * because "1st of 12" among all-zero totals is a claim, not an answer. Ties on
 * a real total share the better rank and the next distinct total skips
 * ("1, 2, 2, 4"), so tied managers read the same honest number.
 */

import type {
  LeagueLineup,
  LineupMetricId,
  LineupRanks,
} from "@/shared/contract";

import { round } from "../projections/optimal.ts";
import type { RosProjections } from "../projections/ros.ts";
import { solveLeagueLineup } from "./ros-lineups.ts";
import type { RosLineupLeague } from "./ros-lineups.ts";

/** One stored roster, as `getManagerLeagueRosters` returns it. */
export type LeagueRosterRow = {
  roster_id: number;
  /** Null on orphan teams — commissioner-held, or an owner who left. */
  owner_id: string | null;
  players: readonly string[];
};

/** What one league contributes to the ranking — a row of `getManagerLeagueRosters`. */
export type RankLeague = {
  league_id: string;
  total_rosters: number;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  /** Every stored roster in the league, the manager's among them. */
  rosters: readonly LeagueRosterRow[];
};

/**
 * All five metric totals off one solved lineup. Exported for the tests: the
 * sums here are what the ranks compare, so their edge rules — null points and
 * null capital both count zero, the ROS bench re-rounds the way the starters
 * total already is — are pinned where they live.
 */
export function lineupMetricTotals(
  lineup: LeagueLineup,
): Record<LineupMetricId, number> {
  const starterCapital = lineup.starters.reduce(
    (sum, seat) => sum + (seat.player?.adp_value ?? 0),
    0,
  );
  const benchCapital = lineup.bench.reduce(
    (sum, player) => sum + (player.adp_value ?? 0),
    0,
  );
  return {
    ros_starters: lineup.projected_points,
    ros_bench: round(
      lineup.bench.reduce((sum, player) => sum + (player.points ?? 0), 0),
    ),
    capital_total: starterCapital + benchCapital,
    capital_bench: benchCapital,
    capital_starters: starterCapital,
  };
}

/**
 * Solve every roster in the league and rank the manager's on each metric.
 *
 * The manager is found by `owner_id` (first by the caller's roster order, in
 * the unlikely case Sleeper hands back two — co-ownership lives in `metadata`,
 * not here). A league holding no roster of theirs returns a null lineup and
 * all-null ranks; the query already filters those out, so hitting it means the
 * store moved between reads, and the route omits the league the way it always
 * has.
 */
export function rankLeagueLineups(
  league: RankLeague,
  managerUserId: string,
  projections: RosProjections,
  adp: ReadonlyMap<string, number>,
): { lineup: LeagueLineup | null; ranks: LineupRanks } {
  const solved = league.rosters.map((roster) => {
    const one: RosLineupLeague = {
      league_id: league.league_id,
      total_rosters: league.total_rosters,
      roster_positions: league.roster_positions,
      scoring_settings: league.scoring_settings,
      players: roster.players,
    };
    const lineup = solveLeagueLineup(one, projections, adp);
    return { roster, lineup, totals: lineupMetricTotals(lineup) };
  });

  const manager = solved.find(
    ({ roster }) => roster.owner_id === managerUserId,
  );
  if (!manager) {
    return {
      lineup: null,
      ranks: {
        ros_starters: null,
        ros_bench: null,
        capital_total: null,
        capital_bench: null,
        capital_starters: null,
      },
    };
  }

  const rankOn = (metric: LineupMetricId) => {
    const mine = manager.totals[metric];
    let ahead = 0;
    let anyNonZero = false;
    for (const { totals } of solved) {
      const total = totals[metric];
      if (total !== 0) anyNonZero = true;
      if (total > mine) ahead += 1;
    }
    // Every roster at zero is the metric having nothing to say, not a tie for
    // first — see the module note.
    if (!anyNonZero) return null;
    return { rank: ahead + 1, of: solved.length };
  };

  return {
    lineup: manager.lineup,
    ranks: {
      ros_starters: rankOn("ros_starters"),
      ros_bench: rankOn("ros_bench"),
      capital_total: rankOn("capital_total"),
      capital_bench: rankOn("capital_bench"),
      capital_starters: rankOn("capital_starters"),
    },
  };
}
