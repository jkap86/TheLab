import { LOCK_KEYS, withAdvisoryLock } from "@/shared/db";
import { getActiveSeason } from "@/shared/season";
import { getLeague, getNflState, getUserLeagues } from "@/shared/sleeper";
import type { SleeperLeague } from "@/shared/sleeper";
import { errorMessage, mapWithConcurrency } from "@/shared/util";

import {
  claimStaleLeagues,
  knownLeagueIds,
  leagueQueueStats,
  markLeaguesGone,
  pendingManagers,
  stampManagers,
} from "./crawl-queue";
import { leagueCrawlTtl, type CrawlTier } from "./crawl-ttl";
import {
  remainingDue,
  selectDiscoveryLeagues,
  stampableManagers,
} from "./discovery";
import { flooredWeek, syncLeagueGraphs } from "./sync";

/**
 * Stored leagues re-synced per tick. This is the crawler's refresh throughput —
 * `batch / interval`, 15 a minute — and with it the corpus each seasonal TTL in
 * `./crawl-ttl` can actually cover. Raise it only on telemetry showing the
 * in-season target missed (the scheduler warns), never preemptively: the budget
 * math on {@link CRAWL_DISCOVERY_CAP} assumes this size.
 */
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
  /**
   * Leagues Sleeper no longer serves (deleted). Rows are left in place — their
   * drafts still feed ADP — but tombstoned out of the refresh queue.
   */
  gone: number;
  /** stored, non-gone leagues this season — what the TTL has to cover. */
  corpus: number;
  /** leagues past the freshness TTL when the tick started. */
  dueBefore: number;
  /**
   * Leagues still past the TTL after this tick: `dueBefore − refreshed − gone`.
   * Tombstoned leagues count as retired because `markLeaguesGone` takes them out
   * of every future claim — leaving them in overstated the backlog the
   * scheduler's missed-target warning reads. See `./discovery`.
   */
  due: number;
  /**
   * Age of the stalest league at tick start. Past twice the TTL it means the
   * batch isn't keeping up with the corpus — the scheduler warns on it.
   */
  oldestAgeMs: number;
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

type CrawlTickBase = RefreshResult &
  DiscoveryResult & {
    season: string;
    /** Wall-clock cost of the tick, lock attempt included. */
    tickMs: number;
  };

/**
 * Discriminated on `locked`, so a tick that lost the lock — and therefore never
 * read Sleeper's state — carries no tier rather than a made-up one, and the
 * scheduler's `if (locked)` guard is also the type guard.
 */
export type CrawlSummary =
  | (CrawlTickBase & {
      locked: false;
      /** Raw `season_type` the TTL was derived from. */
      seasonType: string | null;
      /** Freshness TTL applied to the whole tick — see `./crawl-ttl`. */
      leagueTtlMs: number;
      /** Seasonal tier of that TTL. */
      tier: CrawlTier;
    })
  | (CrawlTickBase & {
      /** Another tick or instance held the lock; this tick did nothing. */
      locked: true;
      seasonType: null;
      leagueTtlMs: null;
      tier: null;
    });

const NO_REFRESH: RefreshResult = {
  refreshed: 0,
  refreshFailed: 0,
  gone: 0,
  corpus: 0,
  dueBefore: 0,
  due: 0,
  oldestAgeMs: 0,
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
  ttlMs: number,
): Promise<RefreshResult> {
  const { corpus, due: dueBefore, oldestAgeMs } = await leagueQueueStats(
    season,
    ttlMs,
  );
  const leagueIds = await claimStaleLeagues(season, ttlMs, limit);
  if (leagueIds.length === 0) {
    return { ...NO_REFRESH, corpus, dueBefore, oldestAgeMs, due: dueBefore };
  }

  const leagues: SleeperLeague[] = [];
  const goneIds: string[] = [];
  let failed = 0;

  await mapWithConcurrency(leagueIds, CRAWL_CONCURRENCY, async (leagueId) => {
    try {
      const league = await getLeague(leagueId);
      if (league) leagues.push(league);
      else goneIds.push(leagueId);
    } catch (error) {
      failed += 1;
      console.warn(
        `[crawl] failed to fetch league ${leagueId}:`,
        errorMessage(error),
      );
    }
  });

  // Tombstoned so the queue stops claiming them — an unmarked deleted league
  // stays due forever and burns a slot plus a Sleeper request every rotation.
  await markLeaguesGone(goneIds);

  const result = await syncLeagueGraphs(leagues, currentWeek, {
    concurrency: CRAWL_CONCURRENCY,
  });

  return {
    refreshed: result.loaded,
    refreshFailed: failed + result.failed,
    gone: goneIds.length,
    corpus,
    dueBefore,
    oldestAgeMs,
    // The batch we just claimed no longer counts as due unless it failed — and
    // a tombstoned league leaves the queue for good, so it retires too.
    due: remainingDue(dueBefore, result.loaded, goneIds.length),
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

  // Fill up to the per-tick cap in queue order — see `./discovery` for what
  // "eligible" means and why a manager is taken whole or not at all.
  const selection = selectDiscoveryLeagues(userIds, byManager, known, cap);

  const result = await syncLeagueGraphs(selection.leagues, currentWeek, {
    concurrency: CRAWL_CONCURRENCY,
  });

  // The invariant this pass rests on: stamping a manager suppresses them for
  // the six-hour enumeration TTL, so a manager whose newly discovered league
  // failed to sync must stay unstamped — otherwise that league stays unknown
  // and nothing points at it again until some other member of it comes up.
  const stamped = stampableManagers(selection, new Set(result.failedIds));
  await stampManagers(season, stamped);

  return {
    managersCrawled: stamped.length,
    discovered: result.loaded,
    discoverFailed: failed + result.failed,
    // Managers this tick did not retire: cap-deferred, enumeration failures, and
    // those held back by a failed league. All three are unstamped and come back.
    deferred: userIds.length - stamped.length,
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
    // Resolved rather than compiled in, so a league-year rollover doesn't leave
    // the crawler refreshing last season's leagues until someone redeploys.
    season = await getActiveSeason(),
    leagueLimit = CRAWL_LEAGUE_BATCH,
    managerLimit = CRAWL_MANAGER_BATCH,
    discoveryCap = CRAWL_DISCOVERY_CAP,
  } = options;

  const startedAt = Date.now();

  // The lock is held for the whole tick so overlapping ticks — and extra app
  // instances, which share one database — don't crawl the same rows twice. The
  // state read sits inside it too: a tick that loses the lock costs Sleeper
  // nothing, which is why the tier fields are null on the locked fallback.
  const summary = await withAdvisoryLock(LOCK_KEYS.leagueCrawl, async () => {
    const state = await getNflState();
    const currentWeek = flooredWeek(state);
    // One TTL for the whole tick — the stats and the claim must agree on what
    // "due" means, or the numbers reported describe a different queue than the
    // one crawled.
    const { ttlMs, tier } = leagueCrawlTtl(state);
    const refresh = await refreshStaleLeagues(
      season,
      currentWeek,
      leagueLimit,
      ttlMs,
    );
    const discovery = await discoverMemberLeagues(
      season,
      currentWeek,
      managerLimit,
      discoveryCap,
    );
    return {
      season,
      locked: false as const,
      seasonType: state?.season_type ?? null,
      leagueTtlMs: ttlMs,
      tier,
      ...refresh,
      ...discovery,
    };
  });

  const tickMs = Date.now() - startedAt;
  return summary
    ? { ...summary, tickMs }
    : {
        season,
        locked: true,
        seasonType: null,
        leagueTtlMs: null,
        tier: null,
        tickMs,
        ...NO_REFRESH,
        ...NO_DISCOVERY,
      };
}
