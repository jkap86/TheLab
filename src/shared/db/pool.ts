import { Pool } from "pg";
import { dbSsl } from "./ssl";

/**
 * Shared pg connection pool.
 *
 * Cached on globalThis so Next.js dev/HMR module reloads reuse one pool instead
 * of opening a new set of connections on every edit. `pg` is externalized in
 * next.config.ts, so this only ever runs on the Node.js server.
 *
 * `ssl` is derived from the target host (see `dbSsl`) so managed providers like
 * Heroku Postgres, which require TLS, connect without extra configuration.
 */
const globalForPool = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPool.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL, ssl: dbSsl() });

if (process.env.NODE_ENV !== "production") {
  globalForPool.pgPool = pool;
}
