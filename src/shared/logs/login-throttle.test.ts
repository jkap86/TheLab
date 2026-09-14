import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createLoginThrottle, GLOBAL_LOGIN_THROTTLE, PER_CLIENT_LOGIN_THROTTLE } from "./login-throttle.ts";

const NOW = 1_700_000_000_000;

describe("the login throttle", () => {
  test("locks a key after its failures and refuses it for the lock, with a Retry-After", () => {
    const t = createLoginThrottle({ maxFailures: 3, windowMs: 60_000, lockMs: 30_000, maxKeys: 10 });
    t.fail("a", NOW);
    t.fail("a", NOW + 1);
    assert.deepEqual(t.check("a", NOW + 2), { ok: true });
    t.fail("a", NOW + 2);
    assert.deepEqual(t.check("a", NOW + 3), { ok: false, retryAfterSeconds: 30 });
    assert.deepEqual(t.check("a", NOW + 29_500), { ok: false, retryAfterSeconds: 1 });
    assert.deepEqual(t.check("a", NOW + 30_002), { ok: true });
  });

  test("failures outside the window are forgotten", () => {
    const t = createLoginThrottle({ maxFailures: 2, windowMs: 1_000, lockMs: 30_000, maxKeys: 10 });
    t.fail("a", NOW);
    t.fail("a", NOW + 2_000); // a new window
    assert.deepEqual(t.check("a", NOW + 2_001), { ok: true });
  });

  test("one key's lock is not another's", () => {
    const t = createLoginThrottle({ maxFailures: 1, windowMs: 60_000, lockMs: 30_000, maxKeys: 10 });
    t.fail("a", NOW);
    assert.equal(t.check("a", NOW).ok, false);
    assert.equal(t.check("b", NOW).ok, true);
  });

  test("a success clears the key", () => {
    const t = createLoginThrottle({ maxFailures: 2, windowMs: 60_000, lockMs: 30_000, maxKeys: 10 });
    t.fail("a", NOW);
    t.succeed("a");
    t.fail("a", NOW);
    assert.equal(t.check("a", NOW).ok, true);
  });

  test("the map is bounded, oldest first", () => {
    const t = createLoginThrottle({ maxFailures: 5, windowMs: 60_000, lockMs: 30_000, maxKeys: 3 });
    for (const k of ["a", "b", "c", "d"]) t.fail(k, NOW);
    assert.equal(t.size(), 3);
  });

  test("the shipped budgets: a client is slower than the process, and the process's lock is short", () => {
    assert.ok(PER_CLIENT_LOGIN_THROTTLE.maxFailures < GLOBAL_LOGIN_THROTTLE.maxFailures);
    assert.ok(GLOBAL_LOGIN_THROTTLE.lockMs < PER_CLIENT_LOGIN_THROTTLE.lockMs);
    assert.equal(GLOBAL_LOGIN_THROTTLE.maxKeys, 1);
  });
});
