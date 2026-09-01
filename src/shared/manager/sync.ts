import {
  AdvisoryLockTimeoutError,
  managerSyncLockKey,
  pool,
  withBlockingAdvisoryLock,
} from "@/shared/db";
import { peekActiveSeason } from "@/shared/season";
import { getLeague, getNflState, getUserLeagues } from "@/shared/sleeper";
import type { SleeperLeague, SleeperNflState } from "@/shared/sleeper";
import { errorMessage, mapWithConcurrency } from "@/shared/util";
import type {
  LeagueCounts,
  SyncProgress,
  SyncSummary,
} from "@/shared/contract";

import {
  markLeaguesAccessed,
  markLeaguesGone,
  stampLeagueSyncAttempts,
} from "./crawl-queue";
import { fetchLeagueGraph, type GraphWeeks } from "./graph";
import { leagueGraphWeeks, type SyncClock } from "./graph-weeks";
import {
  getStoredMaxMatchupWeekByLeague,
  getStoredMaxWeekByLeague,
  persistLeagueGraph,
  replaceManagerLeagueOrder,
} from "./persist";
import { getManagerSyncState, getUnlistedManagerLeagueIds } from "./queries";
import {
  MANAGER_SYNC_STAMP_SQL,
  managerSyncGate,
  seasonSyncTier,
} from "./sync-freshness";

/*
 * The three shapes this reports in are declared in `@/shared/contract`, not
 * here — TheLabX has them the other way round, with the contract type-importing
 * from this module. This repo's contract rule is the stricter one (types only,
 * zero runtime imports), and it is what lets a `"use client"` hook decode this
 * protocol without pulling a database client into the browser.
 */
export type {
  LeagueCounts,
  SyncProgress,
  SyncSummary,
} from "@/shared/contract";

export type SyncOptions = {
  force?: boolean;
  concurrency?: number;
  onProgress?: (progress: SyncProgress) => void;
};

/** Outcome of persisting a batch of league graphs. */
export type LeagueSyncResult = {
  /**
   * Leagues whose graph was **persisted** — the transaction committed and the
   * row exists. Includes the partial ones, deliberately: everything about being
   * *recorded* (discovery's manager stamp, the id no longer being unknown) turns
   * on the write having happened, and a partial graph has happened.
   */
  loaded: number;
  /**
   * Of those, how many were persisted from an **incomplete** upstream answer —
   * a mandatory child collection came back empty and the previously stored rows
   * were kept instead. See {@link PersistLeagueGraphResult}.
   *
   * These are the leagues that are neither a success nor a failure, and until
   * this field existed they were counted as successes: the graph was written,
   * `failed` stayed 0, the manager was stamped fully synced and the league's own
   * `updated_at` advanced, so a fetch nobody had managed to make bought a full
   * freshness TTL of quiet.
   */
  partial: number;
  failed: number;
  counts: LeagueCounts;
  /**
   * Which leagues were persisted and which failed, not just how many. The
   * crawler stamps a manager only when every league it discovered for them is
   * in, and with leagues shared between managers a count can't answer that —
   * see `./discovery`.
   */
  loadedIds: string[];
  /** The subset of {@link loadedIds} that came from an incomplete fetch. */
  partialIds: string[];
  failedIds: string[];
};

/** Leagues genuinely re-read from Sleeper — persisted *and* complete. */
export function refreshedLeagues(result: LeagueSyncResult): number {
  return result.loaded - result.partial;
}

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

/**
 * Leagues probed per sync to find out whether they were deleted.
 *
 * The set this bounds is "on this manager's list, absent from Sleeper's
 * enumeration", which in the steady state is empty — a deletion is tombstoned
 * the first time it is seen and never comes back. What it is sized against is
 * the other member of that set: a league the manager *left*, which stays a
 * candidate until the crawler next replaces its rosters, and would otherwise be
 * re-probed on every sync of theirs for as long as that takes. Small because it
 * only has to drain faster than deletions arrive, and it is spent on top of a
 * fan-out that is already this manager's whole league graph.
 */
const UNLISTED_PROBE_LIMIT = 8;

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
 * transaction fetch. Split from {@link getSyncClock} for callers that already
 * hold the state — the crawler derives this, the season and its freshness tier
 * from one fetch.
 */
export function flooredWeek(state: SleeperNflState | null): number {
  return Math.max(state?.week ?? 1, 1);
}

/**
 * The week *and* the season off one `state/nfl` read.
 *
 * **It replaces a bare `getCurrentWeek`, and the pairing is the point.** A week
 * number on its own does not say which season's week it is, and every caller of
 * {@link syncLeagueGraphs} was reading the app's week and applying it to
 * whatever season it happened to be syncing — see `./graph-weeks` for what that
 * cost a past season. Handing the two out together is what makes the mistake
 * unavailable rather than merely fixed: there is no longer a function that
 * answers half the question.
 *
 * A state read that fails leaves `activeSeason` null, which `isFinishedSeason`
 * reads as "not known to be finished" — the live ceiling, and so exactly the
 * behaviour that existed before it was consulted.
 */
export async function getSyncClock(): Promise<SyncClock> {
  const state = await getNflState();
  return { currentWeek: flooredWeek(state), activeSeason: state?.season ?? null };
}

/**
 * Fetch each league's full graph from Sleeper and persist it.
 *
 * Leagues are processed with bounded concurrency and each one is its own
 * transaction, so a slow or failed league neither stalls the others nor rolls
 * back the batch. `onProgress` fires after each league completes.
 *
 * A league's weeks are frozen once past, so only the tail of each week-keyed
 * collection is re-fetched, and the ceiling is per league rather than per tick —
 * see `./graph-weeks`, which owns both halves of that decision and the reason a
 * finished season must not be bounded by the current one's week.
 *
 * Transactions and matchups are gated **separately**, on their own stored
 * weeks. They fill up independently — every league stored before matchups
 * existed has transactions through the current week and no matchups at all — so
 * one shared gate would open the window past a whole unfetched season.
 */
export async function syncLeagueGraphs(
  leagues: SleeperLeague[],
  clock: SyncClock,
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
  const weeksFor = (league: SleeperLeague): GraphWeeks =>
    leagueGraphWeeks(league.season, clock, {
      transactions: storedMaxWeek.get(league.league_id),
      matchups: storedMaxMatchupWeek.get(league.league_id),
    });

  let loaded = 0;
  let partial = 0;
  let failed = 0;
  const loadedIds: string[] = [];
  const partialIds: string[] = [];
  const failedIds: string[] = [];
  const counts = emptyCounts();

  onProgress?.({ loaded, total, failed });

  await mapWithConcurrency(leagues, concurrency, async (league) => {
    try {
      const graph = await fetchLeagueGraph(league, weeksFor(league));
      const persisted = await persistLeagueGraph(graph);
      counts.rosters += graph.rosters.length;
      counts.leagueUsers += graph.users.length;
      counts.tradedPicks += graph.tradedPicks.length;
      counts.drafts += graph.drafts.length;
      counts.draftPicks += graph.draftPicks.length;
      counts.transactions += graph.transactions.length;
      counts.matchups += graph.matchups.length;
      loaded += 1;
      loadedIds.push(league.league_id);
      // **Persisted is not refreshed.** A graph missing a mandatory collection
      // kept its stored rows rather than being wiped, which is the right write —
      // and exactly why it must not also be reported as a successful refresh:
      // the freshness stamps downstream would then buy a TTL of quiet for data
      // nobody managed to read.
      //
      // Not logged here: `writeLeagueGraph` already names the league and the
      // collections that came back empty, so a line per league in both places
      // would double an operator's log during exactly the upstream outage that
      // produces them. What each *caller* logs is its own summary — how many of
      // its batch were partial — which is the number that says whether this is a
      // league or a Sleeper problem.
      if (!persisted.complete) {
        partial += 1;
        partialIds.push(league.league_id);
      }
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

  return { loaded, partial, failed, counts, loadedIds, partialIds, failedIds };
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
      total: 0, leagues: 0, partial: 0, failed: 0,
      ...emptyCounts(),
    };
  }
}

/**
 * Tombstone the leagues that left this manager's enumeration because Sleeper
 * deleted them.
 *
 * **The enumeration is the earliest signal this app gets that a league is
 * gone**, and until now it was thrown away: the sync wrote back the leagues
 * Sleeper listed and simply never mentioned the rest, so a deleted league kept
 * its stored rosters and members — nothing replaces those but a sync of the
 * league itself, which a deleted league never gets again — and went on being
 * listed, ranked, priced and counted into every share until the crawler's
 * refresh rotation happened to claim it. That is a whole freshness TTL at best,
 * and on a deployment running no background jobs it is never.
 *
 * Every id here is **probed rather than trusted**, because absence from the list
 * means one of two opposite things: Sleeper deleted the league, or the manager
 * left it and it is alive and full of other people. `getLeague` is the only
 * thing that can tell them apart — the same probe `partitionSyncFailures` and
 * `refreshLeague` make, folding 404 into Sleeper's usual 200-with-null — and
 * only its null answer tombstones. A departure needs nothing done to it: the
 * next sync of that league replaces its rosters without the manager's, and
 * `FIELDED_A_TEAM_SQL` stops matching.
 *
 * **An empty enumeration reconciles nothing.** `sleeperGet` folds a 200-with-null
 * into `[]`, so "no leagues" is what a failed request looks like from here, and
 * it is the one answer that would put every league this manager has into the
 * probe queue. Guarded for {@link replaceManagerLeagueOrder}'s reason and by the
 * same test.
 *
 * Non-fatal, and reported rather than thrown: what it fixes is a stale row on a
 * page, where what it sits inside is the sync that fills that page in. A probe
 * that fails leaves the league exactly as it was and the next sync tries again.
 */
async function reconcileUnlistedLeagues(
  userId: string,
  season: string,
  listedIds: readonly string[],
): Promise<void> {
  if (listedIds.length === 0) return;

  const candidates = await getUnlistedManagerLeagueIds(
    userId,
    season,
    listedIds,
    UNLISTED_PROBE_LIMIT,
  );
  if (candidates.length === 0) return;

  // Before the probes, so a league whose probe fails or is refused still rotates
  // to the back of its own queue rather than holding the head of it forever.
  await stampLeagueSyncAttempts(candidates);

  const goneIds: string[] = [];
  await mapWithConcurrency(candidates, LEAGUE_FETCH_CONCURRENCY, async (id) => {
    try {
      if (!(await getLeague(id))) goneIds.push(id);
    } catch (error) {
      // Ambiguous, so nothing is claimed about the league — a tombstone is the
      // one answer here that hides a live league from everybody in it.
      console.warn(`[leagues] could not probe league ${id}:`, errorMessage(error));
    }
  });

  if (goneIds.length === 0) return;
  await markLeaguesGone(goneIds);

  console.info(
    `[leagues] tombstoned ${goneIds.length} league(s) Sleeper no longer serves ` +
      `for ${userId} (${season}): ${goneIds.join(", ")}.`,
  );
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
    // `peekActiveSeason` and never `getActiveSeason`: this decides a *TTL*, not
    // the answer, so it must not be able to block on Sleeper — and `undefined`
    // is read as the active tier, the shortest clock, which is the behaviour
    // this had before tiers existed. The route ahead of this asked the same
    // question the same way; two spellings of "is this due" is the bug one
    // function exists to prevent.
    tier: seasonSyncTier(season, peekActiveSeason()),
  });
  if (!gate.run) {
    // Skipped with nothing in flight, so this is not a `locked` answer — but
    // whether it is a *complete* one is the gate's to say and not this branch's.
    // "Still fresh" leaves a whole graph; "an attempt is still inside its
    // throttle window" leaves whatever that attempt managed, which is exactly
    // the case that used to be reported as fresh.
    return {
      season, locked: false, skipped: true, complete: gate.complete,
      total: 0, leagues: 0, partial: 0, failed: 0,
      ...emptyCounts(),
    };
  }

  // The clock carries the season as well as the week, so a sync of a *past*
  // season fetches that season whole rather than stopping at whatever week the
  // current one has reached — see `./graph-weeks`.
  const clock = await getSyncClock();
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

  const { loaded, partial, failed, counts } = await syncLeagueGraphs(
    leagues,
    clock,
    { concurrency, onProgress },
  );

  // After the graphs, because the route re-reads the leagues list once this
  // returns and a tombstone written now is one the reader sees on this press —
  // and because a probe is a Sleeper request, which has no business competing
  // with the fan-out this sync exists to run. It cannot take the sync down: a
  // stale row on a page is what it fixes, and losing the page to fix it would be
  // the worse trade.
  try {
    await reconcileUnlistedLeagues(userId, season, leagueIds);
  } catch (error) {
    console.warn(
      `[leagues] could not reconcile deleted leagues for ${userId}:`,
      errorMessage(error),
    );
  }

  // A league Sleeper dropped on the floor is a league this manager's graph is
  // still missing, so the run only *completes* when none did. Both timestamps
  // are stamped either way and they answer different questions — see
  // {@link MANAGER_SYNC_STAMP_SQL}: `attempt_at` is what keeps the next caller
  // off Sleeper for the throttle window (written even on failure, which is the
  // protection this used to get by lying with `synced_at`), and `synced_at` is
  // the claim that these leagues are current. `attempt_at` also does everything
  // the crawl's discovery pass would have, so the manager rotates to the back of
  // that queue as well.
  //
  // **A partial league counts against completeness exactly as a failed one
  // does**, and that is the whole of this fix at this grain: a graph written
  // from a fetch whose users or rosters never arrived is a graph that is not
  // current, however cleanly its transaction committed. Counting only `failed`
  // stamped `synced_at` on it, and the manager was then suppressed for a whole
  // freshness TTL — on the archive tier, forever.
  const complete = failed === 0 && partial === 0;
  await pool.query(MANAGER_SYNC_STAMP_SQL, [userId, season, complete]);

  if (partial > 0) {
    console.warn(
      `[leagues] ${userId} (${season}): ${partial} of ${loaded} league(s) ` +
        `persisted partially; not stamping a complete sync.`,
    );
  }

  return {
    season, locked: false, skipped: false, complete, total: leagues.length,
    leagues: loaded, partial, failed, ...counts,
  };
}
