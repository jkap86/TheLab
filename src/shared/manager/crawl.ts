import { LOCK_KEYS, withAdvisoryLock } from "@/shared/db";
import { DEFAULT_SEASON, getLeague, getUserLeagues } from "@/shared/sleeper";
import type { SleeperLeague } from "@/shared/sleeper";
import { errorMessage, mapWithConcurrency } from "@/shared/util";

import {
  claimStaleLeagues,
  countDueLeagues,
  knownLeagueIds,
  pendingManagers,
  stampManagers,
} from "./crawl-queue";
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

/** What the refresh pass did this tick. */
export type RefreshResult = {
  /** stored leagues re-synced from Sleeper. */
  refreshed: number;
  /** leagues whose refresh failed; rotated to the back of the queue. */
  refreshFailed: number;
  /** leagues Sleeper no longer serves (deleted). Rows are left in place. */
  gone: number;
  /** leagues still past the freshness TTL after this tick. */
  due: number;
};

/** What the discovery pass did this tick. */
export type DiscoveryResult = {
  /** league members whose league list was enumerated. */
  managersCrawled: number;
  /** previously unseen leagues fetched and stored. */
  discovered: number;
  /** discovered leagues whose first sync failed. */
  discoverFailed: number;
  /** managers deferred to the next tick because the discovery cap was hit. */
  deferred: number;
};

export type CrawlSummary = RefreshResult &
  DiscoveryResult & {
    season: string;
    /** true when another tick or instance held the lock and this tick did nothing. */
    locked: boolean;
  };

const NO_REFRESH: RefreshResult = {
  refreshed: 0,
  refreshFailed: 0,
  gone: 0,
  due: 0,
};

const NO_DISCOVERY: DiscoveryResult = {
  managersCrawled: 0,
  discovered: 0,
  discoverFailed: 0,
  deferred: 0,
};

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
): Promise<RefreshResult> {
  const due = await countDueLeagues(season, CRAWL_LEAGUE_TTL_MS);
  const leagueIds = await claimStaleLeagues(season, CRAWL_LEAGUE_TTL_MS, limit);
  if (leagueIds.length === 0) return { ...NO_REFRESH, due };

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
      console.warn(
        `[crawl] failed to fetch league ${leagueId}:`,
        errorMessage(error),
      );
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
): Promise<DiscoveryResult> {
  const userIds = await pendingManagers(season, CRAWL_MANAGER_TTL_MS, limit);
  if (userIds.length === 0) return NO_DISCOVERY;

  const byManager = new Map<string, SleeperLeague[]>();
  let failed = 0;

  await mapWithConcurrency(userIds, CRAWL_CONCURRENCY, async (userId) => {
    try {
      byManager.set(userId, await getUserLeagues(userId, season));
    } catch (error) {
      failed += 1;
      console.warn(
        `[crawl] failed to list leagues for member ${userId}:`,
        errorMessage(error),
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

  // The lock is held for the whole tick so overlapping ticks — and extra app
  // instances, which share one database — don't crawl the same rows twice.
  const summary = await withAdvisoryLock(LOCK_KEYS.leagueCrawl, async () => {
    const currentWeek = await getCurrentWeek();
    const refresh = await refreshStaleLeagues(season, currentWeek, leagueLimit);
    const discovery = await discoverMemberLeagues(
      season,
      currentWeek,
      managerLimit,
      discoveryCap,
    );
    return { season, locked: false, ...refresh, ...discovery };
  });

  return summary ?? { season, locked: true, ...NO_REFRESH, ...NO_DISCOVERY };
}
