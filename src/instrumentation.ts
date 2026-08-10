/**
 * Next.js instrumentation hook.
 *
 * `register` runs once when a server instance boots and must complete before
 * the server handles requests, which makes it the place to apply pending
 * database migrations automatically on boot.
 *
 * Migrations use `pg`/`node-pg-migrate`, which are Node.js-only, so the import
 * is guarded to the Node.js runtime and loaded dynamically — this keeps the DB
 * code out of the Edge bundle entirely. The same guard fronts the in-process
 * background loops (KeepTradeCut values, league crawl, weekly projections and
 * weekly stat lines), which are started once migrations have applied.
 *
 * ## Deploying with a worker
 *
 * Every loop below runs *in the process serving requests*, sharing its event
 * loop and its Postgres pool. That is right for one dyno and for development;
 * past that, the crawler holding a pool connection across a league's whole
 * Sleeper fan-out is competing with the requests it exists to serve. Each loop
 * has an env switch and there is one that covers all of them
 * (`shared/util/background-jobs`), so the split is configuration rather than a
 * second entry point:
 *
 * ```
 * # Procfile — same image, same database, one variable
 * web:    npm start          # with BACKGROUND_JOBS=off
 * worker: npm start          # nothing set: every loop on
 * ```
 *
 * Migrations still run on both, which is what makes the order between them
 * irrelevant. **The advisory locks stay exactly as they are**: they are what
 * stops a misconfigured second worker — or a web dyno somebody left the jobs on
 * — from double-scraping Sleeper or KTC, and switching a loop off is not a
 * substitute for that. Nothing here is required locally; unset, this file
 * behaves as it always has.
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
    // point: the three loops must not start on a broken boot.
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

  // Schema is up to date; start the background loop that scrapes KeepTradeCut
  // dynasty values every 15 minutes. Dynamically imported (Node-only deps) and
  // started without awaiting so the first scrape doesn't block serving.
  const { startKtcScheduler } = await import("@/shared/ktc");
  startKtcScheduler();

  // Keep every stored league fresh and keep finding new ones by walking league
  // members — the same sync the leagues route runs on a username search, on a
  // one-minute loop. Also Node-only and started without awaiting.
  const { startLeagueCrawler } = await import("@/shared/manager");
  startLeagueCrawler();

  // Keep the current and next NFL week's player projections stored locally, so
  // the lineup tools read Postgres instead of a 5.6MB Sleeper response per visit.
  const { startProjectionsScheduler } = await import("@/shared/projections");
  startProjectionsScheduler();

  // The other half of that: what players actually did, which is what a points-
  // per-game average is made of. Two seasons rather than one — a PPG counts the
  // weeks *before* the one on screen, so week 1 has nothing of its own to
  // average and reads last season instead.
  const { startStatsScheduler } = await import("@/shared/stats");
  startStatsScheduler();
}
