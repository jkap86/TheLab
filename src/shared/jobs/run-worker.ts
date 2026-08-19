import type { BackgroundJobsRun } from "./start.ts";

/**
 * The worker's lifecycle, with its I/O injected.
 *
 * `src/worker.ts` is the thin file that wires the real migration runner, the
 * real pool and the real `process` to this; everything that can be got wrong
 * lives here, where it can be driven without a database, without signals and
 * without waiting out a scheduler interval. That split is the house rule (a
 * feature spanning several modules gets one thin file that does the I/O and
 * composes them), and it is what makes "a fatal startup failure exits non-zero"
 * an assertion rather than a hope.
 *
 * The order is load-bearing and it is the instrumentation hook's order, for the
 * same reasons:
 *
 *   1. **Refuse without a database.** In the web process a missing
 *      `DATABASE_URL` is fatal in production and a warning in development,
 *      because a dev server with no database should still render pages. A
 *      worker has no such half-useful state — every one of its jobs is a write
 *      to Postgres — so it refuses in both, rather than sitting up all night
 *      ticking against a database that isn't there.
 *   2. **Migrate before starting anything.** A loop must not run against a
 *      schema this build can't vouch for, and a migration failure is exactly
 *      the case where a process that stays up looks like one that works.
 *   3. **Then start the jobs**, and only then hold the process open.
 */

/** Everything the worker touches that isn't its own logic. */
export type WorkerDeps = {
  env: Record<string, string | undefined>;
  /** `resolveDatabaseUrl(env, true)` — see the refusal rule above. */
  databaseConfigured: () => { ok: boolean; message?: string };
  /** Apply pending migrations. Throws on failure. */
  migrate: () => Promise<void>;
  /** `startBackgroundJobs({ role: "worker" })`. */
  startJobs: () => Promise<BackgroundJobsRun>;
  /** Release the connection pool. Failures are logged, never fatal. */
  closePool: () => Promise<void>;
  /** Register a shutdown signal handler. */
  onSignal: (signal: string, handler: () => void) => void;
  /**
   * Hold the process open, and return the release.
   *
   * The loops' own timers are `unref`'d — right for a web server held open by
   * its socket, and precisely wrong here: a worker whose only timers are
   * unref'd exits the moment the boot ticks yield, having logged five loops
   * starting and then nothing at all. So the worker keeps a ref'd handle of its
   * own, and dropping it is what lets the process end after a clean shutdown
   * instead of needing `process.exit`.
   */
  keepAlive: () => () => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string, error?: unknown) => void;
};

/** The signals a platform stops a worker with. */
export const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

export type WorkerResult = {
  /** Process exit code: 0 for a clean run, 1 for a fatal startup failure. */
  exitCode: number;
  /** What the failure was, when there was one. */
  failure?: "database" | "migrations" | "start";
  /** The registration, when it got that far. */
  run?: BackgroundJobsRun;
  /** The signal that ended it, when one did. */
  stoppedBy?: string;
};

/**
 * Run the worker until it is signalled, then shut it down.
 *
 * Resolves with the exit code. Three startup failures resolve immediately with
 * `1` and nothing running — a worker that stayed up after any of them would be
 * a process the platform reports as healthy and that does no work, which is the
 * one outcome nothing downstream can distinguish from a working deployment.
 *
 * A worker that started *zero* jobs is loud but not fatal, and the asymmetry is
 * deliberate: that state is reached by configuration (`BACKGROUND_JOBS=off`, or
 * every per-job switch off), which is somebody's explicit instruction and often
 * a deliberate incident measure. Exiting non-zero there would crash-loop the
 * dyno for as long as the setting stood, which is noise on top of a decision
 * that was already made.
 */
export async function runWorker(deps: WorkerDeps): Promise<WorkerResult> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const error =
    deps.error ??
    ((message: string, cause?: unknown) =>
      cause === undefined
        ? console.error(message)
        : console.error(message, cause));

  const database = deps.databaseConfigured();
  if (!database.ok) {
    error(
      `[worker] ${database.message ?? "DATABASE_URL is not set."} ` +
        `A worker with no database has nothing to do.`,
    );
    return { exitCode: 1, failure: "database" };
  }

  try {
    await deps.migrate();
  } catch (cause) {
    error("[worker] Failed to initialise the database on boot:", cause);
    return { exitCode: 1, failure: "migrations" };
  }

  let run: BackgroundJobsRun;
  try {
    run = await deps.startJobs();
  } catch (cause) {
    error("[worker] Failed to start the background jobs:", cause);
    return { exitCode: 1, failure: "start" };
  }

  if (run.started.length === 0) {
    warn(
      `[worker] No background jobs are running` +
        (run.reason ? ` (${run.reason})` : "") +
        `. Nothing in this deployment is refreshing the data.`,
    );
  }

  const release = deps.keepAlive();

  return await new Promise<WorkerResult>((resolve) => {
    let shuttingDown = false;

    const shutdown = (signal: string) => {
      // A platform sends SIGTERM and then SIGKILL; a second SIGINT is somebody
      // pressing ctrl-C again because the first looked like it did nothing.
      // Neither should re-enter the teardown — say what is happening instead.
      if (shuttingDown) {
        log(`[worker] Already shutting down; ignoring ${signal}.`);
        return;
      }
      shuttingDown = true;
      log(`[worker] ${signal} received; stopping background jobs.`);

      // Stop the loops *before* the pool: a tick that is mid-query when the
      // pool closes fails on a connection pulled out from under it, which is a
      // stack trace describing a clean shutdown.
      run.stop();
      release();

      void deps
        .closePool()
        .catch((cause) => {
          // Nothing is left to do about it, and it must not change the exit
          // code: the jobs are stopped, which is what shutting down meant.
          error("[worker] Failed to close the database pool cleanly:", cause);
        })
        .then(() => {
          log("[worker] Stopped.");
          resolve({ exitCode: 0, run, stoppedBy: signal });
        });
    };

    for (const signal of SHUTDOWN_SIGNALS) {
      deps.onSignal(signal, () => shutdown(signal));
    }

    log(
      `[worker] Running ${run.started.length} background job(s): ` +
        `${run.started.join(", ") || "none"}.`,
    );
  });
}
