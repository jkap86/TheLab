/**
 * Which persistent background jobs this process runs.
 *
 * **Everything here runs *inside the web server*.** The four loops — the KTC
 * scrape, the league crawl, the projections sync and the stat-line sync — are
 * started from `instrumentation.ts` in the same Node process that serves every
 * page and every API route, so they share its event loop, its outbound request
 * budget and, most consequentially, its Postgres pool. That is the right shape
 * for one dyno and for local development, where a second process would be
 * ceremony around a database that isn't busy; it stops being right the moment
 * requests and crawling are competing for `databaseBudget().poolMax`
 * connections, because the crawler holds one for the whole of a league's Sleeper
 * fan-out (see `withAdvisoryLock` in `shared/manager/crawl`) and a queued
 * request is one the platform will answer 503 for on the app's behalf.
 *
 * So the deployment this makes possible is:
 *
 * ```
 * web:    npm start                        # BACKGROUND_JOBS=off
 * worker: npm start                        # the default — every loop on
 * ```
 *
 * Same image, same database, one variable. **Nothing about the advisory locks
 * changes**, and that is the point of switching rather than deleting: every one
 * of these takes its own lock, so a worker and a web dyno that was left with the
 * jobs on still cannot double-scrape, and running two workers by accident costs
 * a skipped tick rather than twice the load on Sleeper.
 *
 * Local development needs none of it: with nothing set, every job runs exactly
 * as it did before this module existed.
 *
 * Pure — the environment arrives as an argument — so the matrix can be checked
 * without booting anything, the same shape as `shared/db/budget` and
 * `shared/db/config`.
 */

/**
 * The jobs, and the variable each is switched by.
 *
 * The three that already had a switch keep the name they had: those are in
 * deployed configuration and in `.env` files on developers' machines, and a
 * rename would silently turn a job that somebody had deliberately disabled back
 * on. KTC is the one that had none — it was the only loop with no way to stop
 * it short of stopping the process.
 */
export const BACKGROUND_JOB_VARS = {
  /** KeepTradeCut values refresh and the per-player history backfill. */
  ktc: "KTC_SYNC",
  /** The league crawl: refresh stored leagues, discover new ones. */
  crawler: "LEAGUE_CRAWLER",
  /** Weekly player projections. */
  projections: "PROJECTIONS_SYNC",
  /** Weekly actual stat lines. */
  stats: "STATS_SYNC",
  /** The NFL draft crosswalk — where players were taken in the real draft. */
  nflDraft: "NFL_DRAFT_SYNC",
} as const satisfies Record<string, string>;

export type BackgroundJob = keyof typeof BACKGROUND_JOB_VARS;

/** The one variable that turns every job off — the web process's switch. */
export const ALL_BACKGROUND_JOBS_VAR = "BACKGROUND_JOBS";

/** What {@link startBackgroundLoop} takes: whether to run, and why not. */
export type BackgroundJobSwitch = {
  enabled: boolean;
  disabledReason?: string;
};

/**
 * Whether `job` should run in this process.
 *
 * Three rules, in this order:
 *
 *   - **`BACKGROUND_JOBS=off` disables everything.** One variable, so a web
 *     process cannot be left running one loop somebody forgot about, and so a
 *     job added later is off there by default rather than by a second edit.
 *   - **A per-job variable set to `off` disables that job**, which is how a
 *     developer keeps the crawler quiet while the rest of the app works.
 *   - **Anything else runs.** Absent, empty, `on`, or junk: the default is the
 *     behaviour this app has always had, and a typo in a dashboard must not
 *     silently stop the syncs — the failure mode of guessing wrong here is a
 *     database that quietly stops being filled, which is invisible for hours.
 *     Only the exact word `off` (case-insensitively) turns anything off.
 */
export function backgroundJobSwitch(
  job: BackgroundJob,
  env: Record<string, string | undefined> = process.env,
): BackgroundJobSwitch {
  if (isOff(env[ALL_BACKGROUND_JOBS_VAR])) {
    return { enabled: false, disabledReason: `${ALL_BACKGROUND_JOBS_VAR}=off` };
  }
  const variable = BACKGROUND_JOB_VARS[job];
  if (isOff(env[variable])) {
    return { enabled: false, disabledReason: `${variable}=off` };
  }
  return { enabled: true };
}

const isOff = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === "off";
