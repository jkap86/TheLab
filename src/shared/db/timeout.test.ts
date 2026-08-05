import assert from "node:assert/strict";
import { test } from "node:test";

import { isDatabaseBusy } from "./timeout.ts";

test("the bounds this app sets read as busy", () => {
  for (const code of ["57014", "55P03", "25P03", "53300"]) {
    assert.equal(isDatabaseBusy(Object.assign(new Error("x"), { code })), true, code);
  }
});

test("a query that is simply wrong does not", () => {
  // `42703` is an undefined column: a bug, a 500, and something a retry will
  // fail at identically. Answering it as "busy" would tell a client to keep
  // asking.
  const broken = Object.assign(new Error("column x does not exist"), {
    code: "42703",
  });
  assert.equal(isDatabaseBusy(broken), false);
});

test("the pool's own acquisition timeout reads as busy", () => {
  // Pinned to the exact string `pg` throws, because it carries no code and this
  // match is the only thing standing between a saturated pool and a 500.
  assert.equal(
    isDatabaseBusy(new Error("timeout exceeded when trying to connect")),
    true,
  );
});

test("a bounded advisory-lock wait reads as busy by name", () => {
  const timedOut = new Error("Timed out after 15000ms waiting for advisory lock");
  timedOut.name = "AdvisoryLockTimeoutError";
  assert.equal(isDatabaseBusy(timedOut), true);
});

test("non-errors are not busy", () => {
  for (const value of [null, undefined, "57014", 57014, {}]) {
    assert.equal(isDatabaseBusy(value), false, String(value));
  }
});
