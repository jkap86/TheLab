/**
 * Next.js instrumentation hook.
 *
 * `register` runs once when a server instance boots and must complete before
 * the server handles requests, which makes it the place to apply pending
 * database migrations automatically on boot.
 *
 * Migrations use `pg`/`node-pg-migrate`, which are Node.js-only, so the import
 * is guarded to the Node.js runtime and loaded dynamically — this keeps the DB
 * code out of any non-Node bundle entirely.
 *
 * TheLabX starts its background loops here too, once migrations have applied.
 * The KTC scheduler is the first of them to arrive; the league crawler stays
 * deferred, and the leagues route syncs on request. Further ports add their own
 * blocks below the KTC one.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("@/shared/db");

  try {
    await runMigrations();
  } catch (error) {
    // Either the database was never configured (fatal in production — see
    // `shared/db/config`) or migrations failed. Both throw, and throwing from
    // `register` is what stops the server before it serves a request against a
    // schema it can't vouch for.
    console.error("[db] Failed to initialise the database on boot:", error);
    throw error;
  }

  // Started, not awaited: the boot tick can run half an hour of history
  // backfill and `register()` gates request serving. And unlike migrations, a
  // failure here is logged rather than rethrown — a KTC outage is not a reason
  // to refuse to serve the leagues route. The scheduler guards its own ticks,
  // so reaching this catch means the module itself failed to load.
  try {
    const { startKtcScheduler } = await import("@/shared/ktc");
    startKtcScheduler();
  } catch (error) {
    console.error("[ktc] Failed to start the KTC scheduler:", error);
  }

  // The same terms: a ~5MB download queued behind the Sleeper limiter must not
  // gate request serving, and a failed one costs the trades board its names
  // rather than the server its boot.
  try {
    const { startPlayersScheduler } = await import("@/shared/players");
    startPlayersScheduler();
  } catch (error) {
    console.error("[players] Failed to start the players scheduler:", error);
  }
}
