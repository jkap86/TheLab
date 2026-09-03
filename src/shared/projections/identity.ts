/**
 * The two judgements every read of Sleeper's projections feed has to make, in
 * one place because there are now two folds making them.
 *
 * `./ros` sums a *span* into a rest-of-season board; `./week` keeps a single
 * week whole, because a week solve needs the `team` and `date` the span fold
 * discards. They differ in what they keep and agree on exactly this: which rows
 * carry a real projection, and how to read a player's identity off one. Two
 * spellings of either would be free to disagree about the same feed — the drift
 * `weekKickoffs` names for its own second pass.
 *
 * Pure and free of runtime imports, so both folds stay resolvable under Node's
 * test runner.
 */

import type { SleeperProjection } from "../sleeper/types/sleeper.types.ts";

/** A player's name and the slots they may be seated in. */
export type PlayerIdentity = { name: string | null; positions: string[] };

/**
 * Whether a row is a real projection rather than the feed's "no game this week".
 *
 * The endpoint answers *every* player in the league, not every player with a
 * game, and a bye or an unpublished projection arrives as a row whose `game_id`
 * is null and whose `stats` hold ADP placeholders rather than a projected zero.
 * `game_id` is the usable signal; summing those rows folds draft metadata into
 * a total.
 *
 * Note this is about the row's *stats* only. Identity is read from any row at
 * all — see {@link readPlayerIdentity} — because an unprojected player still
 * needs positions to be seated anywhere.
 */
export function isRealProjection(
  row: Pick<SleeperProjection, "game_id" | "stats">,
): boolean {
  return row.game_id != null && row.stats != null;
}

/**
 * Name and positions off the feed's inlined player object, read defensively —
 * the object is untyped JSON from an undocumented host, and a missing field is
 * an absent fact, never a crash.
 */
export function readPlayerIdentity(
  player: Record<string, unknown> | null,
): PlayerIdentity {
  if (!player) return { name: null, positions: [] };

  const first = typeof player.first_name === "string" ? player.first_name : "";
  const last = typeof player.last_name === "string" ? player.last_name : "";
  const name = `${first} ${last}`.trim() || null;

  const fantasy = Array.isArray(player.fantasy_positions)
    ? player.fantasy_positions.filter((p): p is string => typeof p === "string")
    : [];
  const positions =
    fantasy.length > 0
      ? fantasy
      : typeof player.position === "string" && player.position !== ""
        ? [player.position]
        : [];

  return { name, positions };
}
