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
