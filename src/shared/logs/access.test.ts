import assert from "node:assert/strict";
import { test } from "node:test";

import { LOGS_TOKEN_ENV, logsAccess } from "./access.ts";
import { logsConfig, mintSession } from "./session.ts";

const TOKEN = "correct-horse-battery-staple";
const withToken = { [LOGS_TOKEN_ENV]: TOKEN };
const NOW = 1_700_000_000_000;

function session(env = withToken, now = NOW) {
  const config = logsConfig(env, true);
  assert.equal(config.kind, "configured");
  const { key, ttlMs } = config as Extract<ReturnType<typeof logsConfig>, { kind: "configured" }>;
  return mintSession(key, ttlMs, now);
}

test("a live session opens it", () => {
  const { token, expiresAt } = session();
  assert.deepEqual(logsAccess(withToken, token, true, NOW), { ok: true, expiresAt });
});

test("the credential itself never opens a read", () => {
  // It was `?key=` once; a credential on every request is a credential in
  // every log, which is the whole reason the session exists.
  assert.deepEqual(logsAccess(withToken, TOKEN, true, NOW), { ok: false, reason: "unauthenticated" });
});

test("a missing, forged or expired session is unauthenticated, indistinguishably", () => {
  const { token, expiresAt } = session();
  for (const [supplied, now] of [
    [null, NOW],
    [undefined, NOW],
    ["", NOW],
    ["v1.1.a.b", NOW],
    [token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), NOW],
    [token, expiresAt],
  ] as const) {
    assert.deepEqual(logsAccess(withToken, supplied, true, now), { ok: false, reason: "unauthenticated" }, String(supplied));
  }
});

test("an unset token is denied in production", () => {
  // The page prints visitor addresses; a deployment that forgot the variable
  // must not publish them.
  assert.deepEqual(logsAccess({}, null, true, NOW), { ok: false, reason: "denied" });
  assert.deepEqual(logsAccess({}, "anything", true, NOW), { ok: false, reason: "denied" });
});

test("an unset token is allowed in development, and says so", () => {
  // `resolveDatabaseUrl`'s split: a checkout with no .env still renders.
  const access = logsAccess({}, null, false, NOW);
  assert.equal(access.ok, true);
  assert.match(access.ok ? (access.warning ?? "") : "", /LOGS_TOKEN/);
});

test("a blank token counts as unset", () => {
  assert.equal(logsAccess({ [LOGS_TOKEN_ENV]: "   " }, "   ", true, NOW).ok, false);
});

test("a set token is still required in development", () => {
  assert.equal(logsAccess(withToken, null, false, NOW).ok, false);
  assert.equal(logsAccess(withToken, session().token, false, NOW).ok, true);
});

test("rotating the token signs every session out", () => {
  const { token } = session();
  assert.equal(logsAccess({ [LOGS_TOKEN_ENV]: `${TOKEN}-rotated` }, token, true, NOW).ok, false);
});
