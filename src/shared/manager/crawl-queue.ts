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

/** The refresh queue's shape this tick, measured before anything is claimed. */
export type LeagueQueueStats = {
  /** stored, non-gone leagues this season. */
  corpus: number;
  /** of those, how many are past the freshness TTL. */
  due: number;
  /** age of the stalest league, due or not. */
  oldestAgeMs: number;
};

/**
 * One aggregate over the season's non-gone leagues: the corpus, how many are
 * due, and the stalest age. The age spans the whole slice rather than just the
 * due ones — `updated_at` is NOT NULL, so when anything is due the minimum *is*
 * the oldest due league, and when nothing is it sits under the TTL, where the
 * scheduler's missed-target warning can't fire. One number serves the heartbeat
 * and the warning.
 */
export async function leagueQueueStats(
  season: string,
  ttlMs: number,
): Promise<LeagueQueueStats> {
  const { rows } = await pool.query<{
    corpus: string;
    due: string;
    oldest_age_ms: string;
  }>(
    `SELECT count(*)::text AS corpus,
            (count(*) FILTER (WHERE updated_at < now() - $2::interval))::text AS due,
            coalesce((extract(epoch FROM now() - min(updated_at)) * 1000)::bigint, 0)::text AS oldest_age_ms
       FROM leagues
      WHERE season = $1 AND gone_at IS NULL`,
    [season, msInterval(ttlMs)],
  );
  return {
    corpus: Number(rows[0].corpus),
    due: Number(rows[0].due),
    oldestAgeMs: Number(rows[0].oldest_age_ms),
  };
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
                 AND gone_at IS NULL
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
 * Tombstone leagues Sleeper no longer serves, so the refresh queue stops
 * claiming them: an unmarked deleted league is due forever — its `updated_at`
 * never advances — and permanently burns a claim slot plus a Sleeper request
 * per rotation. The rows stay (their drafts still feed ADP), and the marker is
 * cleared by `persistLeagueGraph` if a manager-driven sync finds the league
 * alive again.
 */
export async function markLeaguesGone(leagueIds: string[]): Promise<void> {
  if (leagueIds.length === 0) return;
  await pool.query(
    `UPDATE leagues SET gone_at = now() WHERE league_id = ANY($1::varchar[])`,
    [leagueIds],
  );
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
