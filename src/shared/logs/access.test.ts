import assert from "node:assert/strict";
import { test } from "node:test";

import { LOGS_TOKEN_ENV, logsAccess } from "./access.ts";

const withToken = { [LOGS_TOKEN_ENV]: "s3cret-token" };

test("the right token opens it", () => {
  assert.deepEqual(logsAccess(withToken, "s3cret-token", true), { ok: true });
});

test("a wrong, absent or partial token does not", () => {
  for (const supplied of [null, undefined, "", "wrong", "s3cret", "s3cret-tokenn"]) {
    assert.equal(logsAccess(withToken, supplied, true).ok, false, String(supplied));
  }
});

test("an unset token is denied in production", () => {
  // The page prints visitor addresses; a deployment that forgot the variable
  // must not publish them.
  assert.deepEqual(logsAccess({}, null, true), { ok: false });
  assert.deepEqual(logsAccess({}, "anything", true), { ok: false });
});

test("an unset token is allowed in development, and says so", () => {
  // `resolveDatabaseUrl`'s split: a checkout with no .env still renders.
  const access = logsAccess({}, null, false);
  assert.equal(access.ok, true);
  assert.match(access.ok ? (access.warning ?? "") : "", /LOGS_TOKEN/);
});

test("a blank token counts as unset", () => {
  assert.equal(logsAccess({ [LOGS_TOKEN_ENV]: "   " }, "   ", true).ok, false);
});

test("a set token is still required in development", () => {
  assert.equal(logsAccess(withToken, "wrong", false).ok, false);
  assert.equal(logsAccess(withToken, "s3cret-token", false).ok, true);
});
