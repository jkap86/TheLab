import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { JsonRead } from "../request/body.ts";

import { createLoginThrottle } from "./login-throttle.ts";
import { loginRequest, logoutRequest, MAX_CREDENTIAL_LENGTH } from "./login.ts";
import type { LoginInput } from "./login.ts";
import { LOGS_SESSION_COOKIE, LOGS_TOKEN_ENV, logsConfig, verifySession } from "./session.ts";

const TOKEN = "correct-horse-battery-staple";
const NOW = 1_700_000_000_000;

function throttles() {
  return {
    client: createLoginThrottle({ maxFailures: 3, windowMs: 60_000, lockMs: 30_000, maxKeys: 100 }),
    global: createLoginThrottle({ maxFailures: 5, windowMs: 60_000, lockMs: 10_000, maxKeys: 1 }),
  };
}

function headersFor(overrides: Record<string, string | null> = {}): Headers {
  const h = new Headers({
    host: "thelab.example",
    origin: "https://thelab.example",
    "x-forwarded-proto": "https",
    "sec-fetch-site": "same-origin",
  });
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) h.delete(k);
    else h.set(k, v);
  }
  return h;
}

const good: JsonRead = { ok: true, value: { token: TOKEN }, bytes: 40 };
const wrong: JsonRead = { ok: true, value: { token: "nope-nope-nope-nope" }, bytes: 30 };

function input(overrides: Partial<LoginInput> = {}): LoginInput {
  return {
    config: logsConfig({ [LOGS_TOKEN_ENV]: TOKEN }, true),
    production: true,
    headers: headersFor(),
    body: good,
    client: "203.0.113.5",
    now: NOW,
    throttle: throttles(),
    ...overrides,
  };
}

describe("signing in", () => {
  test("the right credential mints a session in an HttpOnly, Secure, Strict cookie", () => {
    const decision = loginRequest(input());
    assert.equal(decision.status, 200);
    assert.deepEqual(decision.body, { ok: true, expires_at: NOW + 8 * 60 * 60_000 });
    assert.equal(decision.headers["Cache-Control"], "no-store");
    const cookie = decision.headers["Set-Cookie"];
    assert.match(cookie, new RegExp(`^${LOGS_SESSION_COOKIE}=v1\\.`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=28800/);
    assert.equal(cookie.includes(TOKEN), false);
    const value = cookie.slice(LOGS_SESSION_COOKIE.length + 1, cookie.indexOf(";"));
    const config = logsConfig({ [LOGS_TOKEN_ENV]: TOKEN }, true);
    assert.equal(config.kind, "configured");
    assert.equal(verifySession((config as { key: Buffer }).key, value, NOW).ok, true);
  });

  test("a wrong credential is a 401 and counts toward both budgets", () => {
    const t = throttles();
    for (let i = 0; i < 3; i++) {
      const decision = loginRequest(input({ body: wrong, throttle: t }));
      assert.equal(decision.status, 401);
      assert.equal(decision.headers["Set-Cookie"], undefined);
      assert.equal(decision.headers["Cache-Control"], "no-store");
    }
    const locked = loginRequest(input({ body: good, throttle: t }));
    assert.equal(locked.status, 429);
    assert.equal(locked.headers["Retry-After"], "30");
    // A locked client learns nothing even with the right credential.
    assert.equal(locked.headers["Set-Cookie"], undefined);
    // Another client is refused only once the process budget is spent.
    assert.equal(loginRequest(input({ body: wrong, throttle: t, client: "198.51.100.9" })).status, 401);
    assert.equal(loginRequest(input({ body: wrong, throttle: t, client: "198.51.100.9" })).status, 401);
    const globalLock = loginRequest(input({ body: good, throttle: t, client: "192.0.2.77" }));
    assert.equal(globalLock.status, 429);
    assert.equal(globalLock.headers["Retry-After"], "10");
    // And the lock lifts.
    assert.equal(loginRequest(input({ body: good, throttle: t, client: "192.0.2.77", now: NOW + 10_001 })).status, 200);
  });

  test("a success clears the client's failures", () => {
    const t = throttles();
    loginRequest(input({ body: wrong, throttle: t }));
    loginRequest(input({ body: wrong, throttle: t }));
    assert.equal(loginRequest(input({ body: good, throttle: t })).status, 200);
    loginRequest(input({ body: wrong, throttle: t }));
    loginRequest(input({ body: wrong, throttle: t }));
    assert.equal(loginRequest(input({ body: good, throttle: t })).status, 200);
  });

  test("a cross-site request is refused before the body is read, and not counted", () => {
    const t = throttles();
    for (const headers of [
      headersFor({ "sec-fetch-site": "cross-site" }),
      headersFor({ origin: "https://evil.example" }),
      headersFor({ origin: null, "sec-fetch-site": null }),
      headersFor({ origin: "http://thelab.example" }),
    ]) {
      const decision = loginRequest(input({ headers, body: wrong, throttle: t }));
      assert.equal(decision.status, 403);
    }
    assert.equal(loginRequest(input({ body: good, throttle: t })).status, 200);
  });

  test("an insecure request is refused in production and allowed in development", () => {
    const insecure = headersFor({ "x-forwarded-proto": "http", origin: "http://thelab.example" });
    assert.equal(loginRequest(input({ headers: insecure })).status, 403);
    const dev = loginRequest(input({
      headers: headersFor({ "x-forwarded-proto": null, origin: "http://localhost:3000", host: "localhost:3000" }),
      production: false,
      config: logsConfig({ [LOGS_TOKEN_ENV]: TOKEN }, false),
    }));
    assert.equal(dev.status, 200);
    assert.equal(dev.headers["Set-Cookie"].includes("Secure"), false);
  });

  test("a body that is not a sign-in is a 400 or a 413 and is not a guess", () => {
    const t = throttles();
    const cases: Array<[JsonRead, number]> = [
      [{ ok: false, reason: "too-large" }, 413],
      [{ ok: false, reason: "malformed" }, 400],
      [{ ok: false, reason: "empty" }, 400],
      [{ ok: false, reason: "encoding" }, 400],
      [{ ok: false, reason: "interrupted" }, 400],
      [{ ok: true, value: "string", bytes: 8 }, 400],
      [{ ok: true, value: { token: 42 }, bytes: 8 }, 400],
      [{ ok: true, value: { token: "" }, bytes: 8 }, 400],
      [{ ok: true, value: { token: "x".repeat(MAX_CREDENTIAL_LENGTH + 1) }, bytes: 600 }, 400],
      [{ ok: true, value: null, bytes: 4 }, 400],
    ];
    for (const [body, status] of cases) {
      assert.equal(loginRequest(input({ body, throttle: t })).status, status, JSON.stringify(body));
    }
    assert.equal(loginRequest(input({ body: good, throttle: t })).status, 200);
  });

  test("with no credential configured: 404 in production, a no-op in development", () => {
    assert.equal(loginRequest(input({ config: logsConfig({}, true) })).status, 404);
    const dev = loginRequest(input({ config: logsConfig({}, false), production: false }));
    assert.equal(dev.status, 204);
    assert.equal(dev.headers["Set-Cookie"], undefined);
  });
});

describe("signing out", () => {
  test("clears the cookie for a same-origin request and refuses a forged one", () => {
    const out = logoutRequest({ production: true, headers: headersFor() });
    assert.equal(out.status, 204);
    assert.match(out.headers["Set-Cookie"], /Max-Age=0/);
    assert.match(out.headers["Set-Cookie"], /Secure/);
    assert.equal(out.headers["Cache-Control"], "no-store");
    assert.equal(logoutRequest({ production: true, headers: headersFor({ origin: "https://evil.example" }) }).status, 403);
  });
});
