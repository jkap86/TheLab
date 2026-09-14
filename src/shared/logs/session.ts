/**
 * The visit log's session: a signed, expiring token in an HttpOnly cookie,
 * minted once against `LOGS_TOKEN` and verified on every read.
 *
 * **Why a session at all.** The page used to take its credential as `?key=`,
 * which put the operator's secret in browser history, in every referrer the
 * page sent, and — the reason this exists — in Heroku's router logs, which
 * record the query string of every request by default. A credential that has
 * to travel on every read is a credential that is written down everywhere a
 * request is. So the credential travels **once**, in a POST body over HTTPS,
 * and what travels afterwards is a token that proves the credential was
 * presented and says when that proof stops being good.
 *
 * **The token is `v1.<expiry>.<nonce>.<mac>`** — an HMAC-SHA256 over the first
 * three parts under a key derived from the operator's secrets — and it carries
 * nothing else: no id, no role, no claim about who is at the keyboard beyond
 * "somebody who knew `LOGS_TOKEN` at `expiry − ttl`". `LOGS_TOKEN` itself is
 * never inside it, never in the cookie, and never handed to the page.
 *
 * **The key is derived from both secrets, so rotating either one signs
 * everybody out.** `LOGS_SESSION_SECRET` is optional and exists so an operator
 * can end every session without changing the credential they type; absent, the
 * credential is the only secret there is and the key comes from it alone.
 * `LOGS_TOKEN` is the HKDF salt in both cases, which is what makes a rotation
 * of the credential invalidate sessions minted under the old one even when a
 * session secret is set. There is no revocation list: signing out is the
 * browser dropping its cookie, and ending a session the browser still holds is
 * a rotation. That is the honest shape for one operator reading one page.
 *
 * **Pure.** `node:crypto` is the only import, the clock and the environment are
 * arguments, and nothing here reads a header or writes a response — the routes
 * do that, and `login.ts` decides what they answer.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

/** The variable the credential lives in. */
export const LOGS_TOKEN_ENV = "LOGS_TOKEN";
/** Optional: a second secret whose rotation ends every session. */
export const LOGS_SESSION_SECRET_ENV = "LOGS_SESSION_SECRET";
/** Optional: how long a session lasts, in minutes. */
export const LOGS_SESSION_TTL_ENV = "LOGS_SESSION_TTL_MINUTES";

/** The cookie the session rides in. */
export const LOGS_SESSION_COOKIE = "thelab_logs";

/**
 * Eight hours: long enough to leave the page open across an afternoon, short
 * enough that a laptop left unlocked is not a week of exposure.
 */
export const DEFAULT_LOGS_SESSION_TTL_MINUTES = 8 * 60;
/** A week is the most a session may be configured to last. */
export const MAX_LOGS_SESSION_TTL_MINUTES = 7 * 24 * 60;
/** Five minutes is the least — under that the page signs out under its reader. */
export const MIN_LOGS_SESSION_TTL_MINUTES = 5;

/**
 * Shorter than this and the credential is guessable inside the throttle's
 * budget over a long enough time; the check is advisory and prints once.
 */
export const MIN_LOGS_TOKEN_LENGTH = 16;

const VERSION = "v1";
const NONCE_BYTES = 16;
const MAC_BYTES = 32;
const KEY_BYTES = 32;
/** `v1.` + 13-digit epoch + `.` + 22-char nonce + `.` + 43-char mac, with room. */
const MAX_SESSION_LENGTH = 96;
const HKDF_INFO = "thelab:logs-session:v1";

export type LogsConfig =
  /** A credential is set; sessions can be minted and verified. */
  | { kind: "configured"; token: string; key: Buffer; ttlMs: number; warning?: string }
  /** No credential, and the page may be shown anyway — development only. */
  | { kind: "open"; warning: string }
  /** No credential in production: the page does not exist. */
  | { kind: "denied" };

/**
 * What the environment says about the visit log's gate.
 *
 * **An unset `LOGS_TOKEN` is denied in production and open in development**,
 * which is `resolveDatabaseUrl`'s split and for the same reason: a checkout
 * with no `.env` should still render its pages, and a deployment with no
 * credential must not publish everyone's address. The two failures are not
 * symmetrical, so the rule is not either.
 */
export function logsConfig(
  env: Record<string, string | undefined>,
  production: boolean,
): LogsConfig {
  const token = env[LOGS_TOKEN_ENV]?.trim();
  if (!token) {
    if (production) return { kind: "denied" };
    return {
      kind: "open",
      // Returned rather than logged so the caller decides whether a request is
      // worth a line; a page and its API would otherwise print two per view.
      warning:
        `${LOGS_TOKEN_ENV} is not set, so /logs is open. ` +
        `Set it before deploying: the page prints visitor IP addresses.`,
    };
  }

  const secret = env[LOGS_SESSION_SECRET_ENV]?.trim();
  const key = Buffer.from(
    hkdfSync("sha256", secret || token, token, HKDF_INFO, KEY_BYTES),
  );

  const ttl = sessionTtlMinutes(env);
  const warnings: string[] = [];
  if (token.length < MIN_LOGS_TOKEN_LENGTH) {
    warnings.push(
      `${LOGS_TOKEN_ENV} is ${token.length} characters; use at least ${MIN_LOGS_TOKEN_LENGTH}.`,
    );
  }
  if (ttl.warning) warnings.push(ttl.warning);

  return {
    kind: "configured",
    token,
    key,
    ttlMs: ttl.minutes * 60_000,
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
  };
}

function sessionTtlMinutes(env: Record<string, string | undefined>): {
  minutes: number;
  warning?: string;
} {
  const raw = env[LOGS_SESSION_TTL_ENV]?.trim();
  if (!raw) return { minutes: DEFAULT_LOGS_SESSION_TTL_MINUTES };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_LOGS_SESSION_TTL_MINUTES || parsed > MAX_LOGS_SESSION_TTL_MINUTES) {
    return {
      minutes: DEFAULT_LOGS_SESSION_TTL_MINUTES,
      warning:
        `${LOGS_SESSION_TTL_ENV}=${JSON.stringify(raw)} is not a whole number of minutes ` +
        `between ${MIN_LOGS_SESSION_TTL_MINUTES} and ${MAX_LOGS_SESSION_TTL_MINUTES}; ` +
        `using ${DEFAULT_LOGS_SESSION_TTL_MINUTES}.`,
    };
  }
  return { minutes: parsed };
}

/**
 * Whether `supplied` is the credential, in constant time.
 *
 * Both sides are hashed before comparison so that the compare is over two
 * equal-length digests whatever the lengths of the inputs: `timingSafeEqual`
 * throws on unequal lengths, and a length check in front of it would leak the
 * one bit it is there to hide.
 */
export function credentialMatches(token: string, supplied: unknown): boolean {
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  const a = createHash("sha256").update(token, "utf8").digest();
  const b = createHash("sha256").update(supplied, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Mint a session that expires `ttlMs` from `now`. */
export function mintSession(
  key: Buffer,
  ttlMs: number,
  now: number = Date.now(),
  random: (bytes: number) => Buffer = randomBytes,
): { token: string; expiresAt: number } {
  const expiresAt = now + ttlMs;
  const nonce = random(NONCE_BYTES).toString("base64url");
  const signed = `${VERSION}.${expiresAt}.${nonce}`;
  const mac = createHmac("sha256", key).update(signed).digest("base64url");
  return { token: `${signed}.${mac}`, expiresAt };
}

export type SessionCheck =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "missing" | "malformed" | "invalid" | "expired" };

/**
 * Verify a session token against `key` at `now`.
 *
 * The signature is checked **before** the expiry, so a forged token learns
 * nothing from a different answer for "expired" — that reason is only ever
 * given for a token this key actually signed.
 */
export function verifySession(
  key: Buffer,
  token: string | null | undefined,
  now: number = Date.now(),
): SessionCheck {
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > MAX_SESSION_LENGTH) return { ok: false, reason: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };
  const [, expiry, nonce, mac] = parts;
  if (!/^\d{1,15}$/.test(expiry)) return { ok: false, reason: "malformed" };
  if (!/^[A-Za-z0-9_-]{22}$/.test(nonce)) return { ok: false, reason: "malformed" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(mac)) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", key).update(`${VERSION}.${expiry}.${nonce}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== MAC_BYTES || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "invalid" };
  }

  const expiresAt = Number(expiry);
  if (expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt };
}

/**
 * The `Set-Cookie` value that carries a session.
 *
 * `HttpOnly` so page script never sees it; `SameSite=Strict` so no other site
 * can ride it, which is stricter than the beacon's same-origin rule and right
 * for a page nothing links to; `Path=/` because two paths read it (`/logs` and
 * `/api/logs`); an explicit `Max-Age` so the browser's own expiry matches the
 * token's; and `Secure` wherever the request was, or the deployment is, HTTPS.
 */
export function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return [
    `${LOGS_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** The `Set-Cookie` value that ends a session on the browser's side. */
export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie("", 0, secure);
}

/**
 * The session cookie's value out of a `Cookie` header, or null.
 *
 * A hand-rolled read rather than a parser dependency: one name, no attributes
 * on the request side, and the value is opaque to everything but
 * `verifySession`, which bounds and shapes it itself.
 */
export function sessionFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== LOGS_SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}
