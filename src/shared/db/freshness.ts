import { pool } from "./pool";

/**
 * Table names this module is allowed to interpolate. These land in SQL
 * unparameterised (Postgres can't parameterise an identifier), so the set is
 * closed rather than taking an arbitrary string.
 *
 * One entry for now. `ktc_values` keeps its own freshness read inside
 * `shared/ktc` — that sync judges per format against a stored count and a
 * shrink check, which is more than a max timestamp can say — so widening this
 * to cover it would be a second answer rather than a shared one.
 */
type CachedTable = "players";

/**
 * Whether a cache table was refreshed within `ttlMs`, judged by the newest
 * `updated_at` in it. False for an empty table, so a cold cache always syncs.
 */
export async function isFresh(
  table: CachedTable,
  ttlMs: number,
): Promise<boolean> {
  const { rows } = await pool.query<{ max: Date | null }>(
    `SELECT max(updated_at) AS max FROM ${table}`,
  );
  const max = rows[0]?.max;
  return max != null && Date.now() - max.getTime() < ttlMs;
}

/**
 * Row count for a cache table. Counted as text and converted here because
 * `count(*)` is a bigint, which `pg` returns as a string to avoid overflowing a
 * JS number.
 */
export async function countRows(table: CachedTable): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(rows[0].count);
}
