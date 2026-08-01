import type { ProjectionRow } from "./parse";

/**
 * Whether a week's parsed projections are complete enough to replace the stored
 * week with.
 *
 * `writeWeek` upserts and then **deletes every stored row for the week that the
 * payload omits** — which is right, because a player Sleeper drops from the
 * slate would otherwise keep a projection that still reads as live. It is also
 * the statement that turns a partial response into a wiped week: the only guard
 * was `rows.length === 0`, so a truncated body carrying 40 real projections
 * deleted the other ~760 and stamped the week fresh, leaving every lineup tool
 * reading a week that looks synced and is nearly empty.
 *
 * Same shape and same reasoning as `ktc/validate`: judge the payload before the
 * destructive transaction opens, refuse rather than half-write, and say why.
 * Pure and tested.
 */

/**
 * Fewest rows a week must carry to be treated as a full slate.
 *
 * A real week is ~800 real projections out of ~9,400 entries (the rest are
 * placeholders `parse` already drops). Well under that, because a genuinely
 * light week — a payload published mid-week, a season Sleeper is still filling
 * in — should still store; this is the floor that catches a fragment, and the
 * shrink check is what catches a response that is merely short.
 *
 * A week with *zero* rows never reaches here: the sync treats it as "not
 * published yet", which is a real answer and a different one.
 */
export const PROJECTIONS_MIN_ROWS = 200;

/**
 * How far below the stored count for the same `(season, week)` a payload may
 * fall before it is refused, as a fraction.
 *
 * Byes are the legitimate swing: six teams idle is ~19% of the league's players
 * absent from that week's slate, so the threshold has to clear that with room.
 * 40% does, and still catches a response missing most of the board.
 */
export const PROJECTIONS_MAX_SHRINK = 0.4;

export type ProjectionsValidation =
  | { ok: true; rows: ProjectionRow[]; rejected: number; previous: number }
  | {
      ok: false;
      reason: string;
      valid: number;
      rejected: number;
      previous: number;
    };

/** A storable row: a player, the game it hangs off, and a stat line. */
function isValid(row: ProjectionRow): boolean {
  if (typeof row?.player_id !== "string" || row.player_id.trim() === "") {
    return false;
  }
  if (typeof row.game_id !== "string" || row.game_id.trim() === "") return false;
  if (!row.stats || typeof row.stats !== "object") return false;
  return Object.keys(row.stats).length > 0;
}

/**
 * Validate one week's rows against what is already stored for that week.
 *
 * `previous` is the stored row count for the same `(season, week)`. **Zero means
 * first sync of that week** — nothing to shrink against, so only the floor
 * applies, which is what lets a cold database fill a season without the guard
 * having to be disabled.
 */
export function validateWeekProjections(
  rows: readonly ProjectionRow[],
  previous: number,
): ProjectionsValidation {
  const valid = rows.filter(isValid);

  const byPlayer = new Map<string, ProjectionRow>();
  for (const row of valid) byPlayer.set(row.player_id, row);

  const unique = [...byPlayer.values()];
  const duplicates = valid.length - unique.length;
  const rejected = rows.length - unique.length;

  // `toProjectionRows` already deduplicates, so a duplicate here means the rows
  // came from somewhere else or that invariant broke — either way the count is
  // not what it looks like and the week should not be replaced from it.
  if (duplicates > 0) {
    return {
      ok: false,
      reason: `${duplicates} duplicate player id(s) in ${valid.length} valid row(s)`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  if (unique.length < PROJECTIONS_MIN_ROWS) {
    return {
      ok: false,
      reason: `only ${unique.length} valid row(s), below the ${PROJECTIONS_MIN_ROWS} minimum`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  if (previous > 0 && unique.length < previous * (1 - PROJECTIONS_MAX_SHRINK)) {
    return {
      ok: false,
      reason:
        `${unique.length} valid row(s) is more than ` +
        `${Math.round(PROJECTIONS_MAX_SHRINK * 100)}% below the ${previous} stored`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  return { ok: true, rows: unique, rejected, previous };
}
