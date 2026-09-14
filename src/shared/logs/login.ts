/**
 * What the sign-in and sign-out endpoints answer — decided here, pure, so the
 * whole of it runs under Node's own runner, and adapted to a `Response` by the
 * route in `app/api/logs/session`.
 *
 * The order of the refusals is the order of what they cost and what they
 * leak, most first:
 *
 * 1. **No credential configured** is a page that does not exist — a 404 in
 *    production, on the page's own rule. In development the page is open and
 *    a sign-in is a no-op.
 * 2. **Not this app's own page** is a 403 before the body is looked at, on
 *    `sameOriginRequest`'s word. A forgery here would spend the operator's
 *    credential from another site's page; the browser's own headers say
 *    whether that is what happened.
 * 3. **Not HTTPS, in production**, is a 403 rather than a redirect: a redirect
 *    of a POST loses the body, and a credential that has already crossed the
 *    wire in the clear is not made safe by being asked for again. The proxy
 *    refuses such a request before it reaches here; this is the route standing
 *    on its own.
 * 4. **Too many wrong guesses** is a 429 with a `Retry-After`, from either the
 *    client's own budget or the process's, before the guess is checked — a
 *    locked key learns nothing from the answer.
 * 5. **A body that is not a sign-in** is a 400 or a 413 and is not counted as a
 *    guess: nothing was guessed.
 * 6. **A wrong credential** is a 401 and a failure on both throttle keys.
 * 7. **The right one** mints a session, clears the client's failures, and sets
 *    the cookie.
 *
 * Every answer carries `Cache-Control: no-store`.
 */
import type { ApiErrorPayload } from "../contract/api-error-payload";
import type { JsonRead } from "../request/body";
import { sameOriginRequest } from "../request/origin.ts";

import { GLOBAL_LOGIN_KEY } from "./login-throttle.ts";
import type { LoginThrottle } from "./login-throttle.ts";
import {
  clearedSessionCookie,
  credentialMatches,
  mintSession,
  sessionCookie,
} from "./session.ts";
import type { LogsConfig } from "./session.ts";

/** The most a credential may be, in characters — well past any real token. */
export const MAX_CREDENTIAL_LENGTH = 512;

export type LoginSuccess = { ok: true; expires_at: number };

export type LoginDecision = {
  status: number;
  body: ApiErrorPayload | LoginSuccess | null;
  headers: Record<string, string>;
};

export type LoginInput = {
  config: LogsConfig;
  production: boolean;
  headers: Headers;
  /** The body, already read within a bound — see `readJsonWithin`. */
  body: JsonRead;
  /** Who is asking, for the throttle — `clientKey`'s answer. */
  client: string;
  now: number;
  throttle: { client: LoginThrottle; global: LoginThrottle };
  random?: (bytes: number) => Buffer;
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

function refuse(status: number, error: string, headers: Record<string, string> = {}): LoginDecision {
  return { status, body: { error }, headers: { ...NO_STORE, ...headers } };
}

/** Whether the request reached this app over HTTPS, on the router's word. */
export function requestIsHttps(headers: Headers): boolean {
  return headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https";
}

export function loginRequest(input: LoginInput): LoginDecision {
  const { config, production, headers, body, client, now, throttle } = input;

  if (config.kind === "denied") return refuse(404, "Not found");
  if (config.kind === "open") return { status: 204, body: null, headers: { ...NO_STORE } };

  const origin = sameOriginRequest(headers);
  if (!origin.ok) return refuse(403, "Forbidden");

  const https = requestIsHttps(headers);
  if (production && !https) return refuse(403, "HTTPS required");

  for (const [gate, key] of [
    [throttle.client, client],
    [throttle.global, GLOBAL_LOGIN_KEY],
  ] as const) {
    const check = gate.check(key, now);
    if (!check.ok) {
      return refuse(429, "Too many attempts", {
        "Retry-After": String(check.retryAfterSeconds),
      });
    }
  }

  if (!body.ok) {
    if (body.reason === "too-large") return refuse(413, "Body too large");
    return refuse(400, "Expected { token }");
  }
  const supplied = credentialOf(body.value);
  if (supplied === null) return refuse(400, "Expected { token }");

  if (!credentialMatches(config.token, supplied)) {
    throttle.client.fail(client, now);
    throttle.global.fail(GLOBAL_LOGIN_KEY, now);
    return refuse(401, "That is not the token");
  }

  throttle.client.succeed(client);
  const session = mintSession(config.key, config.ttlMs, now, input.random);
  return {
    status: 200,
    body: { ok: true, expires_at: session.expiresAt },
    headers: {
      ...NO_STORE,
      "Set-Cookie": sessionCookie(
        session.token,
        Math.floor(config.ttlMs / 1000),
        production || https,
      ),
    },
  };
}

/** The credential out of a parsed body, or null for a body that is not one. */
function credentialOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("token" in value)) return null;
  const token = (value as { token: unknown }).token;
  if (typeof token !== "string") return null;
  if (token.length === 0 || token.length > MAX_CREDENTIAL_LENGTH) return null;
  return token;
}

export type LogoutInput = {
  production: boolean;
  headers: Headers;
};

/**
 * Sign out: clear the cookie.
 *
 * Same-origin is asked for even here — a forged sign-out is a nuisance rather
 * than a breach, but the check costs nothing and a route that refuses forged
 * mutations on one method and not the other is a rule with an exception
 * nobody argued for.
 */
export function logoutRequest({ production, headers }: LogoutInput): LoginDecision {
  const origin = sameOriginRequest(headers);
  if (!origin.ok) return refuse(403, "Forbidden");
  return {
    status: 204,
    body: null,
    headers: {
      ...NO_STORE,
      "Set-Cookie": clearedSessionCookie(production || requestIsHttps(headers)),
    },
  };
}
