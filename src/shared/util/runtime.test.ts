import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NEXT_RUNTIME_VAR, isNodeRuntime } from "./runtime.ts";

/**
 * The guard in front of every background loop, and the one reading of it that
 * is easy to get backwards: **absent means Node**.
 */

describe("isNodeRuntime", () => {
  test("Next's Node bundle is Node", () => {
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "nodejs" }), true);
  });

  test("Next's Edge bundle is the one thing excluded", () => {
    // The only value that names a runtime `pg` cannot run on, and therefore the
    // only value this may answer false to.
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "edge" }), false);
  });

  test("an absent variable is a bare Node process, not a foreign runtime", () => {
    // Outside Next nothing sets the variable — `node --test` is exactly this
    // case, and reading the absence as not-Node would leave every loop's own
    // test unable to start the loop it tests.
    assert.equal(isNodeRuntime({}), true);
  });

  test("whitespace is trimmed before the comparison", () => {
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: " nodejs " }), true);
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: " edge " }), false);
    // An empty value is as absent as no value.
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "   " }), true);
  });
});
