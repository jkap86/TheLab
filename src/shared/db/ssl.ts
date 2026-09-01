import type { ClientConfig } from "pg";

/**
 * TLS settings for the Postgres connection, shared by the runtime pool
 * (`pool.ts`) and the on-boot migration runner (`migrate.ts`).
 *
 * The mode is explicit and named, because what it decides is whether the
 * server's certificate is checked at all. This used to be
 * `{ rejectUnauthorized: false }` for every non-local host — encrypted but
 * unauthenticated, which is the shape a man-in-the-middle needs — and it was
 * reached by *default*, under an option spelled `require`. A deployment can't
 * opt out of a risk it was never told about, so the insecure mode is now
 * something an operator has to write down.
 *
 *   DATABASE_SSL_MODE=disable           no TLS (local Postgres speaks plaintext)
 *   DATABASE_SSL_MODE=verify-full       TLS, certificate verified (the default)
 *   DATABASE_SSL_MODE=insecure-require  TLS, certificate NOT verified
 *
 * Default: `disable` for localhost, `verify-full` everywhere else.
 *
 * `verify-full` against a managed provider needs that provider's CA, since their
 * chains aren't in Node's trust store — supply it as `DATABASE_CA_CERT` (PEM;
 * literal `\n` sequences are unescaped, which is the form a certificate pasted
 * into a platform's config UI arrives in). Without one, a provider whose chain
 * Node can't verify now fails to connect rather than connecting unverified: a
 * loud, fixable startup failure instead of a silent downgrade.
 *
 * `insecure-require` is the compatibility escape hatch — the old behaviour under
 * a name that says what it costs.
 */

export const SSL_MODES = ["disable", "verify-full", "insecure-require"] as const;
export type SslMode = (typeof SSL_MODES)[number];

export type SslEnv = Record<string, string | undefined> & {
  DATABASE_SSL_MODE?: string;
  /** Legacy name, still honoured; `require` maps to `insecure-require`. */
  DATABASE_SSL?: string;
  DATABASE_CA_CERT?: string;
};

/**
 * Which mode applies, given the environment and the host being connected to.
 *
 * Throws on an unrecognised value rather than falling back. A typo in a TLS
 * setting silently resolving to a default is how a deployment ends up believing
 * it verifies certificates when it doesn't.
 */
export function resolveSslMode(env: SslEnv, connectionString?: string): SslMode {
  const explicit = env.DATABASE_SSL_MODE?.trim();
  if (explicit) {
    if (!isSslMode(explicit)) throw unsupported("DATABASE_SSL_MODE", explicit);
    return explicit;
  }

  // The old two-valued variable. `require` meant "TLS, verification off", so it
  // maps to the mode that now says so — renaming the behaviour rather than
  // changing it, which is what keeps an existing deployment booting.
  const legacy = env.DATABASE_SSL?.trim();
  if (legacy) {
    if (legacy === "disable") return "disable";
    if (legacy === "require") return "insecure-require";
    throw unsupported("DATABASE_SSL", legacy);
  }

  return isLocalHost(connectionString) ? "disable" : "verify-full";
}

/** The `ssl` option for `pg`, per {@link resolveSslMode}. */
export function dbSsl(
  connectionString = process.env.DATABASE_URL,
  env: SslEnv = process.env,
): ClientConfig["ssl"] {
  const mode = resolveSslMode(env, connectionString);
  if (mode === "disable") return false;
  if (mode === "insecure-require") return { rejectUnauthorized: false };

  const ca = caCertificate(env);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

/**
 * The configured CA in PEM form, or undefined.
 *
 * A certificate that travels through an environment variable usually arrives
 * with its newlines escaped — one long line reading `-----BEGIN…\n…` — which
 * OpenSSL rejects as malformed rather than as "wrong CA", so the unescaping is
 * part of reading the value, not a convenience.
 */
export function caCertificate(env: SslEnv = process.env): string | undefined {
  const raw = env.DATABASE_CA_CERT?.trim();
  if (!raw) return undefined;
  return raw.replace(/\\n/g, "\n");
}

function isSslMode(value: string): value is SslMode {
  return (SSL_MODES as readonly string[]).includes(value);
}

function unsupported(variable: string, value: string): Error {
  return new Error(
    `[db] Unsupported ${variable}="${value}"; expected one of ${SSL_MODES.join(", ")}.`,
  );
}

/** Whether the connection string points at a local Postgres. */
export function isLocalHost(connectionString?: string): boolean {
  if (!connectionString) return false;
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    // Unparseable connection string — assume a remote host and keep TLS on.
    return false;
  }
}
