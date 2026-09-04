/**
 * Who may read the visit log.
 *
 * Pure — the environment arrives as an argument — so the production rule can be
 * checked without setting `NODE_ENV` in a test process. That is `db/config`'s
 * arrangement, and this file is deliberately its shape.
 *
 * The page it guards prints IP addresses, which is the only personal data this
 * app holds about anyone who is not a Sleeper username. The app it was ported
 * from leaves the equivalent page and its API wide open on the strength of not
 * being linked from anywhere, which is not a gate, and its write endpoint open
 * too — anyone could pollute the table indefinitely. Here the read is gated and
 * there is no write endpoint at all: the proxy is the only writer.
 */

/** The variable every path here is about. */
export const LOGS_TOKEN_ENV = "LOGS_TOKEN";

export type LogsAccess =
  /** `warning` is set only where a misconfiguration is being tolerated. */
  | { ok: true; warning?: string }
  | { ok: false };

/**
 * Whether `supplied` opens the log.
 *
 * **An unset `LOGS_TOKEN` is denied in production and allowed in development**,
 * which is the split `resolveDatabaseUrl` already makes and for the same
 * reason: a checkout with no `.env` should still render its pages, and a
 * deployment with no token should not silently publish everyone's address. The
 * two failures are not symmetrical, so the rule is not either.
 */
export function logsAccess(
  env: Record<string, string | undefined>,
  supplied: string | null | undefined,
  production: boolean,
): LogsAccess {
  const token = env[LOGS_TOKEN_ENV]?.trim();

  if (!token) {
    if (production) return { ok: false };
    return {
      ok: true,
      // Returned rather than logged so the caller decides whether a request is
      // worth a line; a page and its API would otherwise print two per view.
      warning:
        `${LOGS_TOKEN_ENV} is not set, so /logs is open. ` +
        `Set it before deploying: the page prints visitor IP addresses.`,
    };
  }

  return matches(token, supplied) ? { ok: true } : { ok: false };
}

/**
 * Constant-time-ish comparison.
 *
 * The real protection is the token's entropy — a remote timing attack across a
 * network against a string compare is not the threat this page has — but the
 * comparison is three lines either way, and a length-leaking `===` on a secret
 * is the kind of thing that gets copied into somewhere it does matter.
 *
 * `node:crypto` is not imported: `timingSafeEqual` throws on unequal lengths,
 * so a length check would have to come first and would leak the same bit this
 * is meant to hide. The fold below reads every byte of both strings regardless.
 */
function matches(token: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  let diff = token.length ^ supplied.length;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ supplied.charCodeAt(i % supplied.length);
  }
  return diff === 0;
}
