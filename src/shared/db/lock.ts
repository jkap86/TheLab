import { pool } from "./pool";

/** A Postgres advisory lock key: the two-int `(classid, objid)` form. */
export type AdvisoryLockKey = readonly [number, number];

/**
 * Every advisory lock the app takes, listed together so two loops can't
 * silently pick the same pair. The first int namespaces the app (an arbitrary
 * constant); the second identifies the loop.
 */
export const LOCK_KEYS = {
  /** One tick of the background league crawl (`shared/manager/crawl.ts`). */
  leagueCrawl: [8675309, 1],
  /** KeepTradeCut dynasty values refresh (`shared/ktc/sync.ts`). */
  ktcValues: [8675309, 2],
  /** KeepTradeCut per-player history backfill (`shared/ktc/history.ts`). */
  ktcHistory: [8675309, 3],
  /** Weekly projections sync (`shared/projections/sync.ts`). */
  projections: [8675309, 4],
} as const satisfies Record<string, AdvisoryLockKey>;

/**
 * Run `fn` while holding a Postgres advisory lock, or return `null` immediately
 * if someone else holds it.
 *
 * The lock is taken with `pg_try_advisory_lock`, so this never waits — a caller
 * that loses the race skips this round rather than queueing up behind the
 * winner. Because the lock lives in Postgres rather than in process memory, it
 * also coordinates across app instances sharing one database, which is what
 * keeps extra dynos from multiplying the load on Sleeper and KTC.
 *
 * A `null` result means "someone else is already doing this", not "it failed".
 */
export async function withAdvisoryLock<T>(
  [classId, objId]: AdvisoryLockKey,
  fn: () => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  let unlockFailed = false;

  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::int, $2::int) AS locked`,
      [classId, objId],
    );
    if (!rows[0].locked) return null;

    try {
      return await fn();
    } finally {
      // Session-level locks outlive `release()` — a pooled client keeps its
      // session open — so a failed unlock would hold this lock forever and
      // wedge the loop for good. Drop the connection instead: ending the
      // session releases everything it held. Logged rather than rethrown so it
      // can't mask `fn`'s result or its error.
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
