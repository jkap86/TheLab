/**
 * Who may read the visit log.
 *
 * Pure — the environment, the session and the clock arrive as arguments — so
 * the production rule can be checked without setting `NODE_ENV` in a test
 * process. That is `db/config`'s arrangement, and this file is deliberately
 * its shape.
 *
 * The page it guards prints IP addresses, which is the only personal data this
 * app holds about anyone who is not a Sleeper username. The app it was ported
 * from leaves the equivalent page and its API wide open on the strength of not
 * being linked from anywhere, which is not a gate. Here the read is gated by a
 * **session** — see `./session` for what one is and `./login` for how one is
 * minted — and the credential itself is never on a read: it was `?key=` once,
 * and a credential on every request is a credential in every log.
 */
import { logsConfig, verifySession } from "./session.ts";

export { LOGS_TOKEN_ENV } from "./session.ts";

export type LogsAccess =
  /** `warning` is set only where a misconfiguration is being tolerated. */
  | { ok: true; warning?: string; expiresAt?: number }
  /**
   * `denied` is a page that does not exist — no credential is configured in
   * production. `unauthenticated` is a page that exists and wants a sign-in.
   */
  | { ok: false; reason: "denied" | "unauthenticated" };

/**
 * Whether the session `supplied` opens the log.
 *
 * **An unset `LOGS_TOKEN` is denied in production and allowed in development**
 * — `logsConfig`'s split, read through. A configured deployment answers on the
 * session alone: a missing, malformed, forged or expired one is
 * `unauthenticated`, and nothing distinguishes the four to the caller, since
 * a page that says "expired" to a forged token is a page that has said the
 * token was well formed.
 */
export function logsAccess(
  env: Record<string, string | undefined>,
  supplied: string | null | undefined,
  production: boolean,
  now: number = Date.now(),
): LogsAccess {
  const config = logsConfig(env, production);
  if (config.kind === "denied") return { ok: false, reason: "denied" };
  if (config.kind === "open") return { ok: true, warning: config.warning };

  const session = verifySession(config.key, supplied, now);
  if (!session.ok) return { ok: false, reason: "unauthenticated" };
  return {
    ok: true,
    expiresAt: session.expiresAt,
    ...(config.warning ? { warning: config.warning } : {}),
  };
}
