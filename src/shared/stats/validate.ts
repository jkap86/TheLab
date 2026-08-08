import type { StatRow } from "./parse";

/**
 * Whether a week's parsed stat lines are complete enough to replace the stored
 * week with.
 *
 * The same gate `projections/validate` is, for the same reason — `writeWeek`
 * upserts and then deletes every stored row the payload omits, so a truncated
 * response is one statement away from emptying a week that reads as synced —
 * and it differs in one thing that matters, which is the whole of this file's
 * argument.
 *
 * **A stats week fills in over five days; a projections week is published at
 * once.** So the absolute floor cannot apply the same way: on Thursday night a
 * completed-and-correct week 5 holds one game, ~60 lines, and a floor written
 * for a finished Sunday would refuse it every tick until Monday — the sync would
 * store nothing for the live week all weekend, which is precisely the week a
 * lineup screen is being read against. The floor is therefore asked of *settled*
 * weeks only, and the shrink check carries the live ones.
 *
 * That split is safe because rows never legitimately disappear from a week in
 * progress: a played game's lines stay played. So a live week only ever grows,
 * and any fall against what is stored is a bad response rather than the week
 * moving.
 *
 * Pure and tested.
 */

/**
 * Fewest rows a **settled** week must carry to be treated as a full slate.
 *
 * A finished NFL week is ~500–900 stat lines (every active player on 28–32
 * teams, IDP included). Well under that, because a bye-heavy week is genuinely
 * lighter and a season Sleeper is still correcting should still store; this is
 * the floor that catches a fragment, and the shrink check is what catches a
 * response that is merely short.
 *
 * A week with *zero* rows never reaches here: the sync treats that as "not
 * played yet", which is a real answer and a different one.
 */
export const STATS_MIN_SETTLED_ROWS = 200;

/**
 * How far below the stored count for the same `(season, week)` a payload may
 * fall before it is refused, as a fraction.
 *
 * Tighter than the projections gate's 40%, and it can afford to be: that one has
 * to clear a bye week's ~19% swing, because a projections payload legitimately
 * *loses* the six idle teams. A stat line for a game already played is never
 * withdrawn — a correction revises it — so the only honest movement here is
 * upward, and 25% is slack for the handful of lines a correction pass can drop
 * (a player credited in error) rather than room for a week to change shape.
 */
export const STATS_MAX_SHRINK = 0.25;

export type StatsValidation =
  | { ok: true; rows: StatRow[]; rejected: number; previous: number }
  | {
      ok: false;
      reason: string;
      valid: number;
      rejected: number;
      previous: number;
    };

/** A storable row: a player, the game it hangs off, and a stat line. */
function isValid(row: StatRow): boolean {
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
 * applies, which is what lets a cold database backfill a season without the
 * guard being disabled.
 *
 * `settled` says whether the week's games are all behind us. A live week is
 * exempt from the floor and nothing else; see this module's own note for why
 * that exemption is the difference between this gate and the projections one.
 */
export function validateWeekStats(
  rows: readonly StatRow[],
  previous: number,
  { settled }: { settled: boolean },
): StatsValidation {
  const valid = rows.filter(isValid);

  const byPlayer = new Map<string, StatRow>();
  for (const row of valid) byPlayer.set(row.player_id, row);

  const unique = [...byPlayer.values()];
  const duplicates = valid.length - unique.length;
  const rejected = rows.length - unique.length;

  // `toStatRows` already deduplicates, so a duplicate here means the rows came
  // from somewhere else or that invariant broke — either way the count is not
  // what it looks like and the week should not be replaced from it.
  if (duplicates > 0) {
    return {
      ok: false,
      reason: `${duplicates} duplicate player id(s) in ${valid.length} valid row(s)`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  if (settled && unique.length < STATS_MIN_SETTLED_ROWS) {
    return {
      ok: false,
      reason:
        `only ${unique.length} valid row(s) for a completed week, ` +
        `below the ${STATS_MIN_SETTLED_ROWS} minimum`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  if (previous > 0 && unique.length < previous * (1 - STATS_MAX_SHRINK)) {
    return {
      ok: false,
      reason:
        `${unique.length} valid row(s) is more than ` +
        `${Math.round(STATS_MAX_SHRINK * 100)}% below the ${previous} stored`,
      valid: unique.length,
      rejected,
      previous,
    };
  }

  return { ok: true, rows: unique, rejected, previous };
}
