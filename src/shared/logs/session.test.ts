import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  clearedSessionCookie,
  credentialMatches,
  DEFAULT_LOGS_SESSION_TTL_MINUTES,
  LOGS_SESSION_COOKIE,
  LOGS_SESSION_SECRET_ENV,
  LOGS_SESSION_TTL_ENV,
  LOGS_TOKEN_ENV,
  logsConfig,
  mintSession,
  sessionCookie,
  sessionFromCookieHeader,
  verifySession,
} from "./session.ts";

const TOKEN = "correct-horse-battery-staple";
const env = { [LOGS_TOKEN_ENV]: TOKEN };
const NOW = 1_700_000_000_000;

function configured(e: Record<string, string | undefined> = env) {
  const config = logsConfig(e, true);
  assert.equal(config.kind, "configured");
  return config as Extract<ReturnType<typeof logsConfig>, { kind: "configured" }>;
}

describe("logsConfig", () => {
  test("an unset credential is denied in production and open in development", () => {
    assert.deepEqual(logsConfig({}, true), { kind: "denied" });
    const dev = logsConfig({}, false);
    assert.equal(dev.kind, "open");
    assert.match(dev.kind === "open" ? dev.warning : "", /LOGS_TOKEN/);
  });

  test("a blank credential counts as unset", () => {
    assert.equal(logsConfig({ [LOGS_TOKEN_ENV]: "   " }, true).kind, "denied");
  });

  test("the credential is never inside the derived key", () => {
    const config = configured();
    assert.equal(config.key.length, 32);
    assert.equal(config.key.toString("latin1").includes(TOKEN), false);
    assert.equal(config.ttlMs, DEFAULT_LOGS_SESSION_TTL_MINUTES * 60_000);
  });

  test("a short credential and a junk TTL are warned about, not refused", () => {
    const config = configured({ [LOGS_TOKEN_ENV]: "short", [LOGS_SESSION_TTL_ENV]: "abc" });
    assert.match(config.warning ?? "", /at least 16/);
    assert.match(config.warning ?? "", /LOGS_SESSION_TTL_MINUTES/);
    assert.equal(config.ttlMs, DEFAULT_LOGS_SESSION_TTL_MINUTES * 60_000);
  });

  test("the TTL is read in minutes inside its bounds", () => {
    assert.equal(configured({ ...env, [LOGS_SESSION_TTL_ENV]: "30" }).ttlMs, 30 * 60_000);
    assert.equal(configured({ ...env, [LOGS_SESSION_TTL_ENV]: "1" }).warning !== undefined, true);
    assert.equal(configured({ ...env, [LOGS_SESSION_TTL_ENV]: "999999" }).warning !== undefined, true);
  });
});

describe("a session", () => {
  test("round-trips under the key that minted it, until it expires", () => {
    const { key, ttlMs } = configured();
    const { token, expiresAt } = mintSession(key, ttlMs, NOW);
    assert.equal(expiresAt, NOW + ttlMs);
    assert.deepEqual(verifySession(key, token, NOW), { ok: true, expiresAt });
    assert.deepEqual(verifySession(key, token, expiresAt - 1), { ok: true, expiresAt });
    assert.deepEqual(verifySession(key, token, expiresAt), { ok: false, reason: "expired" });
  });

  test("carries neither the credential nor anything but a version, an expiry, a nonce and a mac", () => {
    const { key, ttlMs } = configured();
    const { token } = mintSession(key, ttlMs, NOW);
    assert.equal(token.includes(TOKEN), false);
    assert.equal(token.includes(key.toString("base64url")), false);
    assert.match(token, /^v1\.\d+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  });

  test("two sessions minted at once differ", () => {
    const { key, ttlMs } = configured();
    assert.notEqual(mintSession(key, ttlMs, NOW).token, mintSession(key, ttlMs, NOW).token);
  });

  test("a tampered expiry, nonce or mac is invalid, never expired", () => {
    const { key, ttlMs } = configured();
    const { token } = mintSession(key, ttlMs, NOW);
    const [v, exp, nonce, mac] = token.split(".");
    const later = String(Number(exp) + 60_000);
    assert.deepEqual(verifySession(key, `${v}.${later}.${nonce}.${mac}`, NOW), { ok: false, reason: "invalid" });
    const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
    assert.deepEqual(verifySession(key, `${v}.${exp}.${nonce}.${flipped}`, NOW), { ok: false, reason: "invalid" });
    const otherNonce = (nonce[0] === "A" ? "B" : "A") + nonce.slice(1);
    assert.deepEqual(verifySession(key, `${v}.${exp}.${otherNonce}.${mac}`, NOW), { ok: false, reason: "invalid" });
    // An expired token whose mac was forged is still "invalid": the signature
    // is checked first so a forgery cannot learn it had the shape right.
    const past = String(NOW - 1);
    assert.deepEqual(verifySession(key, `${v}.${past}.${nonce}.${mac}`, NOW), { ok: false, reason: "invalid" });
  });

  test("rotating the credential or the session secret invalidates every session", () => {
    const { key, ttlMs } = configured();
    const { token } = mintSession(key, ttlMs, NOW);
    const rotatedToken = configured({ [LOGS_TOKEN_ENV]: `${TOKEN}-2` });
    assert.equal(verifySession(rotatedToken.key, token, NOW).ok, false);
    const withSecret = configured({ ...env, [LOGS_SESSION_SECRET_ENV]: "secret-one" });
    assert.equal(verifySession(withSecret.key, token, NOW).ok, false);
    const fromSecret = mintSession(withSecret.key, ttlMs, NOW).token;
    const rotatedSecret = configured({ ...env, [LOGS_SESSION_SECRET_ENV]: "secret-two" });
    assert.equal(verifySession(rotatedSecret.key, fromSecret, NOW).ok, false);
    // And rotating the credential while a secret is set still signs out.
    const rotatedBoth = configured({ [LOGS_TOKEN_ENV]: `${TOKEN}-2`, [LOGS_SESSION_SECRET_ENV]: "secret-one" });
    assert.equal(verifySession(rotatedBoth.key, fromSecret, NOW).ok, false);
  });

  test("malformed input is refused without throwing", () => {
    const { key } = configured();
    for (const bad of [
      null,
      undefined,
      "",
      "v1",
      "v1..",
      "v0.1.a.b",
      "v1.abc.nonce.mac",
      `v1.${NOW}.short.short`,
      "x".repeat(200),
      `v1.${NOW}.${"a".repeat(22)}.${"%".repeat(43)}`,
      `v1.${NOW}.${"a".repeat(22)}.${"a".repeat(43)}.extra`,
    ]) {
      const check = verifySession(key, bad, NOW);
      assert.equal(check.ok, false, String(bad));
      assert.notEqual((check as { reason: string }).reason, "expired", String(bad));
    }
  });
});

describe("credentialMatches", () => {
  test("only the whole credential matches", () => {
    assert.equal(credentialMatches(TOKEN, TOKEN), true);
    for (const wrong of [null, undefined, "", TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase(), 42]) {
      assert.equal(credentialMatches(TOKEN, wrong), false, String(wrong));
    }
  });
});

describe("the cookie", () => {
  test("is HttpOnly, SameSite=Strict, path-wide, expiring, and Secure over HTTPS", () => {
    const secure = sessionCookie("tok", 3600, true);
    assert.equal(secure, `${LOGS_SESSION_COOKIE}=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure`);
    const plain = sessionCookie("tok", 3600.9, false);
    assert.equal(plain.includes("Secure"), false);
    assert.match(plain, /Max-Age=3600(;|$)/);
  });

  test("clearing it is the same cookie with nothing in it and no life", () => {
    assert.equal(clearedSessionCookie(true), `${LOGS_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
  });

  test("is read out of a Cookie header among others, and only by name", () => {
    assert.equal(sessionFromCookieHeader(`a=1; ${LOGS_SESSION_COOKIE}=v1.x.y.z ; b=2`), "v1.x.y.z");
    assert.equal(sessionFromCookieHeader(`${LOGS_SESSION_COOKIE}x=nope`), null);
    assert.equal(sessionFromCookieHeader(`${LOGS_SESSION_COOKIE}=`), null);
    assert.equal(sessionFromCookieHeader(null), null);
    assert.equal(sessionFromCookieHeader("a=1"), null);
  });
});
