/**
 * Next.js instrumentation hook.
 *
 * `register` runs once when a server instance boots and must complete before
 * the server handles requests, which makes it the place to apply pending
 * database migrations automatically on boot.
 *
 * Migrations use `pg`/`node-pg-migrate`, which are Node.js-only, so the import
 * is guarded to the Node.js runtime and loaded dynamically — this keeps the DB
 * code out of the Edge bundle entirely.
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
}
