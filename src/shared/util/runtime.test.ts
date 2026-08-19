import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isNodeRuntime, NEXT_RUNTIME_VAR } from "./runtime.ts";

describe("isNodeRuntime", () => {
  test("an absent variable is a bare Node process", () => {
    // The case the dedicated worker is: `tsx src/worker.ts` sets nothing, and
    // the guard this backs used to read that as "not Node" and start no loops
    // at all — silently, in the one process whose entire job is to run them.
    assert.equal(isNodeRuntime({}), true);
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "" }), true);
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "  " }), true);
  });

  test("Next's Node runtime is Node", () => {
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "nodejs" }), true);
  });

  test("the Edge runtime is still excluded", () => {
    // The only value that must keep excluding: `pg` cannot run there.
    assert.equal(isNodeRuntime({ [NEXT_RUNTIME_VAR]: "edge" }), false);
  });
});
