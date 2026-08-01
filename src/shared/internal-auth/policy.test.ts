import assert from "node:assert/strict";
import { test } from "node:test";

import {
  internalSyncDecision,
  secretsMatch,
  INTERNAL_SYNC_HEADER,
  INTERNAL_SYNC_SECRET_ENV,
} from "./policy.ts";

test("a matching secret is authorized", () => {
  const decision = internalSyncDecision({
    provided: "s3cret",
    secret: "s3cret",
    production: true,
  });
  assert.deepEqual(decision, { ok: true, dev: false });
});

test("surrounding whitespace on either side is ignored", () => {
  const decision = internalSyncDecision({
    provided: "  s3cret ",
    secret: "s3cret\n",
    production: true,
  });
  assert.equal(decision.ok, true);
});

test("a missing header is 401, a wrong secret is 403", () => {
  const missing = internalSyncDecision({
    provided: null,
    secret: "s3cret",
    production: true,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.status, 401);
  assert.match(
    missing.ok === false ? missing.error : "",
    new RegExp(INTERNAL_SYNC_HEADER),
  );

  const wrong = internalSyncDecision({
    provided: "guess",
    secret: "s3cret",
    production: true,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.ok === false && wrong.status, 403);
});

test("an empty header value is missing, not a match against an empty secret", () => {
  const decision = internalSyncDecision({
    provided: "   ",
    secret: "s3cret",
    production: true,
  });
  assert.equal(decision.ok === false && decision.status, 401);
});

test("production with no secret configured fails closed, naming the variable", () => {
  const decision = internalSyncDecision({
    provided: "anything",
    secret: undefined,
    production: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok === false && decision.status, 503);
  assert.match(
    decision.ok === false ? decision.error : "",
    new RegExp(INTERNAL_SYNC_SECRET_ENV),
  );
});

test("a blank secret is not a configured secret", () => {
  const decision = internalSyncDecision({
    provided: "",
    secret: "   ",
    production: true,
  });
  assert.equal(decision.ok === false && decision.status, 503);
});

test("development with no secret configured is allowed, and says so", () => {
  const decision = internalSyncDecision({
    provided: null,
    secret: undefined,
    production: false,
  });
  assert.deepEqual(decision, { ok: true, dev: true });
});

test("development still enforces a secret once one is configured", () => {
  const decision = internalSyncDecision({
    provided: "guess",
    secret: "s3cret",
    production: false,
  });
  assert.equal(decision.ok === false && decision.status, 403);
});

test("secretsMatch compares unequal lengths without throwing", () => {
  assert.equal(secretsMatch("short", "a much longer secret"), false);
  assert.equal(secretsMatch("", "x"), false);
  assert.equal(secretsMatch("same", "same"), true);
});
