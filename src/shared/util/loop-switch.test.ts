import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { loopSwitch } from "./loop-switch.ts";

describe("loopSwitch", () => {
  test("an unset variable runs the loop", () => {
    assert.deepEqual(loopSwitch("KTC_SYNC", {}), { enabled: true });
  });

  test("`off` disables it, and the reason names the variable", () => {
    // The reason is logged by the loop itself, so it has to say which switch
    // was thrown — three loops read three different variables.
    assert.deepEqual(loopSwitch("KTC_SYNC", { KTC_SYNC: "off" }), {
      enabled: false,
      disabledReason: "KTC_SYNC=off",
    });
  });

  test("case and surrounding whitespace don't matter", () => {
    assert.equal(loopSwitch("X", { X: " OFF " }).enabled, false);
    assert.equal(loopSwitch("X", { X: "Off" }).enabled, false);
  });

  test("anything that isn't `off` runs, including a near miss", () => {
    // A typo that silently stopped the crawler would be invisible for hours;
    // one that fails to stop it is visible in the next log line.
    assert.equal(loopSwitch("X", { X: "offf" }).enabled, true);
    assert.equal(loopSwitch("X", { X: "false" }).enabled, true);
    assert.equal(loopSwitch("X", { X: "0" }).enabled, true);
    assert.equal(loopSwitch("X", { X: "" }).enabled, true);
  });
});
