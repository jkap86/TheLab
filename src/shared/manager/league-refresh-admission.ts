/**
 * How many on-demand league refreshes one process may run at once.
 *
 * Split out of `./league-refresh` for the reason `./sync-admission` was never
 * folded into `./sync`: the bound is arithmetic over the environment and the
 * refresh around it is a Sleeper fan-out and a Postgres write, so keeping the
 * two apart is what lets Node's test runner assert the number without a pool or
 * a network behind it. Both imports below are relative and pure, which is the
 * whole of what that costs.
 */

import {
  clampNotice,
  databaseBudget,
  fanoutLimit,
  type DatabaseBudget,
  type FanoutLimit,
} from "../db/budget.ts";
import { createLimiter, type Limiter } from "../sleeper/limiter.ts";

/** The knob, named once so the clamp warning and the read cannot drift. */
export const LEAGUE_REFRESH_LIMIT_VAR = "LEAGUE_REFRESH_LIMIT";

/**
 * How many on-demand league refreshes one process may run at once.
 *
 * {@link DatabaseBudget.fanout} by default — a share of the pool rather than a
 * number of its own, for the reason `managerSyncConcurrency` is one: a refresh
 * is a Postgres session held for its whole duration (the advisory lock) plus the
 * reads and writes the graph needs, so what bounds it honestly is how much of
 * the pool one request may hold.
 *
 * `LEAGUE_REFRESH_LIMIT` *requests* it and cannot raise it: whatever is set is
 * clamped to that same share by {@link fanoutLimit}, since a knob reachable
 * from a dashboard that can be set to the pool size is the failure this bound
 * exists for, arrived at through the variable meant to prevent it. Junk, zero
 * and negatives fall back rather than failing the boot — the budget's own rule,
 * since a typo should not be why a button stops working, and a zero would be an
 * admission that admits nobody.
 */
export function leagueRefreshConcurrency(
  env: Record<string, string | undefined> = process.env,
  budget: DatabaseBudget = databaseBudget(env),
): number {
  return leagueRefreshLimit(env, budget).limit;
}

/** The same reading, with what was asked for and what it was cut to. */
export function leagueRefreshLimit(
  env: Record<string, string | undefined> = process.env,
  budget: DatabaseBudget = databaseBudget(env),
): FanoutLimit {
  return fanoutLimit(env[LEAGUE_REFRESH_LIMIT_VAR], budget);
}

/**
 * The process's league-refresh admission, cached on `globalThis` in every
 * environment.
 *
 * The pool's rule, for the pool's reason: a route bundle carrying its own copy
 * of this module would get its own semaphore and its own idea of how many
 * refreshes are running, and nothing in the process could tell — two copies of
 * a cap of three is a cap of six, which is most of the pool.
 *
 * A bare {@link Limiter} rather than the manager admission's semaphore-plus-map,
 * because there is nothing here for the map to do: the per-league advisory lock
 * already collapses two callers on one league into one fan-out *and* hands both
 * the answer, which is strictly better than refusing the second as a duplicate.
 */
const globalForRefresh = globalThis as unknown as {
  leagueRefreshAdmission?: Limiter;
};

export const leagueRefreshAdmission: Limiter =
  (globalForRefresh.leagueRefreshAdmission ??= createLimiter(admittedLimit()));

/**
 * The bound this process will actually use, saying so once if it is not the one
 * configured.
 *
 * Inside the `??=`, so the line is written when the limiter is *built* — once
 * per process rather than per request, and not at all on a module copy that
 * finds the singleton already there. The alternative to a line here is silence,
 * which is how a setting this app will not honour came to look like it worked.
 */
function admittedLimit(): number {
  const limit = leagueRefreshLimit();
  const notice = clampNotice(LEAGUE_REFRESH_LIMIT_VAR, limit);
  if (notice) console.warn(`[league-refresh] ${notice}`);
  return limit.limit;
}
