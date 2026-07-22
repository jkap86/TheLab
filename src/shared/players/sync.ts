import { pool } from "@/shared/db";
import { getAllPlayers } from "@/shared/sleeper";

/** How long the cached players map stays fresh (Sleeper: refresh once/day). */
export const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;

/** Rows per INSERT statement (10 params each; well under Postgres' limit). */
const CHUNK = 500;

const j = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

export type PlayersSyncSummary = { skipped: boolean; count: number };

async function playersAreFresh(): Promise<boolean> {
  const { rows } = await pool.query<{ max: Date | null }>(
    `SELECT max(updated_at) AS max FROM players`,
  );
  const max = rows[0]?.max;
  return max != null && Date.now() - max.getTime() < PLAYERS_TTL_MS;
}

/**
 * Refresh the cached Sleeper players map. Skips the (large) download when the
 * cache is still fresh unless `force` is set. Upserts in chunks inside one
 * transaction.
 */
export async function syncPlayers(
  options: { force?: boolean } = {},
): Promise<PlayersSyncSummary> {
  if (!options.force && (await playersAreFresh())) {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM players`,
    );
    return { skipped: true, count: Number(rows[0].count) };
  }

  const map = await getAllPlayers();
  const entries = Object.entries(map);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const valuesSql = chunk
        .map((_, r) => {
          const b = r * 10;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10}, now())`;
        })
        .join(",");
      const params: unknown[] = [];
      for (const [id, p] of chunk) {
        params.push(
          id,
          p.first_name ?? null,
          p.last_name ?? null,
          p.full_name ?? null,
          p.position ?? null,
          p.team ?? null,
          j(p.fantasy_positions),
          p.status ?? null,
          p.sport ?? null,
          j(p),
        );
      }
      await client.query(
        `INSERT INTO players (player_id, first_name, last_name, full_name,
            position, team, fantasy_positions, status, sport, data, updated_at)
         VALUES ${valuesSql}
         ON CONFLICT (player_id) DO UPDATE SET
            first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
            full_name = EXCLUDED.full_name, position = EXCLUDED.position,
            team = EXCLUDED.team, fantasy_positions = EXCLUDED.fantasy_positions,
            status = EXCLUDED.status, sport = EXCLUDED.sport,
            data = EXCLUDED.data, updated_at = now()`,
        params,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { skipped: false, count: entries.length };
}

/** Refresh the players cache if it is stale; a no-op when fresh. */
export async function ensurePlayersFresh(): Promise<void> {
  await syncPlayers();
}
