/**
 * How many per-league refresh presses one process runs at once.
 *
 * **Its own semaphore rather than a share of `managerSyncAdmission`'s**, and
 * that is the decision this file exists to record. The two look like the same
 * thing — both hold a Postgres session across a Sleeper fan-out — but they are
 * different weights asked for in different ways:
 *
 * - A manager sync is ~11 requests *per league*, up to a hundred leagues, and
 *   nobody asks for it by name: it happens because a page was opened.
 * - A press is ~11 requests total, and it is a reader pressing a key. It arrives
 *   in ones and twos, and it arrives while a page is already on screen.
 *
 * Sharing one bound would let a burst of presses take every permit and leave the
 * leagues route's **cold** path — the one with nothing cached to fall back on,
 * which answers 503 rather than an empty list — shed on behalf of a key press
 * that had a perfectly good page behind it. Two bounds cost one more integer and
 * make that trade impossible.
 *
 * A bare {@link Limiter} rather than `sync-admission`'s semaphore-plus-in-flight
 * map, because the deduplication it adds is already done a layer down: two tabs
 * pressing one league meet at `leagueSyncLockKey`, and the loser is told `fresh`
 * by the gate's race arm rather than running a second fan-out. There is nothing
 * for a key-based dedupe to catch that the lock does not.
 */

// Relative, with `.ts`, so Node's own runner resolves this file: the clamp
// below is the part worth a test and it must not need a bundler to reach.
// `ManagerSyncLimit` is reused rather than re-declared — it is the shape "what
// was asked for, what the ceiling is, what will be used", which is not specific
// to managers however its name reads.
import { createLimiter, type Limiter } from "../sleeper/limiter.ts";
import { clampNotice, type ManagerSyncLimit } from "./sync-admission.ts";

/** Requests a bound; see {@link leagueRefreshLimit} for why it cannot raise one. */
export const LEAGUE_REFRESH_LIMIT_VAR = "LEAGUE_REFRESH_LIMIT";

/**
 * The most presses one process runs at once, however it is asked.
 *
 * One, on `DEFAULT_MANAGER_SYNC_LIMIT`'s argument: a press is not one query but
 * a Postgres session held for the whole operation — the advisory lock — plus
 * the writes the graph needs, so what bounds it honestly is how much of the
 * pool one request may hold. This path's share of the default ten is one
 * parked session and one transaction, beside the manager syncs' two and the
 * crawl's one — ≤ 4 parked in all, the rest left for the work every parker is
 * doing and for every other route (`LEAGUE_FETCH_CONCURRENCY` carries the sum).
 * It was three, the same as the manager bound, and the two together with the
 * crawl parked seven of ten across Sleeper waits.
 *
 * One is enough because a press is a reader pressing a key: it arrives in ones
 * and twos, the second press on one league is already answered `fresh` by the
 * gate's race arm, and a shed press is told so and pressed again. It is *not*
 * a coupling to the manager bound — both are shares of `DEFAULT_POOL_MAX` and
 * both move if that does, but they are different weights and the header above
 * is why they are not one number.
 */
const DEFAULT_LEAGUE_REFRESH_LIMIT = 1;

/**
 * Read {@link LEAGUE_REFRESH_LIMIT_VAR}.
 *
 * It *requests* a bound and cannot raise one, `managerSyncLimit`'s rule and for
 * its reason: a knob that can be set to the pool size is the failure the bound
 * exists for, reached through the variable meant to prevent it. Junk, zero, a
 * negative and a decimal all fall back rather than failing the boot.
 */
export function leagueRefreshLimit(
  env: Record<string, string | undefined> = process.env,
): ManagerSyncLimit {
  const parsed = Number(env[LEAGUE_REFRESH_LIMIT_VAR]?.trim());
  const requested = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  const ceiling = DEFAULT_LEAGUE_REFRESH_LIMIT;

  return {
    requested,
    ceiling,
    limit: requested === null ? ceiling : Math.min(requested, ceiling),
  };
}

/** How many presses this process may run at once. */
export function leagueRefreshConcurrency(
  env: Record<string, string | undefined> = process.env,
): number {
  return leagueRefreshLimit(env).limit;
}

/**
 * Cached on `globalThis`, the rule every semaphore in this app follows: a route
 * bundle carrying its own copy of this module gets its own counter, and nothing
 * in the process can tell. Two copies of a cap of one is a cap of two.
 */
const globalForRefresh = globalThis as unknown as {
  leagueRefreshAdmission?: Limiter;
};

export const leagueRefreshAdmission: Limiter =
  (globalForRefresh.leagueRefreshAdmission ??= createLimiter(admittedLimit()));

/**
 * The bound this process will actually use, saying so once if it is not the one
 * configured. Inside the `??=` so the line is written when the semaphore is
 * built — once per process, and not at all on a module copy that finds the
 * singleton already there.
 */
function admittedLimit(): number {
  const limit = leagueRefreshLimit();
  const notice = clampNotice(LEAGUE_REFRESH_LIMIT_VAR, limit);
  if (notice) console.warn(`[league-refresh] ${notice}`);
  return limit.limit;
}
