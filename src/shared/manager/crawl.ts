import { LOCK_KEYS, poolStats, withAdvisoryLock } from "@/shared/db";
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
import {
  admitInBatches,
  createCrawlPressureGate,
  crawlerPressureConfig,
  fmtMb,
  type CrawlPressureGate,
  type CrawlerPressureConfig,
  type CrawlerPressureLevel,
  type CrawlerResourcePressure,
} from "./crawl-pressure";
import { leagueCrawlTtl, type CrawlTier } from "./crawl-ttl";
import {
  remainingDue,
  selectDiscoveryLeagues,
  stampableManagers,
  unrecordedDiscoveries,
} from "./discovery";
import type { SyncClock } from "./graph-weeks";
import { persistGoneLeagues, persistUnsyncedLeagues } from "./persist";
import { flooredWeek, refreshedLeagues, syncLeagueGraphs } from "./sync";

/**
 * Stored leagues re-synced per tick. This is the crawler's refresh throughput —
 * `batch / interval`, 15 a minute — and with it the corpus each seasonal TTL in
 * `./crawl-ttl` can actually cover. Raise it only on telemetry showing the
 * in-season target missed (the scheduler warns), never preemptively: the budget
 * math on {@link CRAWL_DISCOVERY_CAP} assumes this size.
 *
 * It is a *budget* rather than a promise: a tick that stands down for memory
 * pressure spends less of it and the rest is never claimed, so those leagues
 * keep their place in the queue rather than being deferred a freshness TTL. See
 * `./crawl-pressure` and {@link RefreshResult.due}, which counts what actually
 * completed.
 */
export const CRAWL_LEAGUE_BATCH = 15;

/** League members whose league list is enumerated per tick. */
export const CRAWL_MANAGER_BATCH = 5;

/**
 * Newly discovered leagues fetched per tick, capped separately because a first
 * sync costs far more than a refresh: it backfills every week of *both*
 * week-keyed collections — transactions and matchups — so in-season it is ~41
 * Sleeper requests against a refresh's ~11. At this cap the two passes peak near
 * 800 requests/minute, which is inside Sleeper's budget but no longer has the
 * headroom the transaction-only backfill left. Lower it before raising
 * {@link CRAWL_LEAGUE_BATCH} if the crawler starts seeing 429s; the per-league
 * burst is bounded separately, inside `fetchLeagueGraph`.
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
 * Leagues fetched+persisted at once by the crawler.
 *
 * This runs forever in the background and should leave both Sleeper's rate
 * budget and the pg pool to real requests, and four is its share of the pool's
 * budget rather than a number of its own: the tick parks **one** session on its
 * advisory lock and opens at most this many transactions at once, beside the
 * manager syncs' two parked sessions × `LEAGUE_FETCH_CONCURRENCY` (2)
 * transactions and a refresh press's one and one. Parked sessions are ≤ 4 of
 * the default ten and the transient transactions time-share the other six. It
 * used to be the lower of the two league concurrencies; since the interactive
 * path came down to two it is the higher, which is right — a tick is one
 * session where two admitted syncs are two, so it can afford the wider fan-out.
 *
 * **It is a ceiling now rather than the width every tick runs at.** The resource
 * guard (`./crawl-pressure`) takes width away as RSS rises — halving here, one
 * league at a time there, none at all past the stop threshold — and derives
 * those levels from *this* number, so moving it carries them with it. It can
 * only ever narrow: the pool budget above is stated against this ceiling and
 * stays true whatever the guard decides.
 */
export const CRAWL_CONCURRENCY = 4;

/** What the refresh pass did this tick. */
export type RefreshResult = {
  /**
   * Stored leagues genuinely re-synced from Sleeper — persisted **and**
   * complete. A league whose users or rosters came back empty is counted under
   * {@link RefreshResult.refreshPartial} instead, because its `updated_at` was
   * deliberately left where it was: it is still due, and reporting it here
   * would retire it from {@link RefreshResult.due} against a queue that has not
   * moved.
   */
  refreshed: number;
  /**
   * Leagues written from an incomplete fetch: the stored rows are intact and the
   * league is still due, because `persistLeagueGraph` deliberately left its
   * `updated_at` where it was.
   *
   * **It is not reclaimed on the next tick, and that is the point.**
   * `sync_attempt_at` was stamped as it was claimed, and the claim query refuses
   * a league it has attempted inside the same freshness TTL however stale its
   * graph is — so a league Sleeper keeps answering badly is retried on the
   * cadence everything else is, rather than taking a slot and a fan-out every
   * minute. Freshness says work is needed; the attempt says how often to ask.
   */
  refreshPartial: number;
  /** leagues whose refresh failed; rotated to the back of the queue. */
  refreshFailed: number;
  /**
   * Leagues Sleeper no longer serves (deleted). Rows are left in place — their
   * drafts still feed the lineups ADP fallback and their completed trades are
   * still market history — but tombstoned out of the refresh queue.
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
  /**
   * Previously unseen leagues fetched and stored **whole**.
   *
   * A first sync that came back without users or rosters is
   * {@link DiscoveryResult.discoverPartial} instead: the row exists, so the
   * league is recorded and stops holding its managers back, but nothing about
   * it is current and the refresh pass still owes it a graph.
   */
  discovered: number;
  /**
   * Discovered leagues written from an incomplete fetch — recorded, retired
   * from this pass, and still due a real graph. Worth watching for the reason
   * {@link DiscoveryResult.discoverQueued} is: a steady trickle is ordinary,
   * and a tick where it is most of the batch says Sleeper is answering child
   * collections with nothing.
   */
  discoverPartial: number;
  /**
   * Discovered leagues whose first sync failed and that nothing was written
   * for — the only ones still holding a manager back. A failure with a row
   * behind it is counted as {@link DiscoveryResult.discoverGone} or
   * {@link DiscoveryResult.discoverQueued} instead.
   */
  discoverFailed: number;
  /**
   * Discovered leagues Sleeper no longer serves. Tombstoned rather than counted
   * as failures — they cannot succeed, and treating them as retryable is what
   * used to wedge this pass. See {@link partitionSyncFailures}.
   */
  discoverGone: number;
  /**
   * Discovered leagues that failed their first sync while Sleeper still serves
   * them: stored as a bare row and handed to the refresh pass, which is where
   * retrying a known league belongs.
   *
   * **Worth watching rather than merely counting.** A steady trickle is
   * ordinary — a league whose graph was mid-write, a timeout — and it costs one
   * refresh slot each. A tick where this is most of the discovery batch says
   * first syncs are failing wholesale, and the corpus is filling with rows that
   * have no graph behind them.
   */
  discoverQueued: number;
  /** managers deferred to the next tick because the discovery cap was hit. */
  deferred: number;
};

/**
 * What the resource guard did to this tick — see `./crawl-pressure`.
 *
 * Reported rather than logged from inside the passes, so the scheduler prints
 * one line about a tick rather than one per decision, and so a test of the
 * scheduler's wording never has to read the crawler's memory.
 */
export type CrawlPressureReport = {
  /** False when `CRAWLER_MEMORY_GUARD_ENABLED` turned the guard off. */
  enabled: boolean;
  /** RSS when the tick was admitted. */
  startRssMb: number;
  /** RSS when it finished — the pair is what says whether the tick grew it. */
  endRssMb: number;
  /** The band the last reading fell in. */
  level: CrawlerPressureLevel;
  /** Width the tick was admitted at. */
  startConcurrency: number;
  /** Width it ended on: 0 when it stopped admitting. */
  endConcurrency: number;
  /** True when the refresh pass stopped admitting before its batch was spent. */
  yielded: boolean;
  /** Refresh budget the tick never claimed, because it stood down. */
  leaguesRemaining: number;
  /** True when discovery was skipped or cut short for pressure. */
  discoveryDeferred: boolean;
  /** True when the pool was saturated at the last reading. */
  poolSaturated: boolean;
};

type CrawlTickBase = RefreshResult &
  DiscoveryResult & {
    season: string;
    /** Wall-clock cost of the tick, lock attempt included. */
    tickMs: number;
    pressure: CrawlPressureReport;
  };

/**
 * Why a tick did nothing at all.
 *
 * There are two reasons now and there used to be one, which is why the
 * discriminant is no longer the bare `locked` boolean: a tick refused for memory
 * pressure has, like a tick that lost the lock, never read Sleeper's state and
 * so carries no tier — but it is a different thing to say about a deployment,
 * and the scheduler answers the two with different lines.
 */
export type CrawlSkip =
  /** Another tick or instance held the crawl's advisory lock. */
  | "lock"
  /**
   * The resource guard refused it: RSS at or above the stop threshold, or a
   * previous yield still latched and RSS not yet back below the resume point.
   */
  | "memory";

/**
 * Discriminated on `skipped`, so a tick that did nothing carries no tier rather
 * than a made-up one, and the scheduler's `if (s.skipped)` guard is also the
 * type guard.
 */
export type CrawlSummary =
  | (CrawlTickBase & {
      skipped: null;
      /** Raw `season_type` the TTL was derived from. */
      seasonType: string | null;
      /** Freshness TTL applied to the whole tick — see `./crawl-ttl`. */
      leagueTtlMs: number;
      /** Seasonal tier of that TTL. */
      tier: CrawlTier;
    })
  | (CrawlTickBase & {
      skipped: CrawlSkip;
      seasonType: null;
      leagueTtlMs: null;
      tier: null;
    });

const NO_REFRESH: RefreshResult = {
  refreshed: 0,
  refreshPartial: 0,
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
  discoverPartial: 0,
  discoverFailed: 0,
  discoverGone: 0,
  discoverQueued: 0,
  deferred: 0,
};

/**
 * How many league syncs may start right now, and 0 when the answer is none.
 *
 * The crawler's two passes take this rather than a number, which is the whole of
 * the adaptive half: a width read once at the top of a tick is a decision made
 * before any of the memory the tick is about to allocate exists.
 */
type Admit = () => number;

/** A refresh pass, plus what the guard stopped it doing. */
type RefreshOutcome = RefreshResult & {
  /** Refresh budget the pass never claimed because it stood down. */
  remaining: number;
  /** True when it stopped admitting with budget and queue left. */
  yielded: boolean;
};

/**
 * Re-sync the stalest stored leagues — the same fetch+persist the leagues route
 * runs when someone searches a username, just driven off the league table rather
 * than off one manager.
 *
 * The league itself is re-read from Sleeper (not replayed from our row) because
 * name, status, settings and scoring drift, and the persisted league row comes
 * from that payload.
 *
 * **The batch is claimed in the width it is about to run, never whole**, and
 * that is the one thing about this loop that is silent when it is wrong.
 * `claimStaleLeagues` is an `UPDATE … RETURNING` that *stamps* `sync_attempt_at`
 * on everything it hands back, and the claim query refuses a league it has
 * attempted inside the same freshness TTL — so a league claimed and then not run
 * is a league marked attempted that nothing attempted, deferred a whole TTL (15
 * minutes in season, six hours in the deep offseason) for a reason nothing on
 * the outside could see. Taking exactly what runs makes that unreachable: a
 * league the guard stops us reaching is simply never claimed, keeps its place in
 * the queue, and is the next tick's first candidate.
 *
 * What it costs is `ceil(batch / width)` claim statements instead of one, and
 * the same again for `syncLeagueGraphs`' three prefetch reads. Each is a small
 * indexed query against a tick that spends ~11 Sleeper requests per league;
 * nothing about duplicate protection changes, because each claim is still the
 * same single atomic statement two ticks cannot both win.
 */
async function refreshStaleLeagues(
  season: string,
  clock: SyncClock,
  limit: number,
  ttlMs: number,
  admit: Admit,
): Promise<RefreshOutcome> {
  const { corpus, due: dueBefore, oldestAgeMs } = await leagueQueueStats(
    season,
    ttlMs,
  );

  let refreshed = 0;
  let partial = 0;
  let failed = 0;
  let goneCount = 0;

  const admission = await admitInBatches<string>({
    budget: limit,
    admit,
    take: (width) => claimStaleLeagues(season, ttlMs, width),
    run: async (leagueIds, width) => {
      const leagues: SleeperLeague[] = [];
      const goneIds: string[] = [];

      await mapWithConcurrency(leagueIds, width, async (leagueId) => {
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
      goneCount += goneIds.length;

      const result = await syncLeagueGraphs(leagues, clock, {
        concurrency: width,
      });
      refreshed += refreshedLeagues(result);
      partial += result.partial;
      failed += result.failed;

      // `leagues` and `result` are this batch's alone and go out of scope with
      // it, so the tick's peak retention is one batch of graphs rather than the
      // whole claim. Nothing is accumulated here but counters.
    },
  });

  return {
    refreshed,
    refreshPartial: partial,
    refreshFailed: failed,
    gone: goneCount,
    corpus,
    dueBefore,
    oldestAgeMs,
    // The batch we just claimed no longer counts as due unless it failed — and
    // a tombstoned league leaves the queue for good, so it retires too. A
    // *partial* league is not retired: its `updated_at` was left alone by
    // `persistLeagueGraph`, so it is still due by the same query that counted it
    // due, and pretending otherwise would understate the backlog the scheduler's
    // missed-target warning reads.
    due: remainingDue(dueBefore, refreshed, goneCount),
    // Budget, not backlog: what this tick was allowed to spend and did not.
    // Zero when the queue simply ran dry, which is not a yield.
    remaining: admission.yielded ? Math.max(limit - admission.started, 0) : 0,
    yielded: admission.yielded,
  };
}

/**
 * Split a discovery pass's failed leagues into the ones Sleeper no longer serves
 * and the ones it still does.
 *
 * A first sync fetches half a dozen child collections, so the error it throws
 * can't say whether the league is dead or Sleeper hiccuped — and that difference
 * decides which row the league gets, which is what makes a second request worth
 * spending. Re-asking for the league itself is that signal: null (Sleeper's
 * 200-with-null, with 404 folded into it) means gone.
 *
 * **Both halves are written down, and that is the change worth reading.** This
 * used to hand back a `retryable` set that nothing recorded, so a league in it
 * held its managers unstamped until some later tick happened to sync it — which
 * for a league that always fails is never (see {@link unrecordedFailures}). A
 * league Sleeper still serves is now parked with `persistUnsyncedLeagues`
 * instead, which retires it from *this* pass and hands it to the refresh pass,
 * where retrying leagues belongs.
 *
 * Which side an ambiguous answer falls on has therefore flipped, and it is safe
 * that it did. A probe that throws used to have to stay retryable, because the
 * only other bucket was a permanent tombstone; parking carries no such claim, so
 * an unconfirmed league is parked and the refresh pass re-probes it — a real
 * tombstone, if it deserves one, gets written there with a fresh answer rather
 * than guessed at here. Only a definite null still retires a league outright.
 *
 * Leagues are returned rather than ids because the caller writes the row from
 * them: the enumeration payload is the only copy of that league we will ever
 * hold. A failure with no payload behind it is in neither list, which is what
 * leaves it blocking — there is nothing to write.
 *
 * `width` is the resource guard's current allowance, floored at **one**
 * deliberately: this is not new work, it is writing down what the tick already
 * learned, and skipping it under pressure would leave a league that failed with
 * no row at all — which holds its managers unstamped and is the one state that
 * loses discovery work rather than deferring it. A handful of single probes is
 * the cheapest thing in the pass.
 */
async function partitionSyncFailures(
  failedIds: string[],
  attempted: readonly SleeperLeague[],
  width: number,
): Promise<{ gone: SleeperLeague[]; unsynced: SleeperLeague[] }> {
  const gone: SleeperLeague[] = [];
  const unsynced: SleeperLeague[] = [];
  if (failedIds.length === 0) return { gone, unsynced };

  const byId = new Map(attempted.map((l) => [l.league_id, l]));

  await mapWithConcurrency(failedIds, Math.max(1, width), async (leagueId) => {
    const league = byId.get(leagueId);
    if (!league) return;
    try {
      if (await getLeague(leagueId)) {
        unsynced.push(league);
        return;
      }
    } catch (error) {
      console.warn(
        `[crawl] could not confirm league ${leagueId} is gone:`,
        errorMessage(error),
      );
      unsynced.push(league);
      return;
    }
    gone.push(league);
  });

  return { gone, unsynced };
}

/** A discovery pass, plus what the guard stopped it doing. */
type DiscoveryOutcome = DiscoveryResult & {
  /**
   * True when the pass was skipped outright, or stopped admitting leagues with
   * some of its selection untouched.
   */
  deferredForPressure: boolean;
};

const NO_DISCOVERY_RUN: DiscoveryOutcome = {
  ...NO_DISCOVERY,
  deferredForPressure: false,
};

/**
 * Walk league members and pull in leagues we have never seen.
 *
 * This is what grows the corpus: every league sync writes its members to
 * `league_users`, each member's other leagues get discovered here, and those
 * leagues bring in more members. Seeded by the first username someone searches.
 *
 * **It is the first thing the resource guard takes away, and the last thing it
 * gives back.** A first sync backfills every week of both week-keyed collections
 * — ~41 Sleeper requests and a whole graph in memory against a refresh's ~11 —
 * so under pressure a corpus whose known leagues are going stale is the worse
 * state of the two. Nothing is lost by deferring: `pendingManagers` is a join
 * over `league_users` rather than a queue with a cursor, so a manager not
 * enumerated this tick is enumerated on a later one, and — see
 * {@link unrecordedDiscoveries} — a league this pass selects and then never
 * starts holds its managers unstamped exactly as a failure does, so it comes
 * straight back rather than being forgotten.
 */
async function discoverMemberLeagues(
  season: string,
  clock: SyncClock,
  limit: number,
  cap: number,
  admit: Admit,
): Promise<DiscoveryOutcome> {
  const enumerationWidth = admit();
  if (enumerationWidth <= 0) {
    return { ...NO_DISCOVERY, deferredForPressure: true };
  }

  const userIds = await pendingManagers(season, CRAWL_MANAGER_TTL_MS, limit);
  if (userIds.length === 0) return NO_DISCOVERY_RUN;

  const byManager = new Map<string, SleeperLeague[]>();
  let failed = 0;

  await mapWithConcurrency(userIds, enumerationWidth, async (userId) => {
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

  // Admitted in the guard's current width, on the refresh pass's terms and for
  // an extra reason of its own: this selection is not claimed in the database,
  // so what a batch boundary decides is simply which leagues this tick attempts
  // and which stay unknown — with the managers who were waiting on them left
  // unstamped, which is what brings both back next tick.
  const attempted: SleeperLeague[] = [];
  const failedIds: string[] = [];
  let discovered = 0;
  let partial = 0;
  let syncFailed = 0;

  const admission = await admitInBatches<SleeperLeague>({
    budget: selection.leagues.length,
    admit,
    // `attempted` is the cursor as well as the record — `run` pushes its batch
    // before syncing it and `admitInBatches` awaits each `run` before the next
    // `take`, so the two cannot drift into disagreeing about where we are.
    take: (width) =>
      selection.leagues.slice(attempted.length, attempted.length + width),
    run: async (batch, width) => {
      attempted.push(...batch);
      const result = await syncLeagueGraphs(batch, clock, {
        concurrency: width,
      });
      discovered += refreshedLeagues(result);
      partial += result.partial;
      syncFailed += result.failed;
      failedIds.push(...result.failedIds);
    },
  });

  const unattempted = selection.leagues.slice(attempted.length);

  // A league that fails its first sync every time holds its managers unstamped
  // forever, and because unstamped managers sort to the front of
  // `pendingManagers` that is not just their problem: they occupy the head of
  // the queue, the same leagues are re-fetched every tick, and discovery stops
  // finding anything for anyone. Writing a row is what ends it, whichever answer
  // the league gave — a tombstone for one Sleeper has dropped, a parked row for
  // one it still serves. Both retire the id from this pass; only the second is
  // still due a graph, and the refresh pass is what owes it.
  const { gone, unsynced } = await partitionSyncFailures(
    failedIds,
    attempted,
    admission.yielded ? 1 : enumerationWidth,
  );
  await persistGoneLeagues(gone);
  await persistUnsyncedLeagues(unsynced);

  // Stamped *after* both writes, and the order is the whole safety of this: a
  // write that throws takes the tick with it, so nothing is stamped and the
  // managers come back to a queue that has not moved. Stamping first would
  // suppress them for the enumeration TTL on the strength of a row that may not
  // exist — the one way a league is lost for good rather than merely late.
  //
  // What still blocks is a failure with no row behind it, and — since the guard
  // — a league this tick never started, which has no row for the same reason and
  // must hold its managers for the same one. See {@link unrecordedDiscoveries};
  // an unattempted league is not counted as a failure anywhere, it only holds a
  // stamp back.
  const recorded = new Set([...gone, ...unsynced].map((l) => l.league_id));
  const stamped = stampableManagers(
    selection,
    unrecordedDiscoveries(
      failedIds,
      recorded,
      unattempted.map((l) => l.league_id),
    ),
  );
  await stampManagers(season, stamped);

  return {
    managersCrawled: stamped.length,
    discovered,
    discoverPartial: partial,
    // Only the failures nothing was written for. A parked league is reported as
    // queued rather than failed: it *did* fail to sync, but counting it here as
    // well would have the same league show up twice in one summary line. An
    // unattempted league is in none of these — it was never tried.
    discoverFailed: failed + syncFailed - gone.length - unsynced.length,
    discoverGone: gone.length,
    discoverQueued: unsynced.length,
    // Managers this tick did not retire: cap-deferred, enumeration failures,
    // those held back by a failed league, and those held back by a league the
    // guard stopped us starting. All are unstamped and come back.
    deferred: userIds.length - stamped.length,
    deferredForPressure: admission.yielded,
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
  /**
   * The resource guard, carrying the hysteresis latch across ticks.
   *
   * The scheduler builds one in its own closure and hands it over every tick,
   * beside the throttles that already live there. A caller that passes none —
   * a script, a one-off — gets a gate with no memory of a previous tick, which
   * is the truthful answer when there was not one.
   */
  gate?: CrawlPressureGate;
};

/**
 * The guard's configuration, resolved once per process.
 *
 * `CRAWL_CONCURRENCY` is handed over as the maximum rather than restated, so the
 * reduced widths are always a fraction of whatever the crawler's own budget is —
 * see `crawlerPressureConfig`. The notice is written at module initialisation
 * on `sync-admission`'s terms: an operator whose numbers this app will not honour
 * should hear about it once, at boot, rather than per tick or not at all.
 */
const PRESSURE_CONFIG = crawlerPressureConfig({
  maxConcurrency: CRAWL_CONCURRENCY,
});
if (PRESSURE_CONFIG.notice) {
  console.warn(`[crawl] memory guard: ${PRESSURE_CONFIG.notice}`);
}

/** What a tick that did nothing still reports about the guard. */
function idlePressure(
  pressure: CrawlerResourcePressure,
  enabled: boolean,
): CrawlPressureReport {
  return {
    enabled,
    startRssMb: pressure.rssMb,
    endRssMb: pressure.rssMb,
    level: pressure.level,
    startConcurrency: pressure.allowedConcurrency,
    endConcurrency: pressure.allowedConcurrency,
    yielded: false,
    leaguesRemaining: 0,
    discoveryDeferred: !pressure.shouldDiscover,
    poolSaturated: pressure.pool?.saturated === true,
  };
}

/**
 * Say once, per tick, that the width moved.
 *
 * Only on a *transition*: a steady tick prints nothing, and a tick whose
 * pressure genuinely moves prints at most one line per batch boundary, which on
 * a fifteen-league batch is at most a handful. That is the difference between
 * telemetry and a log line every time memory is read — and memory is read
 * between every batch, which is the whole point.
 */
function logPressureShift(
  from: CrawlerResourcePressure,
  to: CrawlerResourcePressure,
  config: CrawlerPressureConfig,
): void {
  if (
    to.level === from.level &&
    to.allowedConcurrency === from.allowedConcurrency
  ) {
    return;
  }
  const rss = `rss=${fmtMb(to.rssMb)}`;
  if (to.allowedConcurrency === 0) {
    console.warn(
      `[crawl] yielding — ${to.hold === "recovering" ? "recovering" : "memory pressure"}: ` +
        `${rss} stop=${fmtMb(config.stopMb)}; ` +
        `no further league work admitted this tick.`,
    );
    return;
  }
  const label = to.hold === "pool" ? "pool pressure" : `${to.level} pressure`;
  console.log(
    `[crawl] ${label} — ${rss}; ` +
      `concurrency ${from.allowedConcurrency}→${to.allowedConcurrency}` +
      (to.hold === "pool" && to.pool
        ? ` (pool ${to.pool.total}/${to.pool.max}, ${to.pool.waiting} waiting)`
        : "") +
      ".",
  );
}

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
 *
 * **The resource guard is read before the lock, and again between every batch.**
 * Before, because a tick that cannot afford to crawl must not take a pool
 * connection and park a session on the crawl's advisory lock to find that out —
 * and because the first thing a refused tick owes an operator is to have cost
 * nothing. Between, because a tick that starts at 240 MB and is at 410 MB four
 * leagues later is the ordinary shape of this failure: the memory is made *by*
 * the tick, so one check at the top is a decision taken before any of it exists.
 *
 * **Yielding is a matter of admission and never of cancellation.** Nothing here
 * aborts a fetch, rolls back a transaction or abandons a promise; a batch in
 * flight is awaited whole, the advisory lock is released through the ordinary
 * `finally` in `withAdvisoryLock`, and what the guard withholds is the *next*
 * batch. There is no `process.exit` and no polling — the scheduler's own
 * interval is the retry.
 */
export async function runLeagueCrawl(
  options: CrawlOptions = {},
): Promise<CrawlSummary> {
  const {
    // Resolved rather than compiled in, so a league-year rollover doesn't leave
    // the crawler refreshing last season's leagues until someone redeploys.
    //
    // It stays *ahead* of the guard's reading, and deliberately: the resolver is
    // memoized for the whole process, so in the steady state this is a field
    // read, and it takes no pool connection, no advisory lock and no league
    // fetch — none of the things a refused tick must not spend. `peekActiveSeason`
    // is not the answer here for the reason its own note gives: `undefined` means
    // "not yet resolved" rather than "no season", and a summary is not worth
    // teaching this function to report one it does not have.
    season = await getActiveSeason(),
    leagueLimit = CRAWL_LEAGUE_BATCH,
    managerLimit = CRAWL_MANAGER_BATCH,
    discoveryCap = CRAWL_DISCOVERY_CAP,
    gate = createCrawlPressureGate(PRESSURE_CONFIG),
  } = options;

  const startedAt = Date.now();

  // Before `pool.connect()` and before the lock. Reading the pool's counters
  // takes no connection — see `poolStats` — so the whole admission decision
  // costs one `process.memoryUsage()` and four integer reads.
  const opening = gate.read({ pool: poolStats() });
  if (!opening.shouldStartTick) {
    // Latched, so the next tick stays conservative until RSS has come all the
    // way back to the resume threshold rather than merely off the stop one.
    gate.yielded();
    return {
      season,
      skipped: "memory",
      seasonType: null,
      leagueTtlMs: null,
      tier: null,
      tickMs: Date.now() - startedAt,
      pressure: idlePressure(opening, gate.config.enabled),
      ...NO_REFRESH,
      ...NO_DISCOVERY,
    };
  }

  // The one mutable thing a tick keeps about pressure: the last reading, so a
  // shift can be recognised and reported once rather than on every check.
  let last = opening;
  const admit: Admit = () => {
    const now = gate.read({ pool: poolStats() });
    // The gate's own config, never the module-level one: a caller may hand over
    // a gate configured differently (a script, a harness), and a line quoting a
    // threshold the reading was not taken against is worse than no line.
    logPressureShift(last, now, gate.config);
    last = now;
    return now.shouldAcceptNewWork ? now.allowedConcurrency : 0;
  };

  // The lock is held for the whole tick so overlapping ticks — and extra app
  // instances, which share one database — don't crawl the same rows twice. The
  // state read sits inside it too: a tick that loses the lock costs Sleeper
  // nothing, which is why the tier fields are null on the locked fallback.
  const summary = await withAdvisoryLock(LOCK_KEYS.crawl, async () => {
    const state = await getNflState();
    // One state read answers both the week and the season it belongs to; the
    // crawl only ever claims the active season's leagues, so this clock never
    // reaches `graph-weeks`' finished-season arm — it is passed through so that
    // no caller of `syncLeagueGraphs` can be the one that forgets.
    const clock: SyncClock = {
      currentWeek: flooredWeek(state),
      activeSeason: state?.season ?? null,
    };
    // One TTL for the whole tick — the stats and the claim must agree on what
    // "due" means, or the numbers reported describe a different queue than the
    // one crawled.
    const { ttlMs, tier } = leagueCrawlTtl(state);
    const refresh = await refreshStaleLeagues(
      season,
      clock,
      leagueLimit,
      ttlMs,
      admit,
    );
    // Re-read rather than reusing the refresh pass's last answer: discovery is
    // held back a band earlier than refresh work, so "may I still admit a
    // league" and "may I start discovering new ones" are different questions
    // even when nothing has moved between them.
    const discoveryPressure = gate.read({ pool: poolStats() });
    logPressureShift(last, discoveryPressure, gate.config);
    last = discoveryPressure;
    const discovery = discoveryPressure.shouldDiscover
      ? await discoverMemberLeagues(
          season,
          clock,
          managerLimit,
          discoveryCap,
          admit,
        )
      : { ...NO_DISCOVERY, deferredForPressure: true };
    return {
      season,
      skipped: null as null,
      seasonType: state?.season_type ?? null,
      leagueTtlMs: ttlMs,
      tier,
      ...refresh,
      ...discovery,
    };
  });

  const tickMs = Date.now() - startedAt;

  if (!summary) {
    return {
      season,
      skipped: "lock",
      seasonType: null,
      leagueTtlMs: null,
      tier: null,
      tickMs,
      pressure: idlePressure(opening, gate.config.enabled),
      ...NO_REFRESH,
      ...NO_DISCOVERY,
    };
  }

  const { remaining, yielded, deferredForPressure, ...tick } = summary;
  // The latch is set by a tick that *stood down*, not by one that merely ran
  // warm: a refresh pass that spent its whole budget at width 1 is the guard
  // working, and holding the next tick back for it would turn a throttle into a
  // pause.
  if (yielded) gate.yielded();

  return {
    ...tick,
    tickMs,
    pressure: {
      enabled: gate.config.enabled,
      startRssMb: opening.rssMb,
      endRssMb: last.rssMb,
      level: last.level,
      startConcurrency: opening.allowedConcurrency,
      endConcurrency: last.allowedConcurrency,
      yielded,
      leaguesRemaining: remaining,
      discoveryDeferred: deferredForPressure,
      poolSaturated: last.pool?.saturated === true,
    },
  };
}
