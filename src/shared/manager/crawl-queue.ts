import { msInterval, pool } from "@/shared/db";

import {
  DEMAND_WINDOW_MS,
  staleLeagueClaimSql,
  starvationMs,
} from "./crawl-priority";
import { NEVER_REFRESHED_SQL } from "./sync-freshness";

/*
 * The crawler's queue: every database read and write that decides *what* to
 * crawl next. Deliberately free of policy — batch sizes and freshness windows
 * are passed in by `crawl.ts`, which owns them — so these stay plain queries.
 *
 * The three stamps at the bottom are older than the rest of the file: they were
 * ported ahead of the crawler because the manager sync calls all of them
 * already, and this header used to say the reading half "extends this file
 * instead of relocating what it finds here". It has, and it did.
 *
 * **There is no queue table.** The queue is `leagues` for the refresh pass and
 * `league_users` ⋈ `manager_syncs` for discovery, which is the design rather
 * than a shortcut: a separate table would be a second claim on when a league
 * was last read, and the two would disagree the first time a manager-driven
 * sync wrote one and not the other.
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
 *
 * **The age excludes leagues that have never been refreshed at all.** They carry
 * {@link NEVER_REFRESHED_SQL} rather than a real timestamp, so counting them
 * would put the stalest age at fifty-six years and fire the missed-target
 * warning on every tick forever — a caveat that fires on everything, hiding the
 * one case it exists to catch. What that warning reads is whether the batch is
 * keeping up with the corpus, and a league with no graph yet is not evidence
 * about that either way. They stay in `corpus` and in `due`, which are the two
 * numbers they *are* evidence about.
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
            coalesce((extract(epoch FROM now() -
                       (min(updated_at)
                          FILTER (WHERE updated_at > ${NEVER_REFRESHED_SQL}))
                     ) * 1000)::bigint, 0)::text AS oldest_age_ms
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
 *
 * **Two conditions on the same interval, and they are two different
 * questions.** `updated_at` says whether work is needed; `sync_attempt_at` says
 * how often it may be asked for. A healthy league claimed at T and refreshed at
 * T carries both at T and turns over together; a league that cannot sync stops
 * occupying a slot every minute. Collapsing them is how a failing upstream
 * turns every tick into the same doomed batch.
 *
 * The ordering is `./crawl-priority`'s — demand, then liveness, then how long
 * the crawler has been away — with a starvation bound so a cold league cannot
 * be deferred forever by a database that always has something hot in it.
 */
export async function claimStaleLeagues(
  season: string,
  ttlMs: number,
  limit: number,
): Promise<string[]> {
  const { rows } = await pool.query<{ league_id: string }>(
    staleLeagueClaimSql(),
    [
      season,
      msInterval(ttlMs),
      msInterval(starvationMs(ttlMs)),
      msInterval(DEMAND_WINDOW_MS),
      limit,
    ],
  );
  return rows.map((r) => r.league_id);
}

/**
 * League members due a league-list enumeration, longest-waiting first.
 *
 * **This is the discovery queue, and it is a join rather than a table.**
 * `league_users` is the membership mirror every league sync already writes, so
 * it is the frontier for free: every league the crawler refreshes names its
 * members, and a member with no `manager_syncs` row has never been enumerated.
 * `attempt_at ASC NULLS FIRST` puts those never-tried managers first and rotates
 * everyone else by how long they have waited.
 *
 * `is_bot` is excluded because Sleeper's bots hold rosters and have no league
 * list to enumerate — asking costs a request per tick to be told nothing.
 * `NOT coalesce(..., false)` rather than `= false`: the column is nullable and a
 * null there means Sleeper did not say, which is not a claim that they are one.
 */
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
 * Record that somebody actually asked for these leagues.
 *
 * The crawler's one demand signal, and it is stamped only where demand is
 * *observed*: a manager's league sync means someone searched them. The crawler
 * deliberately does not stamp what it refreshes — within one rotation every
 * league would look demanded, which flattens the ordering back to the
 * round-robin it replaces.
 *
 * Best-effort by design: it is a scheduling hint, so a caller fires it off and
 * does not wait on it, and a failure costs a league its place in a queue rather
 * than costing the request its answer.
 */
export async function markLeaguesAccessed(
  leagueIds: readonly string[],
): Promise<void> {
  if (leagueIds.length === 0) return;
  await pool.query(
    `UPDATE leagues SET last_accessed_at = now()
      WHERE league_id = ANY($1::varchar[])`,
    [leagueIds],
  );
}

/**
 * Record that somebody tried to sync these leagues, whatever came of it.
 *
 * {@link claimStaleLeagues} does this as part of claiming, in one statement, so
 * two ticks cannot pick the same batch. This is the same stamp for the caller
 * that needs no claim: a manager's sync probing the leagues that left their
 * enumeration already holds that manager's advisory lock, and two managers
 * sharing a league both probing it costs one duplicate request rather than a
 * double write.
 *
 * Stamped **before** the fetch: a probe that fails or is refused must still
 * rotate its league to the back of the queue, or the same handful hold the head
 * of it on every sync and the rest are never reached.
 */
export async function stampLeagueSyncAttempts(
  leagueIds: readonly string[],
): Promise<void> {
  if (leagueIds.length === 0) return;
  await pool.query(
    `UPDATE leagues SET sync_attempt_at = now()
      WHERE league_id = ANY($1::varchar[])`,
    [[...leagueIds]],
  );
}

/**
 * Tombstone leagues Sleeper no longer serves, so the refresh queue stops
 * claiming them: an unmarked deleted league is due forever — its `updated_at`
 * never advances — and would permanently burn a claim slot plus a Sleeper
 * request per rotation. The rows stay, and the marker is cleared by
 * `persistLeagueGraph` if a later sync finds the league alive again.
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
 * `synced_at` means "full graph sync" and stays owned by `syncManagerLeagues`,
 * so a discovery pass never makes the leagues route serve half-refreshed data
 * as fresh.
 *
 * A bulk `unnest` rather than {@link MANAGER_SYNC_STAMP_SQL} per manager, and
 * the conditional half that constant exists to protect is preserved by a
 * stronger means than copying it: this statement never names `synced_at` at
 * all, so there is no branch for a later edit to flatten.
 *
 * **It does hold the leagues route's retry throttle off Sleeper, though**, which
 * is a consequence worth knowing: `managerSyncGate` reads `attempt_at` to decide
 * how soon a manager may be re-fetched, so a manager stamped here is suppressed
 * for `SYNC_ATTEMPT_TTL_MS` even if their leagues are past `SYNC_TTL_MS`. That
 * is the right reading rather than an accident — a stamp here means Sleeper was
 * asked about this manager minutes ago and everything newly attributable to them
 * synced — and it is bounded: a manager is enumerated at most once per
 * `CRAWL_MANAGER_TTL_MS`. Their leagues are still reported `stale`, so nothing
 * presents the wait as a completed refresh.
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
