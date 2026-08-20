/**
 * The background-job worker.
 *
 * `npm run worker` — a plain Node process that applies migrations, starts every
 * background loop this app has, and stays up until the platform stops it. It
 * does **not** listen on a port, which is the whole reason it exists as its own
 * entry point: the alternative on the table was a second `npm start`, which
 * boots a full Next HTTP server, builds a route manifest and binds `$PORT`
 * purely so the instrumentation hook fires. On Heroku that also makes the dyno
 * look like a web dyno to anything reading the process table, and it means the
 * one process that must never be a bottleneck is carrying a request handler it
 * will never be asked to use.
 *
 * Everything worth getting right is in `shared/jobs/run-worker`, which takes its
 * I/O as arguments and is tested. This file is the wiring, and deliberately has
 * no logic of its own — see the house rule about composition files.
 *
 * ```
 * # Procfile
 * web:    npm start        # BACKGROUND_JOBS=worker
 * worker: npm run worker
 * ```
 *
 * The advisory locks are untouched and stay load-bearing: two workers started by
 * accident, or a web dyno still running the loops, cost a skipped tick rather
 * than a doubled scrape of Sleeper or KTC.
 */
import { pool, resolveDatabaseUrl, runMigrations } from "@/shared/db";
import { runWorker, startBackgroundJobs } from "@/shared/jobs";

/**
 * A ref'd timer, and nothing else.
 *
 * Every background loop `unref`s its interval so it can't hold a web server
 * open past a shutdown. That leaves this process with no reason to stay alive
 * between ticks, so it holds one handle of its own — cleared on shutdown, which
 * is what lets the process exit on its own rather than through `process.exit`
 * and whatever was still in flight.
 */
const KEEP_ALIVE_MS = 60 * 1000;

async function main(): Promise<void> {
  const { exitCode } = await runWorker({
    env: process.env,
    // `true` regardless of NODE_ENV: a worker without a database is not a
    // degraded worker, it is an empty one. See `runWorker`.
    databaseConfigured: () => resolveDatabaseUrl(process.env, true),
    migrate: runMigrations,
    startJobs: () => startBackgroundJobs({ role: "worker" }),
    closePool: () => pool.end(),
    onSignal: (signal, handler) => {
      process.on(signal as NodeJS.Signals, handler);
    },
    keepAlive: () => {
      const timer = setInterval(() => {}, KEEP_ALIVE_MS);
      return () => clearInterval(timer);
    },
  });

  // `exitCode` rather than `process.exit`: the loops are stopped and the pool is
  // closed by this point, so letting the event loop drain is both correct and
  // the only way a log line written on the way out is flushed.
  process.exitCode = exitCode;
}

void main().catch((error) => {
  // `runWorker` turns every failure it knows about into an exit code; anything
  // reaching here is a bug in the wiring above, and it must still be a non-zero
  // exit rather than a process that quietly does nothing.
  console.error("[worker] Fatal:", error);
  process.exitCode = 1;
});
