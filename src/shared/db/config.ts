/**
 * What the database connection needs from the environment, decided once and
 * testably.
 *
 * Pure — the environment arrives as an argument — so the production rules can be
 * checked without setting `NODE_ENV` in a test process.
 */

/** The variable every path here is about. */
export const DATABASE_URL_ENV = "DATABASE_URL";

export type DatabaseUrlResolution =
  | { ok: true; url: string }
  | { ok: false; fatal: boolean; message: string };

/**
 * Resolve `DATABASE_URL`, and say whether its absence is fatal.
 *
 * In production it is: `pg` falls back to libpq's own defaults (the OS user, a
 * local socket, a database named after the user), so a missing variable used to
 * mean the app booted, skipped its migrations with a warning, started all three
 * background loops, and then failed — or worse, quietly connected somewhere
 * nobody intended. "Alive but wrong" is the state this refuses.
 *
 * In development it is not, deliberately: `npm run dev` against a checkout with
 * no `.env` should still render pages and fail on the routes that need data,
 * which is how you find out you haven't configured it yet. The message names the
 * variable either way.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
  production: boolean,
): DatabaseUrlResolution {
  const url = env.DATABASE_URL?.trim();
  if (url) return { ok: true, url };

  return {
    ok: false,
    fatal: production,
    message: production
      ? `${DATABASE_URL_ENV} is not set. Refusing to start: without it ` +
        `Postgres would be picked from client defaults rather than configuration.`
      : `${DATABASE_URL_ENV} is not set; skipping migrations on boot. ` +
        `Set it in .env before using anything that reads the database.`,
  };
}
