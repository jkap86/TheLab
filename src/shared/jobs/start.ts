// Relative with an explicit extension (the pure→pure convention), so this
// module resolves under Node's test runner without a bundler.
import type { BackgroundLoopHandle } from "../util/background-loop.ts";
import {
  BACKGROUND_JOB_VARS,
  type BackgroundJob,
} from "../util/background-jobs.ts";

import { type BackgroundJobRole, backgroundJobsGate } from "./mode.ts";

/**
 * Starting the background jobs, in one place, for both entry points.
 *
 * The registration list lived in `src/instrumentation.ts` — five dynamic
 * imports and five calls — which was fine while the web server was the only
 * thing that had one. A dedicated worker makes a second copy of that list the
 * obvious shape and the wrong one: two lists drift, and the way they drift is a
 * job added to the web process and never to the worker, which is a sync that
 * silently stops the day the recommended deployment is adopted. So the list is
 * here, once, and both entry points call {@link startBackgroundJobs}.
 *
 * What this module does *not* do is decide whether an individual job runs —
 * that stays with each scheduler's own `backgroundJobSwitch` call, so
 * `LEAGUE_CRAWLER=off` means the same thing wherever it is read. This layer
 * decides whether the process asks at all.
 */

/** One job's start function. Returns the handle its loop hands back. */
export type BackgroundJobStarter = () =>
  | BackgroundLoopHandle
  | Promise<BackgroundLoopHandle>;

export type BackgroundJobStarters = Record<BackgroundJob, BackgroundJobStarter>;

/** What one process's registration came to. */
export type BackgroundJobsRun = {
  role: BackgroundJobRole;
  /** True when this process registered the jobs. */
  enabled: boolean;
  /** Why not, when `enabled` is false. */
  reason?: string;
  /** Jobs whose loop is now ticking in this process. */
  started: BackgroundJob[];
  /**
   * Jobs asked for that did not start, with the reason their loop gave —
   * almost always their own `off` switch. Reported rather than swallowed: a
   * worker that started three of five loops should say which two and why.
   */
  skipped: { job: BackgroundJob; reason?: string }[];
  /** True when a *previous* call in this process did the work. */
  alreadyStarted: boolean;
  /** Stop every loop this run started. Idempotent. */
  stop: () => void;
};

/**
 * The real starters, loaded on demand.
 *
 * Dynamically imported for the reason the instrumentation hook always did it:
 * these pull `pg` and the Sleeper/KTC clients, and nothing about them should be
 * evaluated in a process that has decided not to run them — an Edge bundle, or
 * a web dyno with `BACKGROUND_JOBS=worker`.
 */
async function loadStarters(): Promise<BackgroundJobStarters> {
  const [ktc, manager, projections, stats, nflDraft] = await Promise.all([
    import("@/shared/ktc"),
    import("@/shared/manager"),
    import("@/shared/projections"),
    import("@/shared/stats"),
    import("@/shared/nfl-draft"),
  ]);

  return {
    // KeepTradeCut dynasty values, plus the per-player history backfill.
    ktc: ktc.startKtcScheduler,
    // Keep every stored league fresh and keep finding new ones by walking
    // league members — the same sync the leagues route runs on a username
    // search.
    crawler: manager.startLeagueCrawler,
    // The current NFL week's player projections and the next two, so the lineup
    // tools
    // read Postgres instead of a 5.6MB Sleeper response per visit.
    projections: projections.startProjectionsScheduler,
    // The other half of that: what players actually did, which is what a
    // points-per-game average is made of.
    stats: stats.startStatsScheduler,
    // Where players were taken in the *NFL* draft — a once-a-year fact on a
    // twelve-hour gate, and the cheapest of the five by a wide margin.
    nflDraft: nflDraft.startNflDraftScheduler,
  };
}

/**
 * The registration order, which is also the order they are stopped in reverse.
 *
 * Derived from `BACKGROUND_JOB_VARS` rather than listed, so a job added there
 * is started here without a second edit — the same reason `DEFENSIVE_SLOTS` is
 * derived from `SLOT_POSITIONS`. A starter missing from the map is a type
 * error, which is the point.
 */
export const BACKGROUND_JOB_ORDER = Object.keys(
  BACKGROUND_JOB_VARS,
) as BackgroundJob[];

const globalForJobs = globalThis as unknown as {
  backgroundJobsRun?: BackgroundJobsRun;
};

export type StartBackgroundJobsOptions = {
  /** Which entry point is asking. See {@link BackgroundJobRole}. */
  role: BackgroundJobRole;
  env?: Record<string, string | undefined>;
  /** Injected for tests; production loads the real schedulers. */
  starters?: BackgroundJobStarters;
};

/**
 * Register every background job this process is configured to run.
 *
 * Idempotent per process, on `globalThis` like the loops' own guard: a second
 * call returns the first call's run with `alreadyStarted` set rather than
 * starting a second copy of anything. Next's instrumentation hook can be
 * evaluated more than once (dev/HMR, and a re-required route bundle), and a
 * worker that somehow called this twice would otherwise double every loop's
 * upstream traffic — the advisory locks would hold, but paying for them twice
 * a tick is not a plan.
 */
export async function startBackgroundJobs(
  options: StartBackgroundJobsOptions,
): Promise<BackgroundJobsRun> {
  const { role, env = process.env } = options;

  const existing = globalForJobs.backgroundJobsRun;
  if (existing) return { ...existing, alreadyStarted: true };

  const gate = backgroundJobsGate(role, env);
  if (!gate.enabled) {
    console.log(`[jobs] Background jobs not started in the ${role} process (${gate.reason}).`);
    const run: BackgroundJobsRun = {
      role,
      enabled: false,
      reason: gate.reason,
      started: [],
      skipped: [],
      alreadyStarted: false,
      stop: () => {},
    };
    globalForJobs.backgroundJobsRun = run;
    return run;
  }

  const starters = options.starters ?? (await loadStarters());

  const handles: BackgroundLoopHandle[] = [];
  const started: BackgroundJob[] = [];
  const skipped: BackgroundJobsRun["skipped"] = [];

  for (const job of BACKGROUND_JOB_ORDER) {
    // Sequential rather than `Promise.all`: these return as soon as the timer
    // is armed (the boot tick is deliberately not awaited), so there is nothing
    // to overlap, and a stable start order keeps the boot log readable.
    const handle = await starters[job]();
    handles.push(handle);
    if (handle.running) started.push(job);
    else skipped.push({ job, reason: handle.reason });
  }

  console.log(
    `[jobs] ${role}: started ${started.length} of ${BACKGROUND_JOB_ORDER.length} ` +
      `background job(s)` +
      (skipped.length
        ? `; skipped ${skipped.map((s) => `${s.job} (${s.reason ?? "no reason given"})`).join(", ")}`
        : "") +
      ".",
  );

  let stopped = false;
  const run: BackgroundJobsRun = {
    role,
    enabled: true,
    started,
    skipped,
    alreadyStarted: false,
    stop: () => {
      if (stopped) return;
      stopped = true;
      // Reverse order, so the last thing armed is the first thing quiesced.
      for (const handle of [...handles].reverse()) handle.stop();
      if (globalForJobs.backgroundJobsRun === run) {
        delete globalForJobs.backgroundJobsRun;
      }
    },
  };

  globalForJobs.backgroundJobsRun = run;
  return run;
}

/**
 * Stop whatever this process started, if anything.
 *
 * The shutdown path calls it through the run object it already holds; this is
 * for the callers that don't have one (a test tearing down, a signal handler
 * that never saw the start).
 */
export function stopBackgroundJobs(): void {
  globalForJobs.backgroundJobsRun?.stop();
  delete globalForJobs.backgroundJobsRun;
}
