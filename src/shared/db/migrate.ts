import { runner } from "node-pg-migrate";
import { dbSsl } from "./ssl";

/**
 * Apply any pending migrations in `db/migrations`.
 *
 * Mirrors the `migrate:up` npm script: the same `pgmigrations` history table
 * and the same `db/migrations` directory, so the CLI and this on-boot run share
 * a single migration history (already-applied migrations are skipped, not
 * re-run). `dir` is resolved from `process.cwd()`, which is the project root
 * when Next.js starts.
 *
 * node-pg-migrate takes a Postgres advisory lock and wraps all pending
 * migrations in a single transaction by default, so concurrent server boots
 * can't apply the same migration twice and a failure rolls the batch back.
 */
export async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("[db] DATABASE_URL is not set; skipping migrations on boot.");
    return;
  }

  const applied = await runner({
    // Pass a ClientConfig (not a bare string) so the on-boot migration connects
    // with the same TLS settings as the runtime pool — Heroku Postgres and other
    // managed providers require SSL, which a plain connection string omits.
    databaseUrl: { connectionString: databaseUrl, ssl: dbSsl(databaseUrl) },
    migrationsTable: "pgmigrations",
    dir: "db/migrations",
    direction: "up",
  });

  if (applied.length > 0) {
    const names = applied.map((migration) => migration.name).join(", ");
    console.log(`[db] Applied ${applied.length} migration(s): ${names}`);
  } else {
    console.log("[db] Migrations up to date.");
  }
}
