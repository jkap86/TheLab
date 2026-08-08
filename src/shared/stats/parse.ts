import type { SleeperProjection } from "@/shared/sleeper";

/**
 * Stat keys Sleeper attaches to every entry in the response, whether or not the
 * player has a line. An entry carrying nothing but these is a placeholder.
 *
 * The same two keys `projections/parse` drops, because it is the same endpoint
 * shape — draft metadata that rides along in `stats` on both sides.
 */
const ADP_KEYS = new Set(["adp_dd_ppr", "pos_adp_dd_ppr"]);

/** A row of the `player_week_stats` table, ready to bind. */
export type StatRow = {
  season: string;
  week: number;
  player_id: string;
  company: string | null;
  team: string | null;
  opponent: string | null;
  game_id: string | null;
  /** `YYYY-MM-DD`, as Sleeper sends it. */
  game_date: string | null;
  pts_std: number | null;
  pts_half_ppr: number | null;
  pts_ppr: number | null;
  stats: Record<string, number>;
  source_updated_at: Date | null;
};

/**
 * Whether an entry is an actual stat line rather than one of the thousands of
 * placeholders in every weekly response.
 *
 * `game_id` is the test, as it is for a projection: a line hangs off a scheduled
 * game and a placeholder has none. The stats check backs it up for the entry
 * Sleeper lists once a game exists and before anything has happened in it —
 * stored, that would be a row of nulls, which reads as "played and scored
 * nothing".
 *
 * **A line that is genuinely all zeroes still passes**, and must: a player who
 * dressed and did nothing carries `gp` (and usually snap counts), so the entry
 * has non-ADP keys and counts as a game played. That is the difference between a
 * zero in a points-per-game denominator and an absence from it, and it is the
 * whole reason this filter tests for *keys* rather than for a non-zero total.
 */
export function hasStatLine(entry: SleeperProjection): boolean {
  if (!entry?.player_id || !entry.game_id) return false;
  const stats = entry.stats;
  if (!stats) return false;
  return Object.keys(stats).some((key) => !ADP_KEYS.has(key));
}

/** A finite number from an untyped stat value, or null. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The storable rows in one week's response.
 *
 * `season`/`week` come from the caller rather than the payload, the rule
 * `toProjectionRows` keeps and for the same reason: the response echoes an
 * unknown week back verbatim instead of erroring, so trusting it files junk
 * under a week that looks real.
 *
 * Deduplicated on player, keeping the most recently revised entry — two entries
 * for one player would collide on the table's primary key mid-statement, which
 * Postgres rejects outright, and losing a week's sync to a duplicate is not a
 * reasonable failure mode. It matters marginally more here than for projections:
 * a stat correction is exactly a revised line for a player already in the
 * response.
 */
export function toStatRows(
  entries: readonly SleeperProjection[],
  season: string,
  week: number,
): StatRow[] {
  const byPlayer = new Map<string, StatRow>();

  for (const entry of entries) {
    if (!hasStatLine(entry)) continue;

    const stats = entry.stats ?? {};
    const lastModified = num(entry.last_modified);
    const row: StatRow = {
      season,
      week,
      player_id: entry.player_id,
      company: entry.company ?? null,
      team: entry.team ?? null,
      opponent: entry.opponent ?? null,
      game_id: entry.game_id ?? null,
      game_date: entry.date ?? null,
      pts_std: num(stats.pts_std),
      pts_half_ppr: num(stats.pts_half_ppr),
      pts_ppr: num(stats.pts_ppr),
      stats,
      source_updated_at: lastModified === null ? null : new Date(lastModified),
    };

    const seen = byPlayer.get(row.player_id);
    if (
      !seen ||
      (row.source_updated_at?.getTime() ?? 0) >=
        (seen.source_updated_at?.getTime() ?? 0)
    ) {
      byPlayer.set(row.player_id, row);
    }
  }

  return [...byPlayer.values()];
}
