/**
 * Next.js instrumentation hook.
 *
 * `register` runs once when a server instance boots and must complete before
 * the server handles requests, which makes it the place to apply pending
 * database migrations automatically on boot.
 *
 * Migrations use `pg`/`node-pg-migrate`, which are Node.js-only, so the import
 * is guarded to the Node.js runtime and loaded dynamically — this keeps the DB
 * code out of the Edge bundle entirely. The same guard fronts the background
 * loops, which are started once migrations have applied.
 *
 * ## Deploying with a worker
 *
 * The loops registered here run *in the process serving requests*, sharing its
 * event loop and its Postgres pool. That is right for one dyno and for
 * development; past that, the crawler holding a pool connection across a
 * league's whole Sleeper fan-out is competing with the requests it exists to
 * serve. `src/worker.ts` is the dedicated process, and which of the two runs the
 * loops is one variable:
 *
 * ```
 * # Procfile
 * web:    npm start          # with BACKGROUND_JOBS=worker
 * worker: npm run worker
 * ```
 *
 * The *list* of loops is not here any more — it is `shared/jobs`, shared with
 * the worker, because two lists drift and the way they drift is a job added to
 * one process and never to the other. Migrations still run on both, which is
 * what makes the order between them irrelevant. **The advisory locks stay
 * exactly as they are**: they are what stops a misconfigured second worker — or
 * a web dyno somebody left the jobs on — from double-scraping Sleeper or KTC,
 * and switching a loop off is not a substitute for that. Nothing here is
 * required locally; unset, this file behaves as it always has.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations, resolveDatabaseUrl } = await import("@/shared/db");

  try {
    await runMigrations();
  } catch (error) {
    // Either the database was never configured (fatal in production — see
    // `shared/db/config`) or migrations failed. Both throw, and throwing from
    // `register` is what stops the server before it serves a request against a
    // schema it can't vouch for. Nothing below this line runs, which is the
    // point: the loops must not start on a broken boot.
    console.error("[db] Failed to initialise the database on boot:", error);
    throw error;
  }

  // Development with no DATABASE_URL: migrations were skipped rather than
  // fatal, so the server still renders. The loops would only tick against a
  // database that isn't there, once a minute, forever — so they stay down and
  // say so.
  if (!resolveDatabaseUrl(process.env, false).ok) {
    console.warn(
      "[boot] DATABASE_URL is not set; background loops will not start.",
    );
    return;
  }

  const { startBackgroundJobs, webBackgroundJobsAdvice } = await import(
    "@/shared/jobs"
  );

  // Whether this process runs them at all is `BACKGROUND_JOBS`: unset it is
  // every loop, as it always has been; `worker` moves them to the worker dyno;
  // `off` stops them everywhere. Started without awaiting the first tick, so a
  // cold scrape doesn't block the server coming up.
  await startBackgroundJobs({ role: "web" });

  // A production web process running the loops is the legacy shape and still
  // supported — but it is also what somebody who scaled a worker and forgot the
  // variable ends up with, and that costs pool connections on the dyno serving
  // requests with nothing anywhere saying so.
  const advice = webBackgroundJobsAdvice(process.env);
  if (advice) console.warn(advice);
}
