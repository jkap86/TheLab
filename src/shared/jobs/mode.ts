/**
 * Which *process* runs the background jobs.
 *
 * There are two gates and they answer different questions. `backgroundJobSwitch`
 * (`shared/util/background-jobs`) answers "should *this job* run at all" — one
 * variable per loop, plus the master `BACKGROUND_JOBS=off`. This module answers
 * the question a dedicated worker introduced: "should *this process* be the one
 * running them". Neither substitutes for the other, and neither substitutes for
 * the advisory locks, which are the correctness half and stay exactly as they
 * are — a second worker, or a web dyno somebody left the jobs on, still costs a
 * skipped tick rather than a doubled scrape.
 *
 * The reason a role cannot be another env variable is the platform: Heroku
 * config vars are set per *app*, not per dyno, so `BACKGROUND_JOBS=off` reaches
 * the worker as readily as the web dyno. The role is a fact the entry point
 * knows about itself — `src/worker.ts` passes `"worker"`, `src/instrumentation.ts`
 * passes `"web"` — and the one shared variable says which roles are allowed to
 * run jobs.
 *
 * Pure — the environment arrives as an argument — so the whole matrix can be
 * checked without booting anything.
 */

// Relative with an explicit extension, the pure→pure convention: this module is
// tested directly under Node's runner and must resolve without a bundler.
import { ALL_BACKGROUND_JOBS_VAR } from "../util/background-jobs.ts";

/** Which entry point is asking. Not read from the environment; see above. */
export type BackgroundJobRole = "web" | "worker";

/**
 * What `BACKGROUND_JOBS` says about *where* jobs run.
 *
 *   - `off` — nowhere. The one value that has always meant this, and it still
 *     does, in every process including the dedicated worker. An operator who
 *     wants the syncs stopped should not have to know how many roles exist.
 *   - `worker` — the dedicated worker only; the web process starts nothing.
 *     **This is the recommended production setting** once a worker dyno is
 *     running, and the only one that actually gets the crawler off the event
 *     loop serving requests.
 *   - `everywhere` — every process that registers jobs runs them. This is the
 *     default when the variable is unset, which is what a single dyno and local
 *     development have always done, and it is what `on` spells explicitly.
 */
export type BackgroundJobsMode = "off" | "worker" | "everywhere";

/**
 * Read the mode.
 *
 * Only the exact words `off` and `worker` (case- and space-insensitively) mean
 * anything; everything else — unset, empty, `on`, a typo — is `everywhere`.
 * That asymmetry is the house rule from `backgroundJobSwitch` and it is the
 * same argument: a value nobody understood must not be able to stop the
 * database being filled, because a database that quietly stops being filled is
 * invisible for hours, where a process that kept crawling is visible at once.
 */
export function backgroundJobsMode(
  env: Record<string, string | undefined> = process.env,
): BackgroundJobsMode {
  const value = env[ALL_BACKGROUND_JOBS_VAR]?.trim().toLowerCase();
  if (value === "off") return "off";
  if (value === "worker") return "worker";
  return "everywhere";
}

/** Whether this role runs jobs, and — when it doesn't — what said so. */
export type BackgroundJobsGate = {
  enabled: boolean;
  mode: BackgroundJobsMode;
  reason?: string;
};

/**
 * Whether a process in `role` should register the background jobs.
 *
 * The worker is disabled by exactly one thing: `BACKGROUND_JOBS=off`. It is
 * *not* disabled by `worker`, which is the whole point of that value — one
 * variable, set once on the app, that moves the jobs off the web dyno without
 * needing a second variable to put them back on the worker.
 */
export function backgroundJobsGate(
  role: BackgroundJobRole,
  env: Record<string, string | undefined> = process.env,
): BackgroundJobsGate {
  const mode = backgroundJobsMode(env);

  if (mode === "off") {
    return {
      enabled: false,
      mode,
      reason: `${ALL_BACKGROUND_JOBS_VAR}=off`,
    };
  }

  if (mode === "worker" && role === "web") {
    return {
      enabled: false,
      mode,
      reason: `${ALL_BACKGROUND_JOBS_VAR}=worker (this is the web process)`,
    };
  }

  return { enabled: true, mode };
}

/**
 * The one line a production web process should print about this, or null.
 *
 * Running the loops inside the web server is the legacy shape and still works;
 * it is also the shape this whole change exists to make optional, and a
 * deployment that has grown a worker dyno but never set the variable is running
 * both — correctly, thanks to the locks, but paying for the crawler's pool
 * connections on the dyno serving requests. So the default warns rather than
 * changing under an existing deployment: flipping the default the other way
 * would stop every background refresh on any app that upgraded without scaling
 * a worker, and *that* failure is the silent one.
 *
 * Development says nothing — in-process jobs are what you want there.
 */
export function webBackgroundJobsAdvice(
  env: Record<string, string | undefined> = process.env,
  production = env.NODE_ENV === "production",
): string | null {
  if (!production) return null;
  if (backgroundJobsMode(env) !== "everywhere") return null;
  return (
    `[jobs] Background loops are running inside the web process. ` +
    `Run a worker dyno (\`worker: npm run worker\`) and set ` +
    `${ALL_BACKGROUND_JOBS_VAR}=worker to move them off the process serving ` +
    `requests. Do not set ${ALL_BACKGROUND_JOBS_VAR}=worker until a worker is ` +
    `running: nothing else refreshes the data.`
  );
}
