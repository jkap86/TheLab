/**
 * Folding a span of weekly projection responses into one rest-of-season board.
 *
 * Pure and free of runtime imports beyond `./aggregate` — the caller fetches the
 * weeks (see `./ros-read`) and this decides what they add up to, so the folding
 * rules can be tested without a fetch.
 *
 * Two reads happen per row, and they deliberately differ in strictness:
 *
 * - **Stat lines count only from real projections.** The feed answers every
 *   player in the league, not every player with a game — a bye week or an
 *   unpublished projection arrives as a row with a null `game_id` and ADP
 *   placeholders in `stats` (see `SleeperProjection`). Summing those would fold
 *   draft metadata into a season total.
 * - **Identity is taken from any row at all.** A player the feed knows but
 *   projects nothing for still has a name and positions, and the lineup solve
 *   needs the positions to seat him by the fallback key — an unprojected player
 *   with no known position is eligible for no slot and can only ride the bench.
 */

import { aggregateWeeklyStats } from "./aggregate.ts";
import type { PlayerWeekStats } from "./aggregate.ts";
import type { SleeperProjection } from "../sleeper/types/sleeper.types.ts";

/** One player's summed rest-of-season projection, plus who they are. */
export type RosPlayerProjection = {
  player_id: string;
  /** Stat line summed across `weeks` — score with the league's own settings. */
  stats: Record<string, number>;
  /**
   * Weeks that contributed a real projection, ascending. **Empty means the
   * player has no projection at all** — the state the ADP fallback exists for —
   * where a short list is a bye or a partial horizon and the total still counts.
   */
  weeks: number[];
  name: string | null;
  /** Sleeper `fantasy_positions`; empty when the feed carries none. */
  positions: string[];
};

/** Player id → their rest-of-season line, for every id the feed mentioned. */
export type RosProjections = Record<string, RosPlayerProjection>;

/** One fetched week: which week it was, and every row the feed sent for it. */
export type RosWeek = {
  week: number;
  rows: readonly SleeperProjection[];
};

/**
 * Sum a span of weekly responses into one board.
 *
 * The summation itself is {@link aggregateWeeklyStats} — linear scoring is what
 * makes summing stats before scoring them exact — and this adds only the two
 * per-row judgements documented above: which rows are real projections, and
 * what identity to carry for ids that never have one.
 */
export function assembleRosProjections(
  weeks: readonly RosWeek[],
): RosProjections {
  const identity = new Map<string, { name: string | null; positions: string[] }>();
  const real: PlayerWeekStats[] = [];

  for (const { week, rows } of weeks) {
    for (const row of rows) {
      const id = row?.player_id;
      if (typeof id !== "string" || id === "") continue;

      const known = identity.get(id);
      if (!known || (known.name === null && known.positions.length === 0)) {
        identity.set(id, readIdentity(row.player));
      }

      // A null `game_id` is the feed's spelling of "no game this week"; its
      // `stats` are ADP placeholders, not a projected zero.
      if (row.game_id == null || row.stats == null) continue;
      real.push({ player_id: id, week, stats: row.stats });
    }
  }

  const aggregated = aggregateWeeklyStats(real);

  const board: RosProjections = {};
  for (const [id, { name, positions }] of identity) {
    const line = aggregated[id];
    board[id] = {
      player_id: id,
      stats: line?.stats ?? {},
      weeks: line?.weeks ?? [],
      name,
      positions,
    };
  }
  return board;
}

/**
 * Name and positions off the feed's inlined player object, read defensively —
 * the object is untyped JSON from an undocumented host, and a missing field is
 * an absent fact, never a crash.
 */
function readIdentity(player: Record<string, unknown> | null): {
  name: string | null;
  positions: string[];
} {
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
