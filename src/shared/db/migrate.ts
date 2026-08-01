import { runner } from "node-pg-migrate";
import { resolveDatabaseUrl } from "./config";
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
 *
 * A missing `DATABASE_URL` is **fatal in production** and only a warning in
 * development — see `./config`. Throwing here is what keeps
 * `src/instrumentation.ts` from starting the crawler, the KTC scheduler and the
 * projections sync against a database that was never configured.
 */
export async function runMigrations(): Promise<void> {
  const resolved = resolveDatabaseUrl(process.env, isProduction());
  if (!resolved.ok) {
    if (resolved.fatal) throw new Error(`[db] ${resolved.message}`);
    console.warn(`[db] ${resolved.message}`);
    return;
  }
  const databaseUrl = resolved.url;

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

/**
 * Whether this process is a production server.
 *
 * Read here rather than in `./config` so the rules stay pure and the ambient
 * value is looked up in exactly one place.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
