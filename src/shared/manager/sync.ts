import {
  managerSyncLockKey,
  pool,
  withBlockingAdvisoryLock,
} from "@/shared/db";
import { getNflState, getUserLeagues } from "@/shared/sleeper";
import type { SleeperLeague } from "@/shared/sleeper";
import { errorMessage, mapWithConcurrency } from "@/shared/util";

import { fetchLeagueGraph, type WeekRange } from "./graph";
import { getStoredMaxWeekByLeague, persistLeagueGraph } from "./persist";
import { getManagerSyncedAt } from "./queries";

/** Child rows persisted across a set of league graphs. */
export type LeagueCounts = {
  rosters: number;
  leagueUsers: number;
  tradedPicks: number;
  drafts: number;
  draftPicks: number;
  transactions: number;
};

export type SyncSummary = LeagueCounts & {
  season: string;
  /** true when the sync was skipped because existing data was still fresh. */
  skipped: boolean;
  /** total leagues the manager belongs to this season. */
  total: number;
  /** leagues successfully fetched and persisted. */
  leagues: number;
  /** leagues that failed to sync (e.g. Sleeper timeout) and were skipped. */
  failed: number;
};

/** Incremental sync progress, reported after each league finishes. */
export type SyncProgress = { loaded: number; total: number; failed: number };

export type SyncOptions = {
  force?: boolean;
  concurrency?: number;
  onProgress?: (progress: SyncProgress) => void;
};

/** Outcome of persisting a batch of league graphs. */
export type LeagueSyncResult = {
  loaded: number;
  failed: number;
  counts: LeagueCounts;
};

/** How long a manager's league sync stays fresh before we re-fetch Sleeper. */
export const SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * Leagues fetched+persisted at once. Power users have 100+ leagues; fanning out
 * all of them at once overwhelms the connection and Sleeper, which is what
 * caused the request queue to blow past axios' timeout budget.
 */
export const LEAGUE_FETCH_CONCURRENCY = 6;

const emptyCounts = (): LeagueCounts => ({
  rosters: 0,
  leagueUsers: 0,
  tradedPicks: 0,
  drafts: 0,
  draftPicks: 0,
  transactions: 0,
});

/**
 * The current NFL week, floored to 1: offseason moves are logged at week 1 while
 * Sleeper's state reports week 0. Nothing exists past it, so it bounds every
 * transaction fetch.
 */
export async function getCurrentWeek(): Promise<number> {
  const nflState = await getNflState();
  return Math.max(nflState?.week ?? 1, 1);
}

/**
 * Fetch each league's full graph from Sleeper and persist it.
 *
 * Leagues are processed with bounded concurrency and each one is its own
 * transaction, so a slow or failed league neither stalls the others nor rolls
 * back the batch. `onProgress` fires after each league completes.
 *
 * A league's transaction weeks are frozen once past, so only the tail is
 * re-fetched: from its last stored week minus one (to catch late-settling
 * waivers/trades in the just-closed week) up to `currentWeek`. A league with no
 * stored transactions is backfilled from week 1.
 */
export async function syncLeagueGraphs(
  leagues: SleeperLeague[],
  currentWeek: number,
  options: {
    concurrency?: number;
    onProgress?: (progress: SyncProgress) => void;
  } = {},
): Promise<LeagueSyncResult> {
  const { concurrency = LEAGUE_FETCH_CONCURRENCY, onProgress } = options;
  const total = leagues.length;

  const storedMaxWeek = await getStoredMaxWeekByLeague(
    leagues.map((l) => l.league_id),
  );
  const txWeeksFor = (leagueId: string): WeekRange => {
    const stored = storedMaxWeek.get(leagueId);
    return {
      from: stored ? Math.max(stored - 1, 1) : 1,
      to: Math.max(currentWeek, stored ?? 1, 1),
    };
  };

  let loaded = 0;
  let failed = 0;
  const counts = emptyCounts();

  onProgress?.({ loaded, total, failed });

  await mapWithConcurrency(leagues, concurrency, async (league) => {
    try {
      const graph = await fetchLeagueGraph(league, txWeeksFor(league.league_id));
      await persistLeagueGraph(graph);
      counts.rosters += graph.rosters.length;
      counts.leagueUsers += graph.users.length;
      counts.tradedPicks += graph.tradedPicks.length;
      counts.drafts += graph.drafts.length;
      counts.draftPicks += graph.draftPicks.length;
      counts.transactions += graph.transactions.length;
      loaded += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[leagues] failed to sync league ${league.league_id}:`,
        errorMessage(error),
      );
    } finally {
      onProgress?.({ loaded, total, failed });
    }
  });

  return { loaded, failed, counts };
}

/**
 * Fetch a manager's leagues (and rosters, members, traded picks, drafts, and
 * draft picks) from Sleeper for a season and persist them to Postgres.
 *
 * Held under a per-manager advisory lock so concurrent callers — two tabs, or
 * two app instances sharing one database — don't each run the full ~9-requests-
 * per-league fan-out against Sleeper. The lock *waits* rather than skipping,
 * because callers want the data, not just the work done: a loser that skipped
 * would answer from a cache the winner is mid-way through writing. The
 * freshness decision lives inside the lock (the "take it around the freshness
 * check too" rule), and a sync that completed while we queued counts as this
 * request's sync even when `force` is set — force means "the caller decided a
 * refresh is due", and the winner just did that refresh.
 */
export async function syncManagerLeagues(
  userId: string,
  season: string,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const requestedAt = new Date();
  return withBlockingAdvisoryLock(managerSyncLockKey(userId), () =>
    syncManagerLeaguesLocked(userId, season, requestedAt, options),
  );
}

async function syncManagerLeaguesLocked(
  userId: string,
  season: string,
  requestedAt: Date,
  options: SyncOptions,
): Promise<SyncSummary> {
  const { force = false, concurrency, onProgress } = options;

  const syncedAt = await getManagerSyncedAt(userId, season);
  if (syncedAt) {
    const fresh = Date.now() - syncedAt.getTime() < SYNC_TTL_MS;
    const finishedWhileWaiting = syncedAt >= requestedAt;
    if (finishedWhileWaiting || (!force && fresh)) {
      return {
        season, skipped: true, total: 0, leagues: 0, failed: 0, ...emptyCounts(),
      };
    }
  }

  const currentWeek = await getCurrentWeek();
  const leagues = await getUserLeagues(userId, season);
  const { loaded, failed, counts } = await syncLeagueGraphs(
    leagues,
    currentWeek,
    { concurrency, onProgress },
  );

  // Stamp the sync so subsequent loads inside the TTL skip the re-fetch. Written
  // even on partial failure to avoid hammering Sleeper; the TTL retries later.
  // `attempt_at` moves too: this did everything the crawl's discovery pass would
  // have, so it should rotate to the back of that queue as well.
  await pool.query(
    `INSERT INTO manager_syncs (user_id, season, synced_at, attempt_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (user_id, season)
     DO UPDATE SET synced_at = now(), attempt_at = now()`,
    [userId, season],
  );

  return {
    season, skipped: false, total: leagues.length, leagues: loaded, failed,
    ...counts,
  };
}
