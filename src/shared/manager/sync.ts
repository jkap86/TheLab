import {
  AdvisoryLockTimeoutError,
  managerSyncLockKey,
  pool,
  withBlockingAdvisoryLock,
} from "@/shared/db";
import { getNflState, getUserLeagues } from "@/shared/sleeper";
import type { SleeperLeague, SleeperNflState } from "@/shared/sleeper";
import { syncTradeRosters } from "@/shared/trades";
import { errorMessage, mapWithConcurrency } from "@/shared/util";

import { markLeaguesAccessed } from "./crawl-queue";
import { fetchLeagueGraph, type GraphWeeks, type WeekRange } from "./graph";
import {
  getStoredMaxMatchupWeekByLeague,
  getStoredMaxWeekByLeague,
  persistLeagueGraph,
  replaceManagerLeagueOrder,
} from "./persist";
import { getManagerSyncState } from "./queries";
import { MANAGER_SYNC_STAMP_SQL, managerSyncGate } from "./sync-freshness";

/** Child rows persisted across a set of league graphs. */
export type LeagueCounts = {
  rosters: number;
  leagueUsers: number;
  tradedPicks: number;
  drafts: number;
  draftPicks: number;
  transactions: number;
  /** Roster-weeks of scoring persisted (one row per roster per week). */
  matchups: number;
};

export type SyncSummary = LeagueCounts & {
  season: string;
  /**
   * true when another caller held this manager's lock for longer than the wait
   * allows, so this run did nothing and someone else is *still writing* — the
   * same field the players, KTC and projections summaries carry.
   *
   * **It is what separates the two skips, which mean opposite things.** A skip
   * because the data was already fresh (or because the lock's winner finished
   * while we queued) leaves a complete, current league graph — that is what the
   * blocking lock is *for*. A skip because the wait ran out leaves whatever the
   * holder has committed so far, which for a manager being synced the first time
   * is a fraction of their leagues. Both used to report `skipped: true` and
   * nothing else, so a caller could not tell "nothing to do" from "read this
   * again shortly".
   */
  locked: boolean;
  /** true when the sync did no work — see {@link SyncSummary.locked} for why. */
  skipped: boolean;
  /** total leagues the manager belongs to this season. */
  total: number;
  /** leagues successfully fetched and persisted. */
  leagues: number;
  /** leagues that failed to sync (e.g. Sleeper timeout) and were skipped. */
  failed: number;
  /**
   * Whether the manager's whole league graph is now known-current.
   *
   * **The one field a caller may treat as "this list is final".** It is not
   * `failed === 0`: a run that did nothing because it lost the lock, or because
   * the last attempt is still inside its throttle window, has no failures to
   * report and no claim to make either. It is true for a real run that dropped
   * no league, and for a skip that was skipped *because a complete sync is still
   * fresh* — and false everywhere else, which is the whole of the distinction
   * `synced_at` and `attempt_at` are two columns for.
   */
  complete: boolean;
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
  /**
   * Which leagues were persisted and which failed, not just how many. The
   * crawler stamps a manager only when every league it discovered for them is
   * in, and with leagues shared between managers a count can't answer that —
   * see `./discovery`.
   */
  loadedIds: string[];
  failedIds: string[];
};

// Re-exported so the route and the barrel keep one import site for a constant
// whose definition now sits beside the decision that reads it.
export {
  SYNC_TTL_MS,
  SYNC_ATTEMPT_TTL_MS,
  managerSyncGate,
} from "./sync-freshness";
export type { ManagerSyncState, SyncGate, SyncGateReason } from "./sync-freshness";

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
  matchups: 0,
});

/**
 * The current NFL week, floored to 1: offseason moves are logged at week 1 while
 * Sleeper's state reports week 0. Nothing exists past it, so it bounds every
 * transaction fetch. Split from {@link getCurrentWeek} for callers that already
 * hold the state — the crawler derives this and its freshness tier from one
 * fetch.
 */
export function flooredWeek(state: SleeperNflState | null): number {
  return Math.max(state?.week ?? 1, 1);
}

/** {@link flooredWeek} of a fresh `state/nfl` read. */
export async function getCurrentWeek(): Promise<number> {
  return flooredWeek(await getNflState());
}

/**
 * Fetch each league's full graph from Sleeper and persist it.
 *
 * Leagues are processed with bounded concurrency and each one is its own
 * transaction, so a slow or failed league neither stalls the others nor rolls
 * back the batch. `onProgress` fires after each league completes.
 *
 * A league's weeks are frozen once past, so only the tail of each week-keyed
 * collection is re-fetched: from its last stored week minus one (to catch
 * late-settling waivers and trades, and the stat corrections that move a closed
 * week's points) up to `currentWeek`. A league with nothing stored is backfilled
 * from week 1.
 *
 * Transactions and matchups are gated **separately**, on their own stored
 * weeks. They fill up independently — every league stored before matchups
 * existed has transactions through the current week and no matchups at all — so
 * one shared gate would open the window past a whole unfetched season.
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

  const leagueIds = leagues.map((l) => l.league_id);
  const [storedMaxWeek, storedMaxMatchupWeek] = await Promise.all([
    getStoredMaxWeekByLeague(leagueIds),
    getStoredMaxMatchupWeekByLeague(leagueIds),
  ]);
  const tailFrom = (stored: number | undefined): WeekRange => ({
    from: stored ? Math.max(stored - 1, 1) : 1,
    to: Math.max(currentWeek, stored ?? 1, 1),
  });
  const weeksFor = (leagueId: string): GraphWeeks => ({
    transactions: tailFrom(storedMaxWeek.get(leagueId)),
    matchups: tailFrom(storedMaxMatchupWeek.get(leagueId)),
  });

  let loaded = 0;
  let failed = 0;
  const loadedIds: string[] = [];
  const failedIds: string[] = [];
  const counts = emptyCounts();

  onProgress?.({ loaded, total, failed });

  await mapWithConcurrency(leagues, concurrency, async (league) => {
    try {
      const graph = await fetchLeagueGraph(league, weeksFor(league.league_id));
      await persistLeagueGraph(graph);
      // The pre-trade rosters ride on this pass because this is where both of
      // their inputs land — the current rosters and the transaction log — and
      // because the walk is only correct once the log it reads is committed.
      // **Its failure is not this league's failure**, the per-read judgement
      // `/api/league/[leagueId]` makes about its projections: the graph is the
      // point and these are a derived extra, so a `failed` here would report a
      // league that synced perfectly well as one that didn't, and take it out
      // of the crawler's stamp with it. Due work stays due, so the next pass
      // simply tries again.
      await syncTradeRosters(league.league_id, graph.txWeeks).catch((error) => {
        console.warn(
          `[trades] pre-trade rosters for league ${league.league_id} failed:`,
          errorMessage(error),
        );
      });
      counts.rosters += graph.rosters.length;
      counts.leagueUsers += graph.users.length;
      counts.tradedPicks += graph.tradedPicks.length;
      counts.drafts += graph.drafts.length;
      counts.draftPicks += graph.draftPicks.length;
      counts.transactions += graph.transactions.length;
      counts.matchups += graph.matchups.length;
      loaded += 1;
      loadedIds.push(league.league_id);
    } catch (error) {
      failed += 1;
      failedIds.push(league.league_id);
      console.error(
        `[leagues] failed to sync league ${league.league_id}:`,
        errorMessage(error),
      );
    } finally {
      onProgress?.({ loaded, total, failed });
    }
  });

  return { loaded, failed, counts, loadedIds, failedIds };
}

/**
 * Fetch a manager's leagues (and rosters, members, traded picks, drafts, draft
 * picks, transactions and matchups) from Sleeper for a season and persist them
 * to Postgres.
 *
 * Held under a per-manager advisory lock so concurrent callers — two tabs, or
 * two app instances sharing one database — don't each run the full
 * ~11-requests-per-league fan-out against Sleeper. The lock *waits* rather than
 * skipping, because callers want the data, not just the work done: a loser that
 * skipped would answer from a cache the winner is mid-way through writing. The
 * freshness decision lives inside the lock (the "take it around the freshness
 * check too" rule), and a sync that completed while we queued counts as this
 * request's sync even when `force` is set — force means "the caller decided a
 * refresh is due", and the winner just did that refresh. So does one that merely
 * *tried*: running the whole fan-out a millisecond after another caller's
 * attempt is what the lock exists to prevent, whether or not that attempt got
 * every league. What the loser must never do is claim the graph is complete, and
 * {@link SyncSummary.complete} is where it says so.
 *
 * **The lock is held across the Sleeper work, not only across the writes, and
 * that is the one thing about this shape worth defending explicitly.** It is
 * exactly what `Limiter.run`'s own note warns against — a pool connection held
 * over an upstream wait — and the obvious rearrangement is not available:
 * released before the fetch, two instances both find the manager stale, both
 * decide a refresh is due and both run the ~11-requests-per-league fan-out,
 * which is the duplicate cross-instance work this lock is the only thing
 * preventing. So the lifetime stays and the *number* of them is what is bounded:
 * `shared/manager/sync-admission` caps how many manager syncs one process runs
 * at once at a share of the pool, which is what keeps these held sessions from
 * being most of it.
 *
 * **Admission is the caller's, not this function's.** It cannot be taken here:
 * the leagues route has to know whether it may sync *before* it opens a stream,
 * since a caller with nothing cached answers 503 rather than an empty list, and a
 * decision made inside this call is a decision made after that answer was owed.
 */
export async function syncManagerLeagues(
  userId: string,
  season: string,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const requestedAt = new Date();
  try {
    return await withBlockingAdvisoryLock(managerSyncLockKey(userId), () =>
      syncManagerLeaguesLocked(userId, season, requestedAt, options),
    );
  } catch (error) {
    if (!(error instanceof AdvisoryLockTimeoutError)) throw error;
    // The wait is bounded now (see ADVISORY_LOCK_WAIT_MS), so a holder that
    // outruns it turns into a skip rather than a connection held for as long as
    // they take. Reported as skipped, which is what it is: someone else is
    // running this manager's sync, and the caller serves what is stored.
    console.warn(
      `[leagues] sync for ${userId} (${season}) is already running elsewhere; skipped.`,
    );
    // `locked`, not merely `skipped`: the holder is mid-write, so what is stored
    // right now is whatever they have committed — the caller must not present it
    // as a finished sync. See {@link SyncSummary.locked}.
    return {
      season, locked: true, skipped: true, complete: false,
      total: 0, leagues: 0, failed: 0,
      ...emptyCounts(),
    };
  }
}

async function syncManagerLeaguesLocked(
  userId: string,
  season: string,
  requestedAt: Date,
  options: SyncOptions,
): Promise<SyncSummary> {
  const { force = false, concurrency, onProgress } = options;

  // The freshness decision inside the lock, so two callers can't both decide a
  // refresh is due and then run it in turn. It is the same function the leagues
  // route asks before it decides to call at all — see {@link managerSyncGate}
  // for why a race is never overridden by `force` and freshness is.
  const gate = managerSyncGate(await getManagerSyncState(userId, season), {
    now: Date.now(),
    requestedAt: requestedAt.getTime(),
    force,
  });
  if (!gate.run) {
    // Skipped with nothing in flight, so this is not a `locked` answer — but
    // whether it is a *complete* one is the gate's to say and not this branch's.
    // "Still fresh" leaves a whole graph; "an attempt is still inside its
    // throttle window" leaves whatever that attempt managed, which is exactly
    // the case that used to be reported as fresh.
    return {
      season, locked: false, skipped: true, complete: gate.complete,
      total: 0, leagues: 0, failed: 0,
      ...emptyCounts(),
    };
  }

  const currentWeek = await getCurrentWeek();
  const leagues = await getUserLeagues(userId, season);

  const leagueIds = leagues.map((l) => l.league_id);

  // Recorded before the graphs are fetched, and over *every* league Sleeper
  // listed rather than the ones that synced: the order is what the enumeration
  // said, and a league whose graph fails this pass is still stored from an
  // earlier one — dropping it from the ordering would move it to the end of the
  // list until the next successful sync.
  await replaceManagerLeagueOrder(userId, season, leagueIds);

  // Somebody searched this manager, which is the strongest demand signal this
  // app has: these leagues are on a page a person is looking at. It moves them
  // up the crawler's refresh queue and nothing else, so it is fired off rather
  // than awaited — a scheduling hint is not worth a failure mode.
  void markLeaguesAccessed(leagueIds).catch((error) => {
    console.warn("[leagues] demand stamp failed:", errorMessage(error));
  });

  const { loaded, failed, counts } = await syncLeagueGraphs(
    leagues,
    currentWeek,
    { concurrency, onProgress },
  );

  // A league Sleeper dropped on the floor is a league this manager's graph is
  // still missing, so the run only *completes* when none did. Both timestamps
  // are stamped either way and they answer different questions — see
  // {@link MANAGER_SYNC_STAMP_SQL}: `attempt_at` is what keeps the next caller
  // off Sleeper for the throttle window (written even on failure, which is the
  // protection this used to get by lying with `synced_at`), and `synced_at` is
  // the claim that these leagues are current. `attempt_at` also does everything
  // the crawl's discovery pass would have, so the manager rotates to the back of
  // that queue as well.
  const complete = failed === 0;
  await pool.query(MANAGER_SYNC_STAMP_SQL, [userId, season, complete]);

  return {
    season, locked: false, skipped: false, complete, total: leagues.length,
    leagues: loaded, failed, ...counts,
  };
}
