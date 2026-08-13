/**
 * How much manager synchronisation one process will run at once, and who gets to
 * run it.
 *
 * **Three layers, and each answers a question the others cannot.** They are
 * listed here because reading any one of them alone makes the other two look
 * redundant:
 *
 * - The **process-wide semaphore** in this file bounds *total* manager sync
 *   activity on this instance. Nothing else does: the advisory lock is per
 *   manager, so a hundred different usernames is a hundred locks that never
 *   contend, and the Sleeper limiter bounds what reaches Sleeper rather than how
 *   many syncs are open in front of it — a sync waiting on that queue is still
 *   holding a Postgres session for its advisory lock.
 * - The **per-manager in-flight map** deduplicates the same manager asked for
 *   twice *in this process*, so two tabs are one refresh rather than two that
 *   agree to take turns. It lives here rather than in the route because it is
 *   reserved and released with the permit and the two must not drift apart.
 * - The **advisory lock** inside {@link syncManagerLeagues} coordinates the same
 *   manager across *instances*, which is the only one of the three that survives
 *   a second dyno.
 *
 * What this replaced was a cold-sync counter that guarded exactly one of the two
 * shapes this route takes. A caller with cached leagues to serve skipped it
 * entirely, so any number of *stale* managers could refresh at once — and a
 * refresh is the same ~11-requests-per-league fan-out as a cold sync, holding
 * the same advisory-lock connection for its whole duration. With the pool's
 * default of ten, enough concurrent stale refreshes take every connection and
 * then stall the persistence those very syncs are queued to do.
 *
 * Pure: the limiter is a counting semaphore and the budget arrives as an
 * argument, both imported relatively with a `.ts` extension so Node's test
 * runner can resolve the chain. The bound is therefore asserted as a *count* of
 * concurrent reservations rather than inferred from a comment.
 */

import { databaseBudget, type DatabaseBudget } from "../db/budget.ts";
import { createLimiter, type LimiterStats } from "../sleeper/limiter.ts";

/**
 * Why a caller was refused.
 *
 * The two are not interchangeable to the route above: a duplicate means someone
 * in this process is already fetching exactly what you asked for, so what is
 * stored is about to be current; busy means nobody is, and this instance simply
 * has no room to find out. One is a reason to serve cache and say nothing, the
 * other a reason to serve cache *marked stale* — or, with nothing cached, to
 * answer 503.
 */
export type ManagerSyncRefusal = "duplicate" | "busy";

/** The outcome of asking to sync a manager. */
export type ManagerSyncReservation =
  | {
      ok: true;
      /**
       * Give the reservation back — idempotent, so a `finally` reachable twice
       * cannot widen the bound. Must be called on *every* path out, a thrown
       * sync included: a permit leaked per failure is a cap that tightens to
       * zero, and Sleeper fails often enough for that to be a matter of hours.
       */
      release: () => void;
    }
  | { ok: false; reason: ManagerSyncRefusal };

export type ManagerSyncAdmission = {
  /**
   * Claim the right to sync one manager, without waiting.
   *
   * `key` identifies the work, not the request — the route keys on
   * `userId:season`, since one manager's two seasons are two graphs.
   *
   * **Non-queueing on purpose.** Every caller of this holds a streaming
   * response open, so a queued one holds it through a wait the platform's
   * deadline may well end first, and answers with a stream nobody is reading. A
   * refused caller has something better to do: serve what is stored. Nothing is
   * stamped by a refusal, so the manager stays due and the next request tries
   * again.
   *
   * `dedupe` is whether *this* caller may be refused as a duplicate. True where
   * it can serve cache — a second refresh of one manager is pure waste. False
   * for a cold caller, which has nothing to show and needs its own progress
   * stream; the advisory lock inside the sync is what keeps *those* from
   * repeating each other's fan-out, and it is a cross-instance guarantee this
   * map could never make.
   *
   * It gates the check and not the registration: every holder is registered, so
   * a cached caller arriving while a cold sync runs still reads as a duplicate
   * and serves what that sync has committed so far.
   */
  reserve(key: string, options: { dedupe: boolean }): ManagerSyncReservation;
  /** In flight, refused-and-waiting-for-nobody, and the high-water mark. */
  stats(): LimiterStats & { inFlight: number };
};

/**
 * How many manager syncs one process may run at once, when nothing says
 * otherwise: {@link DatabaseBudget.fanout}, which is three at the default pool
 * size.
 *
 * A share of the pool rather than a number of its own, for the reason
 * `ADVISORY_LOCK_WAIT_MS` is a share of the request deadline. A manager sync is
 * not one query, it is a Postgres session held for the whole operation (the
 * advisory lock) *plus* the reads and writes each league needs, so what bounds
 * it honestly is how much of the pool a single request may hold — the same
 * question `fanout` already answers for a fan-out of reads. At that cap the
 * held lock connections are a third of the pool and the rest is left for the
 * work those syncs are running, and for every other route on the dyno.
 *
 * `MANAGER_SYNC_LIMIT` overrides it. It is *not* the retired
 * `MANAGER_COLD_SYNC_LIMIT`: that one bounded a strict subset of this, so
 * honouring it here would silently re-scope whatever it was set to.
 */
export function managerSyncConcurrency(
  env: Record<string, string | undefined> = process.env,
  budget: DatabaseBudget = databaseBudget(env),
): number {
  const parsed = Number(env.MANAGER_SYNC_LIMIT?.trim());
  // Junk falls back rather than failing the boot, the budget's own rule: a typo
  // in a dashboard should not be why a manager page stops answering.
  return Number.isInteger(parsed) && parsed > 0 ? parsed : budget.fanout;
}

/**
 * A process's manager-sync admission: the semaphore and the in-flight map,
 * together, because they are reserved and released as one thing.
 *
 * A factory so the bound can be tested at a width a test can drive, with the
 * process singleton built from it below — the shape {@link createLimiter} and
 * `sleeperLimiter` already have.
 */
export function createManagerSyncAdmission(limit: number): ManagerSyncAdmission {
  const limiter = createLimiter(limit);
  /**
   * How many reservations this process is holding per key — see `reserve`'s
   * `dedupe`.
   *
   * **A count and not a set, because one key can legitimately be held twice.**
   * Two cold callers for one manager are both admitted on purpose (a cold caller
   * has nothing cached to serve and needs its own progress stream), so the key
   * has two holders — and against a set the *first* of them to finish deleted
   * the entry outright, which handed the dedupe window to whoever asked next
   * while the second sync was still running. What that admits is not a spare
   * permit spent on nothing: it is a caller queueing on the same per-manager
   * advisory lock the running sync holds, occupying a pool connection for as
   * long as `ADVISORY_LOCK_WAIT_MS` allows, to repeat a fan-out that is already
   * in flight. Counted, the key is in flight until its *last* holder releases.
   */
  const inFlight = new Map<string, number>();

  return {
    reserve(key, { dedupe }) {
      // Checked before the permit is taken, so a duplicate never occupies one:
      // asked the other way round, two tabs on one manager would spend two of
      // three permits to do one manager's work.
      if (dedupe && inFlight.has(key)) return { ok: false, reason: "duplicate" };

      const permit = limiter.tryAcquire();
      if (!permit) return { ok: false, reason: "busy" };

      // Registered whatever `dedupe` said, so the map answers for every holder
      // rather than only for the ones that could have been refused by it.
      inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
      let released = false;
      return {
        ok: true,
        release() {
          // Idempotent, and it is the *count* that makes that matter here: a
          // `finally` reachable twice would otherwise decrement a key its own
          // reservation no longer holds, retiring a sibling sync's registration
          // and opening exactly the dedupe window this counting closes.
          if (released) return;
          released = true;
          const held = inFlight.get(key) ?? 0;
          if (held <= 1) inFlight.delete(key);
          else inFlight.set(key, held - 1);
          permit();
        },
      };
    },
    // `size` is *keys*, which is what this has always reported and what the
    // route's log line means by it: how many managers are being synced, not how
    // many requests are watching one. The limiter's `active` is the permit count
    // and is where the two differ.
    stats: () => ({ ...limiter.stats(), inFlight: inFlight.size }),
  };
}

/**
 * The process's admission, cached on `globalThis` in every environment.
 *
 * The pool's rule, for the pool's reason: a route bundle that gets its own copy
 * of this module gets its own semaphore and its own idea of how many syncs are
 * running, and nothing in the process can tell. Two copies of a cap of three is
 * a cap of six, which is most of the pool — exactly the failure the cap exists
 * to prevent, arrived at by module duplication rather than by traffic.
 */
const globalForAdmission = globalThis as unknown as {
  managerSyncAdmission?: ManagerSyncAdmission;
};

export const managerSyncAdmission: ManagerSyncAdmission =
  (globalForAdmission.managerSyncAdmission ??= createManagerSyncAdmission(
    managerSyncConcurrency(),
  ));
