import { pool } from "@/shared/db";
import { DEFAULT_SEASON, getLeague, getUserLeagues } from "@/shared/sleeper";
import type { SleeperLeague } from "@/shared/sleeper";
import { mapWithConcurrency } from "@/shared/util";

import { getCurrentWeek, syncLeagueGraphs } from "./sync";

/** Stored leagues re-synced per tick. */
export const CRAWL_LEAGUE_BATCH = 15;

/** League members whose league list is enumerated per tick. */
export const CRAWL_MANAGER_BATCH = 5;

/**
 * Newly discovered leagues fetched per tick, capped separately because a first
 * sync costs far more than a refresh: it backfills every transaction week, so
 * in-season it is ~24 Sleeper requests against a refresh's ~9. Together the two
 * passes stay near 500 requests/minute at their worst, comfortably inside
 * Sleeper's budget while leaving room for real traffic.
 */
export const CRAWL_DISCOVERY_CAP = 15;

/** How long a stored league stays fresh before the crawler re-fetches it. */
export const CRAWL_LEAGUE_TTL_MS = 15 * 60 * 1000;

/**
 * How long a member's league list stays fresh before we look for new leagues.
 * Long, because membership changes rarely and the queue is enormous — every
 * league contributes ~12 members, so never-crawled managers (ordered first)
 * dominate the queue for a long while regardless.
 */
export const CRAWL_MANAGER_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Leagues fetched+persisted at once by the crawler. Lower than the interactive
 * path's concurrency: this runs forever in the background and should leave both
 * Sleeper's rate budget and the pg pool to real requests.
 */
export const CRAWL_CONCURRENCY = 4;

/**
 * Advisory lock guarding a crawl tick. Arbitrary constant, held for the duration
 * of a tick so overlapping ticks — and extra app instances, which share one
 * database — don't crawl the same rows twice.
 */
const CRAWL_LOCK_KEY = [8675309, 1] as const;

const message = (error: unknown) =>
  error instanceof Error ? error.message : error;

const seconds = (ms: number) => `${Math.round(ms / 1000)} seconds`;

export type CrawlSummary = {
  season: string;
  /** true when another tick or instance held the lock and this tick did nothing. */
  locked: boolean;
  /** stored leagues re-synced from Sleeper. */
  refreshed: number;
  /** leagues whose refresh failed; rotated to the back of the queue. */
  refreshFailed: number;
  /** leagues Sleeper no longer serves (deleted). Rows are left in place. */
  gone: number;
  /** leagues still past the freshness TTL after this tick. */
  due: number;
  /** league members whose league list was enumerated. */
  managersCrawled: number;
  /** previously unseen leagues fetched and stored. */
  discovered: number;
  /** discovered leagues whose first sync failed. */
  discoverFailed: number;
  /** managers deferred to the next tick because the discovery cap was hit. */
  deferred: number;
};

/** Which of the given league ids we already store. */
async function knownLeagueIds(leagueIds: string[]): Promise<Set<string>> {
  if (leagueIds.length === 0) return new Set();
  const { rows } = await pool.query<{ league_id: string }>(
    `SELECT league_id FROM leagues WHERE league_id = ANY($1::varchar[])`,
    [leagueIds],
  );
  return new Set(rows.map((r) => r.league_id));
}

/** How many stored leagues are past the freshness TTL. */
async function countDueLeagues(season: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM leagues
      WHERE season = $1 AND updated_at < now() - $2::interval`,
    [season, seconds(CRAWL_LEAGUE_TTL_MS)],
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
async function claimStaleLeagues(
  season: string,
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
    [season, seconds(CRAWL_LEAGUE_TTL_MS), limit],
  );
  return rows.map((r) => r.league_id);
}

/**
 * Re-sync the stalest stored leagues — the same fetch+persist the leagues route
 * runs when someone searches a username, just driven off the league table rather
 * than off one manager.
 *
 * The league itself is re-read from Sleeper (not replayed from our row) because
 * name, status, settings and scoring drift, and the persisted league row comes
 * from that payload.
 */
async function refreshStaleLeagues(
  season: string,
  currentWeek: number,
  limit: number,
): Promise<Pick<CrawlSummary, "refreshed" | "refreshFailed" | "gone" | "due">> {
  const due = await countDueLeagues(season);
  const leagueIds = await claimStaleLeagues(season, limit);
  if (leagueIds.length === 0) {
    return { refreshed: 0, refreshFailed: 0, gone: 0, due };
  }

  const leagues: SleeperLeague[] = [];
  let gone = 0;
  let failed = 0;

  await mapWithConcurrency(leagueIds, CRAWL_CONCURRENCY, async (leagueId) => {
    try {
      const league = await getLeague(leagueId);
      if (league) leagues.push(league);
      else gone += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[crawl] failed to fetch league ${leagueId}:`, message(error));
    }
  });

  const result = await syncLeagueGraphs(leagues, currentWeek, {
    concurrency: CRAWL_CONCURRENCY,
  });

  return {
    refreshed: result.loaded,
    refreshFailed: failed + result.failed,
    gone,
    // The batch we just claimed no longer counts as due unless it failed.
    due: Math.max(due - result.loaded, 0),
  };
}

/** League members due a league-list enumeration, longest-waiting first. */
async function pendingManagers(
  season: string,
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
    [season, seconds(CRAWL_MANAGER_TTL_MS), limit],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Record that we enumerated these managers' leagues. Only `attempt_at` moves —
 * `synced_at` means "full graph sync" and stays owned by syncManagerLeagues, so
 * a discovery pass never makes the leagues route serve half-refreshed data as
 * fresh.
 */
async function stampManagers(season: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await pool.query(
    `INSERT INTO manager_syncs (user_id, season, attempt_at)
     SELECT unnest($1::varchar[]), $2::varchar, now()
     ON CONFLICT (user_id, season) DO UPDATE SET attempt_at = now()`,
    [userIds, season],
  );
}

/**
 * Walk league members and pull in leagues we have never seen.
 *
 * This is what grows the corpus: every league sync writes its members to
 * `league_users`, each member's other leagues get discovered here, and those
 * leagues bring in more members. Seeded by the first username someone searches.
 */
async function discoverMemberLeagues(
  season: string,
  currentWeek: number,
  limit: number,
  cap: number,
): Promise<
  Pick<
    CrawlSummary,
    "managersCrawled" | "discovered" | "discoverFailed" | "deferred"
  >
> {
  const userIds = await pendingManagers(season, limit);
  if (userIds.length === 0) {
    return { managersCrawled: 0, discovered: 0, discoverFailed: 0, deferred: 0 };
  }

  const byManager = new Map<string, SleeperLeague[]>();
  let failed = 0;

  await mapWithConcurrency(userIds, CRAWL_CONCURRENCY, async (userId) => {
    try {
      byManager.set(userId, await getUserLeagues(userId, season));
    } catch (error) {
      failed += 1;
      console.warn(
        `[crawl] failed to list leagues for member ${userId}:`,
        message(error),
      );
    }
  });

  const known = await knownLeagueIds(
    [...byManager.values()].flat().map((l) => l.league_id),
  );

  // Fill up to the per-tick cap in queue order. A manager is only stamped once
  // every one of their new leagues is in, so whoever doesn't fit comes back next
  // tick with their leagues intact rather than silently losing them for a whole
  // TTL cycle. A manager with more new leagues than the cap fits on their own is
  // taken a capful at a time — the ones stored drop out of `unknown` next tick,
  // so they still converge instead of deadlocking the queue.
  const selected = new Map<string, SleeperLeague>();
  const crawled: string[] = [];

  for (const userId of userIds) {
    const leagues = byManager.get(userId);
    if (!leagues) continue; // enumeration failed — leave unstamped, retry later
    const unknown = leagues.filter(
      (l) => !known.has(l.league_id) && !selected.has(l.league_id),
    );
    if (selected.size + unknown.length > cap) {
      for (const league of unknown.slice(0, cap - selected.size)) {
        selected.set(league.league_id, league);
      }
      break;
    }
    for (const league of unknown) selected.set(league.league_id, league);
    crawled.push(userId);
  }

  const result = await syncLeagueGraphs([...selected.values()], currentWeek, {
    concurrency: CRAWL_CONCURRENCY,
  });
  await stampManagers(season, crawled);

  return {
    managersCrawled: crawled.length,
    discovered: result.loaded,
    discoverFailed: failed + result.failed,
    deferred: userIds.length - crawled.length,
  };
}

/** Run `fn` only if no other tick holds the crawl lock. */
async function withCrawlLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::int, $2::int) AS locked`,
      [...CRAWL_LOCK_KEY],
    );
    if (!rows[0].locked) return null;
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1::int, $2::int)`, [
        ...CRAWL_LOCK_KEY,
      ]);
    }
  } finally {
    client.release();
  }
}

export type CrawlOptions = {
  season?: string;
  /** Stored leagues to refresh this tick. */
  leagueLimit?: number;
  /** League members to enumerate this tick. */
  managerLimit?: number;
  /** Newly discovered leagues to fetch this tick. */
  discoveryCap?: number;
};

/**
 * One tick of the background league crawl:
 *
 *   1. re-sync the stalest stored leagues, and
 *   2. enumerate a few league members' leagues, storing any we've never seen.
 *
 * Both passes are bounded, so the tick's cost is roughly constant no matter how
 * large the corpus gets — it just takes longer to come back around to any one
 * league. Nothing here throws for an individual league or member: failures are
 * counted, the row's attempt is stamped so the queue rotates past it, and it
 * comes around again later.
 */
export async function runLeagueCrawl(
  options: CrawlOptions = {},
): Promise<CrawlSummary> {
  const {
    season = DEFAULT_SEASON,
    leagueLimit = CRAWL_LEAGUE_BATCH,
    managerLimit = CRAWL_MANAGER_BATCH,
    discoveryCap = CRAWL_DISCOVERY_CAP,
  } = options;

  const idle: CrawlSummary = {
    season, locked: false, refreshed: 0, refreshFailed: 0, gone: 0, due: 0,
    managersCrawled: 0, discovered: 0, discoverFailed: 0, deferred: 0,
  };

  const summary = await withCrawlLock(async () => {
    const currentWeek = await getCurrentWeek();
    const refresh = await refreshStaleLeagues(season, currentWeek, leagueLimit);
    const discovery = await discoverMemberLeagues(
      season,
      currentWeek,
      managerLimit,
      discoveryCap,
    );
    return { ...idle, ...refresh, ...discovery };
  });

  return summary ?? { ...idle, locked: true };
}
