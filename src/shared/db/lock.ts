import { pool } from "./pool";

/** A Postgres advisory lock key: the two-int `(classid, objid)` form. */
export type AdvisoryLockKey = readonly [number, number];

/**
 * The class ids reserved for locks whose *identity is data*, one class each.
 *
 * A per-key lock is computed rather than listed — you cannot enumerate every
 * manager ahead of time — so what is reserved here is the class id rather than
 * the pair. The ids match TheLabX's, so the two apps pointed at one database
 * contend where they should and nowhere else. Class 8675309 is that app's block
 * of fixed loop locks and 8675311 its per-league class; both arrive with the
 * crawler and the per-league refresh press.
 */
const HASHED_LOCK_CLASSES = {
  /** {@link managerSyncLockKey} — a manager's whole league graph. */
  managerSync: 8675310,
} as const;

/**
 * FNV-1a folded to a signed int32, which is the width `pg_advisory_lock`'s
 * two-int form takes.
 *
 * Collisions inside a class are possible and cost only an unnecessary wait —
 * two unrelated ids taking turns — never a correctness failure, since what the
 * lock protects is duplicated work rather than a shared row.
 */
function hashedLockKey(classId: number, id: string): AdvisoryLockKey {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return [classId, hash | 0];
}

/** Thrown by {@link withBlockingAdvisoryLock} when the wait budget runs out. */
export class AdvisoryLockTimeoutError extends Error {
  constructor(key: AdvisoryLockKey, waitMs: number) {
    super(`Timed out after ${waitMs}ms waiting for advisory lock ${key.join(",")}`);
    this.name = "AdvisoryLockTimeoutError";
  }
}

/**
 * How long a blocking lock waits before giving up.
 *
 * The wait is what costs: a queued caller holds one pool connection the whole
 * time, so an unbounded wait turns a slow upstream into pool exhaustion — one
 * stuck sync per distinct key, and the keys are per manager. Long enough that
 * an ordinary league sync ahead of us finishes and we serve its data (the whole
 * point of blocking rather than skipping), short enough that a wedged one is
 * bounded.
 *
 * Half of a 30s request deadline rather than all of it: a caller that waited
 * the whole deadline for a lock would have no time left to send what it waited
 * for, so even a wait that succeeded produced a request the client had already
 * been told had failed.
 */
export const ADVISORY_LOCK_WAIT_MS = 15_000;

/** Postgres `lock_not_available` — what `lock_timeout` raises. */
const LOCK_NOT_AVAILABLE = "55P03";

/**
 * Postgres `query_canceled` — what `statement_timeout` raises.
 *
 * The pool sets a statement timeout on every connection, and the acquisition
 * below is a statement like any other, so a wait can be cut by either bound.
 * `lock_timeout` is the shorter of the two, so in practice this is the one that
 * never fires — it is mapped anyway because the alternative is a caller that is
 * bounded correctly and reports it as an unexplained database error, which is
 * exactly the outcome `SyncSummary.locked` exists to prevent.
 */
const QUERY_CANCELED = "57014";

/**
 * Run `fn` while holding a Postgres advisory lock, waiting for it rather than
 * skipping — for work a caller needs the *result* of, not just done. Waiting
 * happens server-side in `pg_advisory_lock`, so a queued caller costs one idle
 * pool connection and no polling. Use where the contended work is per-key and
 * short-lived (a manager's league sync), not for a background loop — a loop
 * that queues behind another instance instead of skipping would stack ticks.
 *
 * The wait is bounded by `lock_timeout` (see {@link ADVISORY_LOCK_WAIT_MS}) and
 * a caller that runs out gets {@link AdvisoryLockTimeoutError} rather than
 * holding its connection indefinitely. `lock_timeout` applies to advisory locks
 * exactly as it does to row locks, so this is the server doing the timing — no
 * polling loop and no timer racing a query.
 */
export async function withBlockingAdvisoryLock<T>(
  [classId, objId]: AdvisoryLockKey,
  fn: () => Promise<T>,
  options: { waitMs?: number } = {},
): Promise<T> {
  const { waitMs = ADVISORY_LOCK_WAIT_MS } = options;
  const client = await pool.connect();
  let unlockFailed = false;

  try {
    try {
      // Bounded here rather than around the whole call: only the *acquisition*
      // should time out. `fn`'s own queries run on other pool connections and
      // are unaffected either way, but the setting is reset below so this
      // connection goes back to the pool as it came out.
      await client.query(`SET lock_timeout = ${Math.max(1, Math.trunc(waitMs))}`);
      await client.query(`SELECT pg_advisory_lock($1::int, $2::int)`, [
        classId,
        objId,
      ]);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === LOCK_NOT_AVAILABLE || code === QUERY_CANCELED) {
        throw new AdvisoryLockTimeoutError([classId, objId], waitMs);
      }
      throw error;
    } finally {
      // Best-effort: a failure here can only mean the connection is already
      // unusable, which `release`/`fn` will surface on its own.
      await client.query(`RESET lock_timeout`).catch(() => {});
    }
    try {
      return await fn();
    } finally {
      // Same discipline as above: a session lock outlives release(), so a
      // failed unlock must drop the connection or hold the key forever.
      try {
        await client.query(`SELECT pg_advisory_unlock($1::int, $2::int)`, [
          classId,
          objId,
        ]);
      } catch (error) {
        unlockFailed = true;
        console.error("[db] Advisory unlock failed; dropping connection:", error);
      }
    }
  } finally {
    client.release(unlockFailed);
  }
}

/** One lock per manager, around their whole league graph's sync. */
export function managerSyncLockKey(userId: string): AdvisoryLockKey {
  return hashedLockKey(HASHED_LOCK_CLASSES.managerSync, userId);
}
