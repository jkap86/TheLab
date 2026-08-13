/**
 * When a manager's league sync is due, and what "fresh" is allowed to mean.
 *
 * Split out of `sync.ts` and pure — no runtime imports at all, so Node's own
 * runner drives it — because the rule it carries is easy to state and was
 * quietly wrong: **a sync that left leagues behind is not a synced manager.**
 * `manager_syncs` has carried two columns since the crawler landed, with
 * exactly the meanings this module needs, and only one of them was being
 * written honestly:
 *
 * - `attempt_at` — when this manager's list was last *tried*. It is what
 *   throttles the next try, and the crawler's discovery pass stamps it too.
 * - `synced_at` — when the manager's whole league graph was last *completely*
 *   synced. It is what lets a reader be told the list in front of them is
 *   current.
 *
 * `syncManagerLeaguesLocked` used to advance both on every run, including one
 * where a Sleeper timeout dropped three of a hundred leagues — so for the next
 * ten minutes a partial graph was indistinguishable from a complete one, to the
 * route, to the client, and to anything reading the summary. Advancing neither
 * would have been worse: the leagues route decides to refresh on exactly this
 * timestamp, so an upstream failure that never stamps anything is a full
 * ~11-requests-per-league fan-out on *every* request until Sleeper recovers.
 * Hence two timestamps and two questions, which is what the schema already had
 * room for.
 *
 * **{@link leagueRefreshGate} is the same decision at the other grain**, and it
 * lives here rather than in a module of its own because it is the same question
 * — is a sync due — asked of one league instead of a manager's whole graph. What
 * differs is who is asking: the manager gate throttles a read that refreshes
 * *itself*, so its window is a freshness policy, while the league gate stands
 * behind a key somebody pressed, so its window is only there to stop a hammer.
 * Keeping them in one file is what makes that difference legible.
 */

/** How long a **fully successful** sync stays fresh before a re-fetch is due. */
export const SYNC_TTL_MS = 10 * 60 * 1000;

/**
 * How long *any* attempt suppresses the next one, whatever it achieved.
 *
 * Deliberately the same duration as {@link SYNC_TTL_MS} rather than shorter,
 * and that is the whole of the retry-storm protection: before this split, a
 * partial sync stamped `synced_at` and so bought exactly this much quiet, and a
 * manager whose leagues keep half-failing must not start costing more upstream
 * traffic than one whose leagues succeed. It is a separate constant because the
 * two answer different questions and only one of them is about the data being
 * current — a future decision to retry a partial sync sooner is a change to
 * this number alone.
 */
export const SYNC_ATTEMPT_TTL_MS = SYNC_TTL_MS;

/** The two timestamps `manager_syncs` keeps for one manager and season. */
export type ManagerSyncState = {
  /** Last **completely** successful sync, or null if there has never been one. */
  syncedAt: Date | null;
  /** Last attempt of any outcome, or null if this manager has never been tried. */
  attemptAt: Date | null;
};

/** Why a sync was or wasn't run — a log line's worth of the decision below. */
export type SyncGateReason =
  /** Nothing suppresses it: run the fan-out. */
  | "due"
  /** A fully successful sync is still inside {@link SYNC_TTL_MS}. */
  | "fresh"
  /** An attempt is inside {@link SYNC_ATTEMPT_TTL_MS} but did not complete. */
  | "throttled"
  /** Someone else synced or tried while this caller was deciding or queueing. */
  | "raced";

export type SyncGate = {
  /** Whether this caller should run the Sleeper fan-out. */
  run: boolean;
  /**
   * Whether what is **stored** is a complete, current graph — a fully successful
   * sync inside {@link SYNC_TTL_MS}, and nothing else.
   *
   * Deliberately independent of `run` and of `force`: it describes the data, not
   * the decision, so an operator forcing a refresh over a complete graph is
   * still looking at a complete graph until the new one lands.
   */
  complete: boolean;
  reason: SyncGateReason;
};

/**
 * Decide whether a manager's league sync is due.
 *
 * Read by both ends of that decision, which is the point of it being one
 * function: the leagues route asks before it decides to refresh at all, and
 * `syncManagerLeagues` asks again *inside* the per-manager advisory lock, where
 * `requestedAt` is when the caller started queueing rather than now. Two
 * spellings of "is this due" is how a throttle that reads correctly in one place
 * gets bypassed in the other.
 *
 * The order of the tests is the design:
 *
 * 1. **A race is never overridden, not even by `force`.** A timestamp at or
 *    after `requestedAt` means another caller did this work while we waited for
 *    the lock; re-running is the fan-out we queued to avoid. `force` means "the
 *    caller decided a refresh is due", and the winner just did that refresh —
 *    or just tried, which is as good a reason not to try again a millisecond
 *    later.
 * 2. **`force` overrides freshness and the throttle**, which is what an operator
 *    `?refresh=1` is for. It is checked *after* the race tests for that reason.
 * 3. **Freshness before the throttle**, so a complete sync reports `fresh`
 *    rather than the throttle that would also have caught it — the two are
 *    different answers to a caller and to a log.
 */
export function managerSyncGate(
  state: ManagerSyncState | null,
  {
    now,
    requestedAt,
    force = false,
  }: { now: number; requestedAt: number; force?: boolean },
): SyncGate {
  const syncedAt = state?.syncedAt?.getTime() ?? null;
  const attemptAt = state?.attemptAt?.getTime() ?? null;
  const complete = syncedAt !== null && now - syncedAt < SYNC_TTL_MS;

  if (syncedAt !== null && syncedAt >= requestedAt) {
    return { run: false, complete, reason: "raced" };
  }
  if (attemptAt !== null && attemptAt >= requestedAt) {
    return { run: false, complete, reason: "raced" };
  }
  if (force) return { run: true, complete, reason: "due" };
  if (complete) return { run: false, complete, reason: "fresh" };
  if (attemptAt !== null && now - attemptAt < SYNC_ATTEMPT_TTL_MS) {
    return { run: false, complete, reason: "throttled" };
  }
  return { run: true, complete, reason: "due" };
}

/**
 * How long one league's on-demand refresh suppresses the next one.
 *
 * **Short, and short on purpose — this is a hammer bound, not a freshness
 * policy.** The whole point of the key behind it is that a manager sets a lineup
 * in Sleeper, comes back and presses it, so a window sized like
 * {@link SYNC_TTL_MS} would refuse exactly the press it exists to serve. What it
 * has to stop is a held-down key (or a wedged client) turning into a
 * ~11-request fan-out per press, and fifteen seconds does that while leaving the
 * round trip through Sleeper's app comfortably clear.
 *
 * It is deliberately *not* the crawler's TTL either. That one answers "how
 * often is this league worth re-reading on nobody's behalf"; this one answers
 * "how often may somebody ask", and a reader who has just changed something
 * knows more about whether a re-read is worth it than any interval does.
 */
export const LEAGUE_REFRESH_COOLDOWN_MS = 15 * 1000;

/** What `leagues` knows about when one league was last read from Sleeper. */
export type LeagueRefreshState = {
  /** Last **successful** graph write, or null for a row with no graph behind it. */
  updatedAt: Date | null;
  /**
   * Last attempt of any outcome — stamped by this refresh and by the crawler as
   * it claims a batch, which is what makes it the honest thing to throttle on:
   * either way somebody asked Sleeper about this league moments ago.
   */
  attemptAt: Date | null;
};

/** Why a league refresh was or wasn't run. */
export type LeagueRefreshReason =
  /** Nothing suppresses it: re-read the league. */
  | "due"
  /** Another refresh landed while this caller queued on the lock. */
  | "raced"
  /** An attempt is still inside {@link LEAGUE_REFRESH_COOLDOWN_MS}. */
  | "cooldown";

export type LeagueRefreshGate = {
  /** Whether this caller should re-read the league from Sleeper. */
  run: boolean;
  reason: LeagueRefreshReason;
  /**
   * How long until a refused caller would be accepted, in ms — 0 when it wasn't
   * refused, and 0 for a race, which is refused because the work is *already
   * done* rather than because it is too soon to do it.
   */
  retryAfterMs: number;
};

/**
 * Decide whether one league is worth re-reading from Sleeper right now.
 *
 * Asked **inside** the per-league advisory lock and nowhere else, which is the
 * one place it differs in shape from {@link managerSyncGate}: that gate is asked
 * twice because the route ahead of it decides whether to open a stream at all,
 * and this one has no such caller — the press *is* the decision, and everything
 * before the lock would only be re-deciding it against a state the lock's winner
 * is about to change.
 *
 * The two arms in order:
 *
 * 1. **A race is a success, not a refusal.** An attempt at or after
 *    `requestedAt` means another presser (a second tab, a second reader of the
 *    same league) ran the fan-out while this one waited on the lock, so what is
 *    stored is what this caller queued for. Re-running is the duplicate work the
 *    lock exists to prevent, and reporting it as a throttle would tell a reader
 *    their data is stale at the exact moment it is freshest.
 * 2. **Otherwise the cooldown**, measured from the last attempt of any outcome.
 *    A failed attempt buys the same quiet as a successful one — the same rule
 *    `attempt_at` carries one grain up — because a league Sleeper is currently
 *    failing on is the last one worth being asked about repeatedly.
 */
export function leagueRefreshGate(
  state: LeagueRefreshState | null,
  { now, requestedAt }: { now: number; requestedAt: number },
): LeagueRefreshGate {
  const attemptAt = state?.attemptAt?.getTime() ?? null;

  if (attemptAt !== null && attemptAt >= requestedAt) {
    return { run: false, reason: "raced", retryAfterMs: 0 };
  }
  if (attemptAt !== null && now - attemptAt < LEAGUE_REFRESH_COOLDOWN_MS) {
    return {
      run: false,
      reason: "cooldown",
      // Never negative: the arm above has already excluded a future stamp, but
      // a clock that moved between the read and this arithmetic must not hand a
      // client a `Retry-After` it reads as "immediately" by wrapping.
      retryAfterMs: Math.max(0, LEAGUE_REFRESH_COOLDOWN_MS - (now - attemptAt)),
    };
  }
  return { run: true, reason: "due", retryAfterMs: 0 };
}

/**
 * Stamp a league's refresh attempt: `$1` league.
 *
 * Only `sync_attempt_at` — `updated_at` is what says a graph was written, and
 * `persistLeagueGraph` owns it. Written *before* the fetch rather than after, so
 * a refresh that fails at Sleeper still holds the cooldown: a league that cannot
 * be read is the one a retrying client would ask about hardest.
 *
 * The column is the crawler's own, reused rather than duplicated, and both
 * readings survive: a league somebody just refreshed rotates to the back of its
 * priority tier, which is the right answer — it is the least stale thing in the
 * queue.
 */
export const LEAGUE_REFRESH_ATTEMPT_SQL = `
  UPDATE leagues SET sync_attempt_at = now() WHERE league_id = $1`;

/**
 * Record a sync attempt: `$1` user, `$2` season, `$3` whether it completed.
 *
 * `attempt_at` advances unconditionally — that is what the next caller's
 * throttle reads, so a failed run has to move it or the failure becomes a retry
 * loop. `synced_at` advances **only** on a complete run and otherwise keeps
 * whatever it held, so a manager who was fully synced an hour ago and partially
 * synced a minute ago still reports the hour-old success rather than losing it.
 *
 * A string constant rather than an inline query for the reason
 * `staleLeagueClaimSql` is one: the conditional half is invisible to a type and
 * exactly the kind of thing a later edit flattens back to `synced_at = now()`.
 */
export const MANAGER_SYNC_STAMP_SQL = `
  INSERT INTO manager_syncs (user_id, season, synced_at, attempt_at)
  VALUES ($1, $2, CASE WHEN $3::boolean THEN now() ELSE NULL END, now())
  ON CONFLICT (user_id, season) DO UPDATE
     SET attempt_at = now(),
         synced_at = CASE WHEN $3::boolean THEN now()
                          ELSE manager_syncs.synced_at END`;
