import { msInterval, pool } from "@/shared/db";

/**
 * The crawler's queue: every database read and write that decides *what* to
 * crawl next. Deliberately free of policy — batch sizes and freshness windows
 * are passed in by `crawl.ts`, which owns them — so these stay plain queries.
 */

/** Which of the given league ids we already store. */
export async function knownLeagueIds(
  leagueIds: string[],
): Promise<Set<string>> {
  if (leagueIds.length === 0) return new Set();
  const { rows } = await pool.query<{ league_id: string }>(
    `SELECT league_id FROM leagues WHERE league_id = ANY($1::varchar[])`,
    [leagueIds],
  );
  return new Set(rows.map((r) => r.league_id));
}

/** How many stored leagues are past the freshness TTL. */
export async function countDueLeagues(
  season: string,
  ttlMs: number,
): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM leagues
      WHERE season = $1 AND updated_at < now() - $2::interval`,
    [season, msInterval(ttlMs)],
  );
  return Number(rows[0].count);
}

/**
 * Take the next batch of stale leagues, stamping the attempt as we claim them.
 *
 * Claim and stamp are one statement so two ticks (or two instances) can never
 * pick the same leagues, and so a league that fails — or a tick that dies
 * mid-flight — rotates to the back rather than being retried immediately.
 */
export async function claimStaleLeagues(
  season: string,
  ttlMs: number,
  limit: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ league_id: string }>(
    `UPDATE leagues
        SET sync_attempt_at = now()
      WHERE league_id IN (
              SELECT league_id
                FROM leagues
               WHERE season = $1 AND updated_at < now() - $2::interval
               ORDER BY sync_attempt_at ASC NULLS FIRST
               LIMIT $3
            )
      RETURNING league_id`,
    [season, msInterval(ttlMs), limit],
  );
  return rows.map((r) => r.league_id);
}

/** League members due a league-list enumeration, longest-waiting first. */
export async function pendingManagers(
  season: string,
  ttlMs: number,
  limit: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT lu.user_id
       FROM league_users lu
       JOIN leagues l
         ON l.league_id = lu.league_id AND l.season = $1
       LEFT JOIN manager_syncs ms
         ON ms.user_id = lu.user_id AND ms.season = $1
      WHERE NOT coalesce(lu.is_bot, false)
        AND (ms.attempt_at IS NULL OR ms.attempt_at < now() - $2::interval)
      GROUP BY lu.user_id, ms.attempt_at
      ORDER BY ms.attempt_at ASC NULLS FIRST
      LIMIT $3`,
    [season, msInterval(ttlMs), limit],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Record that we enumerated these managers' leagues. Only `attempt_at` moves —
 * `synced_at` means "full graph sync" and stays owned by syncManagerLeagues, so
 * a discovery pass never makes the leagues route serve half-refreshed data as
 * fresh.
 */
export async function stampManagers(
  season: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await pool.query(
    `INSERT INTO manager_syncs (user_id, season, attempt_at)
     SELECT unnest($1::varchar[]), $2::varchar, now()
     ON CONFLICT (user_id, season) DO UPDATE SET attempt_at = now()`,
    [userIds, season],
  );
}
