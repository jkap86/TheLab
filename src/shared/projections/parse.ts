import type { SleeperProjection } from "@/shared/sleeper";

/**
 * Stat keys Sleeper attaches to every entry in the response, whether or not the
 * player has a projection. An entry carrying nothing but these is a placeholder.
 */
const ADP_KEYS = new Set(["adp_dd_ppr", "pos_adp_dd_ppr"]);

/** A row of the `projections` table, ready to bind. */
export type ProjectionRow = {
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
 * Whether an entry is an actual projection rather than one of the ~8,500
 * placeholders in every weekly response.
 *
 * `game_id` is the test: a projection is always tied to a scheduled game, and
 * placeholders have none. The stats check backs it up for the case where Sleeper
 * lists a game before the projection behind it exists — such an entry would
 * otherwise be stored as a row of nulls, which reads as "projected zero".
 */
export function hasProjection(entry: SleeperProjection): boolean {
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
 * `season`/`week` come from the caller, not the payload: they are what was asked
 * for, and the response echoes an unknown week back verbatim rather than
 * erroring, so trusting it would file junk under a week that looks real.
 *
 * Deduplicated on player, keeping the most recently revised entry. Every response
 * observed so far carries one entry per player (all from the same provider), but
 * two would collide on the table's primary key mid-statement, which Postgres
 * rejects outright — losing a whole week's sync to a duplicate isn't a reasonable
 * failure mode.
 */
export function toProjectionRows(
  entries: readonly SleeperProjection[],
  season: string,
  week: number,
): ProjectionRow[] {
  const byPlayer = new Map<string, ProjectionRow>();

  for (const entry of entries) {
    if (!hasProjection(entry)) continue;

    const stats = entry.stats ?? {};
    const lastModified = num(entry.last_modified);
    const row: ProjectionRow = {
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
