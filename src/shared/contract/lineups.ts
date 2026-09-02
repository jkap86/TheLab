/**
 * The lineups answer: each league's roster solved into starters and bench.
 *
 * Types only, like everything in `contract/` — the route builds this on the
 * server and the league cards render it, so it must be importable from a
 * `"use client"` module without dragging `pg` or the solver along.
 */

/** One rostered player, as the lineup solve priced him. */
export type LineupPlayer = {
  player_id: string;
  /** From the projections feed's inlined player; null when the feed doesn't know the id. */
  name: string | null;
  /** Sleeper `fantasy_positions`; empty when unknown, which seats the player nowhere. */
  positions: string[];
  /**
   * Rest-of-season projected points under the league's own scoring. **Null is
   * "no projection", not zero** — a bye-shortened total is a number, an
   * unprojected stash is not, and the fallback below exists for the second.
   */
  points: number | null;
  /**
   * The fallback key: draft capital from `adpValue` over the drafts already
   * synced for this manager's leagues, on the board matching the league's
   * superflex setting. Null when those drafts never priced the player.
   */
  adp_value: number | null;
};

/** One starting slot, filled or empty. */
export type LineupSeat = { slot: string; player: LineupPlayer | null };

export type LeagueLineup = {
  league_id: string;
  /** The optimal starters, in the league's own slot order. */
  starters: LineupSeat[];
  /** Everyone else, best first — same ordering the solver seated by. */
  bench: LineupPlayer[];
  /** Summed rest-of-season points of the seated starters. */
  projected_points: number;
  /**
   * Starting slots this build doesn't recognise, left out of the lineup.
   * Non-empty means the starters shown cover only part of the real lineup.
   */
  unknown_slots: string[];
};

/**
 * The rankable lenses on a solved roster. A type-only union on purpose: the
 * runtime lists live as exhaustive `Record<LineupMetricId, …>`s on each side of
 * the seam — the server's ranks literal, the client's column order — so adding
 * an id here breaks both compiles until it is placed. A value exported from
 * this folder would break the folder's own contract instead.
 */
export type LineupMetricId =
  | "ros_starters"
  | "ros_bench"
  | "capital_total"
  | "capital_bench"
  | "capital_starters";

/**
 * Standard competition rank among the league's stored rosters: tied totals
 * share the better rank and the next distinct total skips ("1, 2, 2, 4").
 * `of` counts the rosters actually ranked — orphan and empty rosters included —
 * not the league's seat count.
 */
export type MetricRank = { rank: number; of: number };

/**
 * Null where the metric is degenerate league-wide — every roster totals zero,
 * which is what no projections (both ROS metrics) or no synced drafts (all
 * three capital metrics) look like. "1st of 12" among all-zero totals would be
 * a claim; the card renders an em dash instead.
 */
export type LineupRanks = Record<LineupMetricId, MetricRank | null>;

/** One league's answer: the manager's own solved lineup, plus their ranks. */
export type LeagueLineupEntry = {
  lineup: LeagueLineup;
  ranks: LineupRanks;
};

/** `GET /api/user/[username]/lineups` — every roster solved, batched. */
export type ManagerLineupsPayload = {
  season: string;
  /**
   * First week the rest-of-season window covers, or null when no projections
   * were read at all — a past season, or a feed that failed. Every league then
   * orders purely on draft capital, which is the fallback working as designed
   * rather than an error.
   */
  from_week: number | null;
  leagues: Record<string, LeagueLineupEntry>;
};
