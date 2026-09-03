/**
 * Folding one week of the projections feed into a board a lineup can be solved
 * against.
 *
 * The single-week lens, where `./ros` is the span lens. It exists rather than
 * reusing that fold because a *week* needs three fields a rest-of-season total
 * has no use for and `assembleRosProjections` therefore drops: `team`, to join
 * a player to his game's kickoff; `date`, to date the day-lock fallback; and
 * `game_id`, which is the feed's own flag for whether a row is a projection at
 * all. The judgements the two folds share live in `./identity`, so they cannot
 * come to different conclusions about the same response.
 *
 * **The one place they deliberately differ is the no-game row.** `./ros` drops
 * it, because its `stats` are ADP placeholders and summing them into a season
 * total is nonsense. This keeps it, with a null `stats`, because a week solve
 * needs the player in the candidate pool: he scores a real zero, and dropping
 * him from a lineup he is actually starting would *overstate* what that lineup
 * projects — which is the number the whole tool is about.
 *
 * Pure and free of runtime imports beyond `./identity`, so it tests without a
 * fetch.
 */

import { isRealProjection, readPlayerIdentity } from "./identity.ts";
import type { SleeperProjection } from "../sleeper/types/sleeper.types.ts";

/** One player's week: who they are, who they play, and what they project. */
export type WeekPlayerProjection = {
  player_id: string;
  /**
   * The week's projected stat line, or **null when the feed published none** —
   * a bye, or a player it does not project. Null and an empty object are
   * different answers: the second would score zero through the league's
   * settings, which is also what null does, but only null can be reported as
   * "no projection" rather than as a projection of nothing.
   */
  stats: Record<string, number> | null;
  name: string | null;
  /** Sleeper `fantasy_positions`; empty seats the player nowhere. */
  positions: string[];
  /**
   * His NFL team, for joining to a kickoff. Null is "not known", never a guess
   * — the ordering answers an unknown team by holding the seat.
   */
  team: string | null;
  /** Game day as `YYYY-MM-DD`; null when he has no game this week. */
  game_date: string | null;
};

/** Player id → their week, for every id the feed mentioned. */
export type WeekProjections = Record<string, WeekPlayerProjection>;

/**
 * Fold one week's response into a board.
 *
 * Two reads happen per row and they differ in strictness, exactly as the span
 * fold's do:
 *
 * - **Stats, team and date count only from a real projection.** A no-game row
 *   carries ADP placeholders and no opponent, so believing its `stats` would
 *   price a bye week and believing its `team` is not possible — the feed leaves
 *   it null there anyway.
 * - **Identity is taken from any row at all.** A player the feed knows but
 *   projects nothing for still has a name and positions, and without positions
 *   he is eligible for no slot and cannot be seated even on the bench.
 *
 * A player listed twice keeps the projected row: the first real projection
 * wins, and a later no-game row can only ever fill in an identity that was
 * still blank. Sleeper does not do this, but the fold is order-independent
 * either way, which is what keeps the board a fact about the response rather
 * than about the order it arrived in.
 */
export function assembleWeekProjections(
  rows: readonly SleeperProjection[],
): WeekProjections {
  const board: WeekProjections = {};

  for (const row of rows) {
    const id = row?.player_id;
    if (typeof id !== "string" || id === "") continue;

    const held = board[id];
    const real = isRealProjection(row);

    if (!held) {
      const { name, positions } = readPlayerIdentity(row.player);
      board[id] = {
        player_id: id,
        stats: real ? row.stats : null,
        name,
        positions,
        team: real ? (row.team ?? null) : null,
        game_date: real ? (row.date ?? null) : null,
      };
      continue;
    }

    // A second row for one player. Only a real projection may overwrite the
    // week's facts, and only a blank identity may be filled in — so neither a
    // repeated no-game row nor a repeated projection can degrade what is held.
    if (real && held.stats === null) {
      held.stats = row.stats;
      held.team = row.team ?? null;
      held.game_date = row.date ?? null;
    }
    if (held.name === null && held.positions.length === 0) {
      const { name, positions } = readPlayerIdentity(row.player);
      held.name = name;
      held.positions = positions;
    }
  }

  return board;
}

/**
 * The players whose game *day* has passed — the fallback half of the lock, and
 * the whole of it where the schedule could not be read.
 *
 * `today` is an Eastern date (`util/easternDate`) and the comparison is on the
 * strings, which works and is *why* the dates are kept as `YYYY-MM-DD`: ISO
 * dates sort lexicographically, so no parsing — and no time zone — enters into
 * it a second time.
 *
 * Strictly *before* today: a game played earlier today is still today, and
 * settling it here would lock a Sunday-morning roster before a single ball was
 * snapped. Within the day it is the schedule's kickoff instants that answer
 * (see `./locks`), and this is only ever their floor.
 */
export function dayLockedPlayers(
  board: WeekProjections,
  today: string,
): Set<string> {
  const locked = new Set<string>();
  for (const player of Object.values(board)) {
    if (player.game_date !== null && player.game_date < today) {
      locked.add(player.player_id);
    }
  }
  return locked;
}
