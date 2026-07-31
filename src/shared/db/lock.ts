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
  /** Sleeper players-map refresh (`shared/players/sync.ts`). */
  players: [8675309, 5],
} as const satisfies Record<string, AdvisoryLockKey>;

/**
 * The per-manager league sync's lock key: one lock per manager, in a class of
 * its own so hashed ids can't collide with the fixed keys above. The hash is
 * FNV-1a folded to a signed int32 — collisions across managers are possible and
 * only cost an unnecessary skip, never a correctness failure.
 */
/**
 * Run `fn` while holding a Postgres advisory lock, waiting for it rather than
 * skipping — the counterpart to {@link withAdvisoryLock} for work a caller
 * needs the *result* of, not just done. Waiting happens server-side in
 * `pg_advisory_lock`, so a queued caller costs one idle pool connection and no
 * polling. Use where the contended work is per-key and short-lived (a
 * manager's league sync), not for the background loops — a loop that queues
 * behind another instance instead of skipping would stack ticks.
 */
export async function withBlockingAdvisoryLock<T>(
  [classId, objId]: AdvisoryLockKey,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let unlockFailed = false;

  try {
    await client.query(`SELECT pg_advisory_lock($1::int, $2::int)`, [
      classId,
      objId,
    ]);
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

export function managerSyncLockKey(userId: string): AdvisoryLockKey {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return [8675310, hash | 0];
}

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
