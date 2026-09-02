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

/** `GET /api/user/[username]/lineups` — one solve per league, batched. */
export type ManagerLineupsPayload = {
  season: string;
  /**
   * First week the rest-of-season window covers, or null when no projections
   * were read at all — a past season, or a feed that failed. Every league then
   * orders purely on draft capital, which is the fallback working as designed
   * rather than an error.
   */
  from_week: number | null;
  leagues: Record<string, LeagueLineup>;
};
