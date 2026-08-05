import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { errorMessage } from "./errors.ts";

/**
 * What a caught value reads as.
 *
 * `catch` binds `unknown`, and this is the one place that is narrowed — so the
 * cases worth pinning are the ones a call site would otherwise have to think
 * about: a thrown non-Error (legal, and what an upstream client library can
 * hand back), and the difference the `fallback` argument makes, which is the
 * whole reason there are two overloads.
 */

describe("errorMessage", () => {
  test("an Error reads as its message", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
    assert.equal(errorMessage(new TypeError("bad type")), "bad type");
  });

  test("a subclass is still an Error", () => {
    class AdvisoryLockTimeoutError extends Error {}
    assert.equal(errorMessage(new AdvisoryLockTimeoutError("lock wait timed out")), "lock wait timed out");
  });

  test("without a fallback, a non-Error comes back as itself", () => {
    // For `console.error`, which renders an object usefully — flattening it to a
    // string here would throw away everything worth logging.
    const thrown = { code: "53300", detail: "too many connections" };
    assert.equal(errorMessage(thrown), thrown);
    assert.equal(errorMessage("a thrown string"), "a thrown string");
    assert.equal(errorMessage(null), null);
    assert.equal(errorMessage(undefined), undefined);
  });

  test("with a fallback, a non-Error becomes that fallback", () => {
    // Where the result has to be a string — a message shown to a reader, or a
    // field on a JSON payload.
    assert.equal(errorMessage({ code: "53300" }, "Database unavailable"), "Database unavailable");
    assert.equal(errorMessage(null, "Database unavailable"), "Database unavailable");
    assert.equal(errorMessage("raw string", "Database unavailable"), "Database unavailable");
  });

  test("a fallback never overrides an Error's own message", () => {
    // The fallback is for the value that has no message, not for a short one.
    assert.equal(errorMessage(new Error("No Sleeper user named x"), "Request failed"), "No Sleeper user named x");
  });

  test("an Error with an empty message reads as empty, not as the fallback", () => {
    // Deliberate and worth knowing: the branch is `instanceof`, not truthiness,
    // so a caller wanting words on screen has to check the string itself.
    assert.equal(errorMessage(new Error(), "Request failed"), "");
  });
});
