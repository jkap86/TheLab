/**
 * Turning a TLS verification failure into the sentence that fixes it.
 *
 * `verify-full` refusing a managed provider's certificate is the *intended*
 * behaviour (see `./ssl`) — a loud startup failure instead of a silent downgrade
 * to encrypted-but-unauthenticated. What reaches the log, though, is OpenSSL's
 * six words:
 *
 *   Error: An error occurred while loading instrumentation hook: unable to get
 *   local issuer certificate
 *
 * Next prints only `error.message` from a failing `register`, so nothing in that
 * line names Postgres, the host, `DATABASE_SSL_MODE` or `DATABASE_CA_CERT` — a
 * failure that is one config var away from fixed reads as the framework being
 * broken. The guidance therefore has to live in the *message*, not beside it in a
 * `console.error` the hook's own error swallows.
 *
 * Pure — the environment and the connection string arrive as arguments — so the
 * advice can be tested without a database or a certificate.
 */

import { caCertificate, resolveSslMode, type SslEnv } from "./ssl.ts";

/**
 * OpenSSL's chain-verification codes, plus Node's hostname-mismatch one.
 *
 * These are the failures `verify-full` produces and the other two modes cannot,
 * which is what makes naming the two variables the right advice. A connection
 * refused, a bad password or a timeout must fall through untouched — telling an
 * operator to configure a CA because Postgres was asleep is worse than saying
 * nothing.
 */
const VERIFICATION_CODES: ReadonlySet<string> = new Set([
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** The error's `code`, if it carries one. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Whether this is a certificate the client refused, rather than any other failure. */
export function isCertificateVerificationError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && VERIFICATION_CODES.has(code);
}

/**
 * The host a connection string points at, for naming in a message.
 *
 * The string itself is never quoted: it carries the password.
 */
function hostOf(connectionString?: string): string {
  if (!connectionString) return "the database";
  try {
    const { hostname, port } = new URL(connectionString);
    return port ? `${hostname}:${port}` : hostname;
  } catch {
    return "the database";
  }
}

/**
 * Actionable advice for a rejected certificate, or `null` if this error isn't
 * one — or is one under a mode where the advice would be wrong.
 *
 * `insecure-require` doesn't verify and `disable` doesn't negotiate TLS at all,
 * so a verification code arriving under either means something other than
 * configuration is going on; better to leave the original error alone than to
 * point at a variable that is already doing what it says.
 */
export function tlsAdviceFor(
  error: unknown,
  connectionString?: string,
  env: SslEnv = process.env,
): string | null {
  if (!isCertificateVerificationError(error)) return null;

  let mode;
  try {
    mode = resolveSslMode(env, connectionString);
  } catch {
    // An unsupported mode throws its own, already-clear error elsewhere.
    return null;
  }
  if (mode !== "verify-full") return null;

  const host = hostOf(connectionString);
  const detail =
    error instanceof Error && error.message ? `: ${error.message}` : "";
  const remedy = caCertificate(env)
    ? "DATABASE_CA_CERT is set but does not verify this certificate — check " +
      "it is the provider's current CA and that the whole PEM was pasted."
    : "No DATABASE_CA_CERT is set, so Node is verifying against its own trust " +
      "store, which managed providers' chains are not in. Set DATABASE_CA_CERT " +
      "to the provider's CA in PEM form.";

  return (
    `[db] TLS certificate verification failed connecting to ${host}${detail}. ` +
    `DATABASE_SSL_MODE is verify-full (the default for a remote host). ` +
    `${remedy} ` +
    `To connect encrypted but unverified instead — the pre-TLS-mode behaviour, ` +
    `and what Heroku Postgres needs, since it presents a self-signed ` +
    `certificate and publishes no CA — set DATABASE_SSL_MODE=insecure-require.`
  );
}

/**
 * `error`, or a replacement carrying {@link tlsAdviceFor}'s message.
 *
 * The original hangs off `cause`, so a stack trace survives for anyone reading
 * more than the first line.
 */
export function withTlsAdvice(
  error: unknown,
  connectionString?: string,
  env: SslEnv = process.env,
): unknown {
  const advice = tlsAdviceFor(error, connectionString, env);
  return advice === null ? error : new Error(advice, { cause: error });
}
