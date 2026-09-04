/**
 * Re-reading one league from Sleeper, because a reader asked.
 *
 * Everything else that fills the league graph is a *background* decision: the
 * manager sync runs because a page was opened, and the crawler runs because a
 * clock ticked. Both are throttled on the assumption that nobody is waiting and
 * nothing has just changed — the manager grain buys ten minutes of quiet, the
 * crawler's live tier fifteen. This is the one path where both assumptions are
 * false: somebody moved a player in Sleeper's own app and pressed a key that
 * says *re-read this*, and the whole feature is that the key is believed.
 *
 * **Four bounds, and none of them is redundant.** Each answers a question the
 * others cannot, which is worth stating because any one of them read alone looks
 * like it covers the next:
 *
 * 1. **The league must already be stored.** A press cannot grow the corpus —
 *    that is discovery's job, and a route that fetched arbitrary league ids into
 *    the database on request is an open write endpoint wearing a refresh button.
 * 2. **Process-wide admission** ({@link leagueRefreshAdmission}), which bounds
 *    how many of these sessions exist at once. `tryAcquire` rather than a queue,
 *    the `sync-admission` rule: every caller is holding a response open, so a
 *    refused press must be told so rather than parked.
 * 3. **A per-league advisory lock**, which is the only one of the four that
 *    survives a second instance. Two tabs — or two machines — pressing one
 *    league are one fan-out, and the loser is told the truth about it.
 * 4. **The cooldown gate** ({@link leagueRefreshGate}), inside that lock, which
 *    is what stops one intention from becoming several fan-outs.
 *
 * It **throws only on a database failure**. Everything Sleeper can do — a
 * timeout, a 404, a half-answered graph — comes back as a status, which is what
 * lets the route answer 200 to all of them: a cooldown and a race are outcomes
 * rather than errors, and a 4xx would put a red note on a perfectly current
 * league.
 */

import {
  AdvisoryLockTimeoutError,
  leagueSyncLockKey,
  pool,
  withBlockingAdvisoryLock,
} from "@/shared/db";
import { cacheBustToken, getLeague } from "@/shared/sleeper";
import { errorMessage } from "@/shared/util";

import { markLeaguesAccessed, markLeaguesGone } from "./crawl-queue";
import { leagueRefreshAdmission } from "./league-refresh-admission";
import { getSyncClock, refreshedLeagues, syncLeagueGraphs } from "./sync";
import {
  LEAGUE_REFRESH_ATTEMPT_SQL,
  leagueRefreshGate,
  type LeagueRefreshState,
} from "./sync-freshness";

/**
 * What one press did, or why it did nothing.
 *
 * `updatedAt` rides **every** arm but `gone` and `unknown`, and that is the
 * point of the union's shape: a refused press has exactly one honest thing to
 * say, which is when the data it is declining to replace was written. A `gone`
 * league has no such data worth quoting and an `unknown` one has no row at all.
 */
export type LeagueRefreshResult =
  /** The graph was re-read from Sleeper and written whole. */
  | { status: "synced"; updatedAt: Date | null }
  /**
   * Somebody else's fan-out landed while this press queued on the lock. The
   * data the reader wanted is there — this is a success, not a refusal, and it
   * is why {@link leagueRefreshGate}'s race arm reports no wait.
   */
  | { status: "fresh"; updatedAt: Date | null }
  /** Pressed again inside {@link LEAGUE_REFRESH_COOLDOWN_MS}. */
  | { status: "cooldown"; updatedAt: Date | null; retryAfterMs: number }
  /** No permit, or the lock wait ran out. Somebody is doing this work. */
  | { status: "locked"; updatedAt: Date | null }
  /** Sleeper no longer serves this league; it has been tombstoned. */
  | { status: "gone" }
  /** Nothing stored under this id. The route answers 404. */
  | { status: "unknown" }
  /** Sleeper was reached and the graph did not come back whole. */
  | { status: "failed"; updatedAt: Date | null };

/**
 * The two timestamps a press reads, or null when no such league is stored.
 *
 * `updated_at` is `NOT NULL` in the schema, so the null this can return is
 * "there is no row", never "the row has no value" — which is exactly the
 * distinction the `unknown` arm turns on.
 */
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
  return { updatedAt: row.updated_at, attemptAt: row.sync_attempt_at };
}

/**
 * Re-read one league from Sleeper and persist it.
 *
 * `requestedAt` is captured **before the lock is taken**, and that single line
 * is what makes the gate's race arm mean anything: it is the difference between
 * a caller who queued behind somebody else's refresh — and should be handed
 * their result — and one who simply pressed the key twice.
 */
export async function refreshLeague(
  leagueId: string,
): Promise<LeagueRefreshResult> {
  // Asked before the permit so a press at an id we hold nothing for cannot
  // spend one, and so the 404 costs nothing but an indexed lookup.
  if (!(await getLeagueRefreshState(leagueId))) return { status: "unknown" };

  const permit = leagueRefreshAdmission.tryAcquire();
  if (!permit) {
    console.warn(
      `[league-refresh] ${leagueId} shed; ` +
        `${leagueRefreshAdmission.stats().active} refreshes already running.`,
    );
    // `locked` rather than a status of its own: from the reader's side "somebody
    // is doing this work, try again" is the same news whether the queue is this
    // process's or another instance's, and a second word for it would be a
    // distinction only an operator can act on — and they have the log line.
    return { status: "locked", updatedAt: null };
  }

  const requestedAt = Date.now();
  try {
    return await withBlockingAdvisoryLock(leagueSyncLockKey(leagueId), () =>
      refreshLeagueLocked(leagueId, requestedAt),
    );
  } catch (error) {
    if (!(error instanceof AdvisoryLockTimeoutError)) throw error;
    console.warn(
      `[league-refresh] ${leagueId} is already syncing elsewhere; skipped.`,
    );
    return { status: "locked", updatedAt: null };
  } finally {
    permit();
  }
}

/** The body of a press, with the lock held. */
async function refreshLeagueLocked(
  leagueId: string,
  requestedAt: number,
): Promise<LeagueRefreshResult> {
  // Re-read inside the lock rather than reusing the row from `refreshLeague`:
  // that one was fetched before the wait, and the whole question this gate
  // answers is what happened *during* it.
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

  // Stamped **before** the fetch. A press that Sleeper fails must still hold its
  // own cooldown and still rotate this league to the back of the crawler's
  // queue; stamped after, a league that always fails is re-pressable instantly
  // and answers the same way every time.
  await pool.query(LEAGUE_REFRESH_ATTEMPT_SQL, [leagueId]);

  // A press is *observed* demand, which is precisely what `last_accessed_at`
  // means and what puts this league in the crawler's `demanded` tier. The rule
  // it must not break is the crawler's own — that a refresh pass never stamps
  // what it refreshes — and this is not that: somebody asked for this league by
  // name. Fire-and-forget, like the manager sync's own call: a scheduling hint
  // that fails costs a place in a queue, not the press its answer.
  void markLeaguesAccessed([leagueId]).catch((error: unknown) => {
    console.warn(
      `[league-refresh] could not stamp demand for ${leagueId}:`,
      errorMessage(error),
    );
  });

  // One token for the whole press, so the ~11 requests below read one instant.
  const fresh = cacheBustToken();

  let league;
  try {
    // Doubles as the "is it gone" probe — the same fold `reconcileUnlistedLeagues`
    // and the crawler rely on, and the reason this is not folded into
    // `syncLeagueGraphs`: that function takes leagues, and finding out whether
    // there still is one is a different question.
    league = await getLeague(leagueId, fresh);
  } catch (error) {
    console.warn(
      `[league-refresh] could not read league ${leagueId}:`,
      errorMessage(error),
    );
    return { status: "failed", updatedAt: state.updatedAt };
  }

  if (!league) {
    // Tombstoned so the crawler's queue stops claiming it: an unmarked deleted
    // league is due forever and burns a slot plus a request every rotation.
    await markLeaguesGone([leagueId]);
    return { status: "gone" };
  }

  const result = await syncLeagueGraphs([league], await getSyncClock(), {
    concurrency: 1,
    fresh,
  });

  // **Persisted is not refreshed.** A graph missing a mandatory collection kept
  // its stored rows rather than being wiped — the right write — and reporting
  // that as a success would have the card redraw the numbers it already had
  // under a key claiming Sleeper had just confirmed them. The previous
  // `updatedAt` is the honest one, because `persistLeagueGraph` did not move it.
  if (refreshedLeagues(result) !== 1) {
    return { status: "failed", updatedAt: state.updatedAt };
  }

  console.info(
    `[league-refresh] ${leagueId} re-read from Sleeper ` +
      `(${result.counts.rosters} rosters, ${result.counts.matchups} matchup rows, _=${fresh})`,
  );
  return { status: "synced", updatedAt: new Date() };
}
