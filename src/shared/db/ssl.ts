import type { ClientConfig } from "pg";

/**
 * TLS settings for the Postgres connection, shared by the runtime pool
 * (`pool.ts`) and the on-boot migration runner (`migrate.ts`).
 *
 * Managed Postgres providers (Heroku, RDS, etc.) require TLS and present a
 * self-signed certificate chain, so we enable SSL but don't reject the
 * unverifiable chain (`rejectUnauthorized: false`) — otherwise `pg` fails with
 * "self signed certificate in certificate chain". A local Postgres
 * (localhost / 127.0.0.1) normally speaks plaintext, so SSL is left off there
 * to avoid "server does not support SSL" in dev.
 *
 * Override the host-based default with `DATABASE_SSL`:
 *   - `DATABASE_SSL=require`  → force TLS on (relaxed verification)
 *   - `DATABASE_SSL=disable`  → force TLS off
 */
export function dbSsl(connectionString = process.env.DATABASE_URL): ClientConfig["ssl"] {
  const override = process.env.DATABASE_SSL;
  if (override === "disable") return false;
  if (override === "require") return { rejectUnauthorized: false };

  return isLocalHost(connectionString) ? false : { rejectUnauthorized: false };
}

function isLocalHost(connectionString?: string): boolean {
  if (!connectionString) return false;
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    // Unparseable connection string — assume a remote host and keep TLS on.
    return false;
  }
}
