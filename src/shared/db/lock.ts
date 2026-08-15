import { databaseBudget } from "./budget";
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
  /** Precomputed trade-board counts (`shared/trades/stats.ts`). */
  tradeStats: [8675309, 6],
  /** Weekly actual stat lines sync (`shared/stats/sync.ts`). */
  playerStats: [8675309, 7],
  /** NFL draft crosswalk refresh (`shared/nfl-draft/sync.ts`). */
  nflDraft: [8675309, 8],
} as const satisfies Record<string, AdvisoryLockKey>;

/**
 * The class ids reserved for locks whose *identity is data*, one class each.
 *
 * A per-key lock is computed rather than listed — you cannot enumerate every
 * manager or every league in {@link LOCK_KEYS} ahead of time — so what is
 * reserved here is the class id rather than the pair. Two classes and not one:
 * a manager id and a league id are both digit strings out of Sleeper, so a
 * single class would let one manager's sync and one league's refresh contend on
 * a hash collision between two ids that have nothing to do with each other.
 */
const HASHED_LOCK_CLASSES = {
  /** {@link managerSyncLockKey} — a manager's whole league graph. */
  managerSync: 8675310,
  /** {@link leagueSyncLockKey} — one league's graph, refreshed on demand. */
  leagueSync: 8675311,
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
 * A share of the platform's request deadline rather than a number of its own
 * (see `./budget`), because it used to *be* that deadline: a caller waiting the
 * router's whole 30 seconds for a lock had no time left to send what it waited
 * for, so even a wait that succeeded produced a request the client had already
 * been told had failed.
 */
export const ADVISORY_LOCK_WAIT_MS = databaseBudget().lockWaitMs;

/** Postgres `lock_not_available` — what `lock_timeout` raises. */
const LOCK_NOT_AVAILABLE = "55P03";

/**
 * Postgres `query_canceled` — what `statement_timeout` raises.
 *
 * The pool sets a statement timeout on every connection, and the acquisition
 * below is a statement like any other, so a wait can be cut by either bound.
 * The budget keeps `lock_timeout` the shorter of the two, so in practice this
 * is the one that never fires — it is mapped anyway because the alternative is
 * a caller that is bounded correctly and reports it as an unexplained database
 * error, which is exactly the outcome `SyncSummary.locked` exists to prevent.
 */
const QUERY_CANCELED = "57014";

/**
 * Run `fn` while holding a Postgres advisory lock, waiting for it rather than
 * skipping — the counterpart to {@link withAdvisoryLock} for work a caller
 * needs the *result* of, not just done. Waiting happens server-side in
 * `pg_advisory_lock`, so a queued caller costs one idle pool connection and no
 * polling. Use where the contended work is per-key and short-lived (a
 * manager's league sync), not for the background loops — a loop that queues
 * behind another instance instead of skipping would stack ticks.
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

/**
 * One lock per league, around a single league's graph.
 *
 * Taken by the on-demand refresh behind the league panel's sync key, and taken
 * *blocking* for that caller's reason: a second reader pressing it while a
 * refresh runs wants the answer, not merely the work done, so it queues and
 * serves what the winner just wrote rather than starting a second fan-out at
 * the same league.
 *
 * It deliberately does **not** coordinate with the crawler's refresh pass, which
 * claims leagues in a batch under {@link LOCK_KEYS.leagueCrawl}: the two writers
 * of one league's graph write the same rows from the same upstream, so the worst
 * an overlap costs is a duplicated fetch. Widening the crawler to take a lock per
 * league in its batch would put that many held sessions on one tick, which is the
 * pool problem the batch size exists to bound.
 */
export function leagueSyncLockKey(leagueId: string): AdvisoryLockKey {
  return hashedLockKey(HASHED_LOCK_CLASSES.leagueSync, leagueId);
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
