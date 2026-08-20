import {
  AdvisoryLockTimeoutError,
  leagueSyncLockKey,
  pool,
  withBlockingAdvisoryLock,
} from "@/shared/db";
import { cacheBustToken, getLeague } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { markLeaguesGone } from "./crawl-queue";
import { leagueRefreshAdmission } from "./league-refresh-admission";
import { getCurrentWeek, syncLeagueGraphs } from "./sync";
import {
  LEAGUE_REFRESH_ATTEMPT_SQL,
  leagueRefreshGate,
  type LeagueRefreshState,
} from "./sync-freshness";

/**
 * Re-read **one** league from Sleeper because somebody asked for it.
 *
 * **Why this exists beside the crawler that already refreshes every league.**
 * That loop is a capacity promise — fifteen leagues a minute, so a league is
 * current to within its seasonal TTL — and a TTL is the wrong instrument for the
 * one thing a reader cannot wait out: they have just changed a lineup in
 * Sleeper's own app and come back to see it. Nothing about the crawl can be
 * tuned to serve that (shortening the TTL to seconds is the corpus times
 * eleven requests, every minute, for one reader's benefit), so the answer is a
 * refresh that happens *because it was asked for* and costs one league's graph.
 *
 * It is the third write path into `leagues` and the smallest. What it shares
 * with the other two is everything below the fetch: {@link syncLeagueGraphs} is
 * the same function the manager sync and the crawler's refresh pass call, so a
 * league refreshed here is written by the same code, gated on the same stored
 * week tails, and reconciled by the same guards. What differs is only who
 * decided and how it is bounded.
 *
 * **Four bounds, and none of them is redundant.** They are listed together
 * because reading any one alone makes the others look like belt and braces:
 *
 * - **The league must already be stored.** A refresh is not a way to make this
 *   app fetch an arbitrary league id off Sleeper; it re-reads something the
 *   corpus already holds, which is the only surface a reader can point it at.
 *   An unknown id answers `unknown` rather than growing the corpus.
 * - **A per-league advisory lock**, and a *blocking* one, because a caller wants
 *   the result rather than the work merely done — two tabs on one league are one
 *   fan-out and both get its answer. It also coordinates across dynos, which the
 *   other two bounds cannot.
 * - **A cooldown inside that lock** ({@link leagueRefreshGate}), which is what
 *   stops a held-down key from being a fan-out per press.
 * - **A process-wide admission** ({@link leagueRefreshAdmission}), because the
 *   lock is per league and a hundred different leagues is a hundred locks that
 *   never contend — each holding a pool connection across a Sleeper fan-out.
 *   That is the same arithmetic `shared/manager/sync-admission` spells out one
 *   grain up, and the failure it names (a role's connection limit, reached by a
 *   fan-out nobody chose the width of) is exactly what an unbounded public write
 *   route would reproduce.
 */

/** What a refresh did, and what a caller may tell a reader about it. */
export type LeagueRefreshResult =
  /** Re-read from Sleeper and written. */
  | { status: "synced"; updatedAt: Date | null }
  /**
   * Another caller refreshed this league while this one queued on the lock, so
   * what is stored *is* what this caller asked for. A success wearing a
   * different name, never a refusal — see {@link leagueRefreshGate}.
   */
  | { status: "fresh"; updatedAt: Date | null }
  /** Inside the cooldown: nothing was fetched, try again in `retryAfterMs`. */
  | { status: "cooldown"; updatedAt: Date | null; retryAfterMs: number }
  /** The lock's holder outran the wait; they are still writing. */
  | { status: "locked"; updatedAt: Date | null }
  /** Sleeper no longer serves this league; the row is tombstoned. */
  | { status: "gone" }
  /** Not a league this app stores. */
  | { status: "unknown" }
  /** Sleeper answered badly, or the graph failed to persist. */
  | { status: "failed"; updatedAt: Date | null };

/**
 * The bound and the limiter live in `./league-refresh-admission`, which imports
 * nothing this module's I/O drags in, so the clamp on `LEAGUE_REFRESH_LIMIT` is
 * assertable by Node's test runner. Re-exported here because this is where the
 * bound is spent and where every caller already looks for it.
 */
export {
  LEAGUE_REFRESH_LIMIT_VAR,
  leagueRefreshAdmission,
  leagueRefreshConcurrency,
  leagueRefreshLimit,
} from "./league-refresh-admission";

/** When this league was last read from Sleeper, or null if we don't store it. */
export async function getLeagueRefreshState(
  leagueId: string,
): Promise<LeagueRefreshState | null> {
  const { rows } = await pool.query<{
    updated_at: Date | null;
    sync_attempt_at: Date | null;
  }>(
    `SELECT updated_at, sync_attempt_at FROM leagues WHERE league_id = $1`,
    [leagueId],
  );
  const row = rows[0];
  if (!row) return null;
  return { updatedAt: row.updated_at ?? null, attemptAt: row.sync_attempt_at ?? null };
}

/**
 * Re-read one league's graph from Sleeper and persist it.
 *
 * Throws only on a **database** failure, which is what lets the route above
 * answer those the way every other read does (a busy pool is a 503 the client
 * may retry, not a 500 telling it to stop). Everything Sleeper can do to this —
 * a timeout, a bad answer, a league it has dropped — comes back as a status,
 * because each of those is something a reader can be told rather than an
 * unexplained failure.
 */
export async function refreshLeague(
  leagueId: string,
): Promise<LeagueRefreshResult> {
  // Before the permit and before the lock: an id this app doesn't store is not
  // work to be admitted or queued for, and answering it early is what keeps a
  // stream of unknown ids from occupying either bound.
  if (!(await getLeagueRefreshState(leagueId))) return { status: "unknown" };

  const permit = leagueRefreshAdmission.tryAcquire();
  if (!permit) {
    // Non-queueing, the admission rule one grain up: a caller that waited would
    // hold its response open through a wait the platform's deadline may end
    // first. Reported as `locked` — "somebody is refreshing, read this again
    // shortly" — which is the same thing the lock timeout means to a reader and
    // is the honest claim either way: nothing was stamped, so the next press is
    // the retry.
    console.warn(
      `[league-refresh] ${leagueId} shed; ` +
        `${leagueRefreshAdmission.stats().active} refreshes already running.`,
    );
    return { status: "locked", updatedAt: null };
  }

  // Read *before* the lock is taken, so the gate below can tell a caller that
  // queued behind a refresh from one that simply pressed too soon.
  const requestedAt = Date.now();
  try {
    return await withBlockingAdvisoryLock(leagueSyncLockKey(leagueId), () =>
      refreshLeagueLocked(leagueId, requestedAt),
    );
  } catch (error) {
    if (!(error instanceof AdvisoryLockTimeoutError)) throw error;
    console.warn(
      `[league-refresh] ${leagueId} is already refreshing elsewhere; skipped.`,
    );
    // The holder is mid-write, so what is stored right now is whatever they have
    // committed — never presented as a finished refresh, the rule
    // `SyncSummary.locked` carries.
    return { status: "locked", updatedAt: null };
  } finally {
    permit();
  }
}

async function refreshLeagueLocked(
  leagueId: string,
  requestedAt: number,
): Promise<LeagueRefreshResult> {
  const state = await getLeagueRefreshState(leagueId);
  if (!state) return { status: "unknown" };

  const gate = leagueRefreshGate(state, { now: Date.now(), requestedAt });
  if (!gate.run) {
    return gate.reason === "raced"
      ? { status: "fresh", updatedAt: state.updatedAt }
      : {
          status: "cooldown",
          updatedAt: state.updatedAt,
          retryAfterMs: gate.retryAfterMs,
        };
  }

  // Stamped before the fetch, so a league Sleeper is failing on holds the
  // cooldown too — see {@link LEAGUE_REFRESH_ATTEMPT_SQL}.
  await pool.query(LEAGUE_REFRESH_ATTEMPT_SQL, [leagueId]);

  /**
   * One cache-busting token for this press, on every request it fans out to.
   *
   * **Without it this whole path can be a no-op that reports success.** Sleeper
   * is behind a CDN, so a roster read seconds after somebody set a lineup can be
   * answered from an edge copy minted before they did — and every layer below
   * would then behave perfectly: a 200 with the old starters is persisted as the
   * league's current state, `updated_at` advances, the panel refetches, and the
   * reader sees exactly what they saw before pressing. That is the one failure
   * this route cannot distinguish from working, which is why the token is minted
   * here rather than left as something a caller may pass.
   *
   * It is minted **once** and shared by the ~11 requests below, so a press is one
   * group in an access log rather than eleven unrelated ones. The refresh's own
   * cooldown is seconds wide, so two presses can never mint the same millisecond
   * and re-request a URL the edge has already answered.
   */
  const fresh = cacheBustToken();

  // The league itself is re-read rather than replayed from our row, the
  // crawler's own reason: name, status, settings and scoring drift, and the
  // persisted row comes from this payload. It is also the probe — a null answer
  // is Sleeper's 200-with-null (404 folded in) for a league it has dropped, and
  // it carries the token too, or the answer deciding whether to tombstone a
  // league could be a cached one.
  let league;
  try {
    league = await getLeague(leagueId, fresh);
  } catch (error) {
    console.warn(
      `[league-refresh] could not fetch league ${leagueId}:`,
      errorMessage(error),
    );
    return { status: "failed", updatedAt: state.updatedAt };
  }

  if (!league) {
    // The refresh pass's own answer to the same probe: tombstone it so the queue
    // stops claiming it. The row and its drafts stay — they still feed ADP — and
    // a later sync that finds the league alive clears the marker.
    await markLeaguesGone([leagueId]);
    return { status: "gone" };
  }

  const currentWeek = await getCurrentWeek();
  const result = await syncLeagueGraphs([league], currentWeek, {
    concurrency: 1,
    fresh,
  });

  // `syncLeagueGraphs` counts a league's failure rather than throwing it, so the
  // count is what says whether anything was written. `updated_at` was stamped
  // inside that write, so a successful run reports the moment it happened rather
  // than re-reading a row to be told what it just set.
  if (result.loaded !== 1) return { status: "failed", updatedAt: state.updatedAt };

  // The one success this app logs, and it earns the line: a refresh that fetched
  // stale data and a refresh that never ran look identical from the outside —
  // unchanged rows either way — so this is what separates them without guessing.
  // The roster count says Sleeper answered with a league rather than an empty
  // shell, and the token is the query parameter those requests carried, so the
  // press can be found in an upstream access log. It is bounded by the cooldown,
  // so it cannot become chatter.
  console.info(
    `[league-refresh] ${leagueId} re-read from Sleeper ` +
      `(${result.counts.rosters} rosters, matchup weeks ${result.counts.matchups}, _=${fresh})`,
  );
  return { status: "synced", updatedAt: new Date() };
}
