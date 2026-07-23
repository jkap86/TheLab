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
 * background loops (KeepTradeCut values, league crawl), which are started once
 * migrations have applied.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("@/shared/db");

  try {
    await runMigrations();
  } catch (error) {
    // DATABASE_URL is configured but migrations failed — fail loudly so the
    // app doesn't start serving requests against an out-of-date schema.
    console.error("[db] Failed to apply migrations on boot:", error);
    throw error;
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
}
