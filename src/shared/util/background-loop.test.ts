import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";

import { startBackgroundLoop } from "./background-loop.ts";

/**
 * These drive the loop's *registration*, never its cadence: every interval here
 * is an hour, so the only tick that ever runs is the boot one, which is
 * synchronous to arm and awaited nowhere. The one exception is the re-entry
 * test at the bottom, which is about the cadence and says so.
 */
const HOUR_MS = 60 * 60 * 1000;

const noop = async () => {};

const handles: { stop: () => void }[] = [];

// The loop narrates itself on start, stop and a failed tick. That narration is
// the point in production and noise here.
const console_ = { log: console.log, error: console.error };
before(() => {
  console.log = () => {};
  console.error = () => {};
});
after(() => {
  console.log = console_.log;
  console.error = console_.error;
});

function start(
  overrides: Partial<Parameters<typeof startBackgroundLoop>[0]> = {},
) {
  const handle = startBackgroundLoop({
    name: "test",
    intervalMs: HOUR_MS,
    guardKey: "background-loop-test",
    cadence: "hourly",
    tick: noop,
    ...overrides,
  });
  handles.push(handle);
  return handle;
}

afterEach(() => {
  // The double-start guard is a `globalThis` Set shared by every test in the
  // process, so a loop left running leaks into the next assertion.
  while (handles.length) handles.pop()!.stop();
});

describe("startBackgroundLoop", () => {
  test("a started loop reports itself running and ticks once on boot", async () => {
    let ticks = 0;
    const handle = start({
      tick: async (firstRun) => {
        assert.equal(firstRun, true);
        ticks += 1;
      },
    });

    assert.equal(handle.running, true);
    // The boot tick is fired without being awaited; one turn of the microtask
    // queue is enough to see it, and no timer is involved.
    await Promise.resolve();
    assert.equal(ticks, 1);
  });

  test("a second start on the same key registers nothing", () => {
    // The guard that stops dev/HMR stacking timers, and the reason a repeated
    // instrumentation run can't double the load on Sleeper.
    const first = start();
    const second = start();

    assert.equal(first.running, true);
    assert.equal(second.running, false);
    assert.match(second.reason ?? "", /already started/);
  });

  test("a disabled loop hands back a handle that says why", () => {
    const handle = start({ enabled: false, disabledReason: "KTC_SYNC=off" });

    assert.equal(handle.running, false);
    assert.equal(handle.reason, "KTC_SYNC=off");
    // Stopping something that never started is a no-op, not a throw: a shutdown
    // path stops every handle it was given without asking.
    assert.doesNotThrow(() => handle.stop());
  });

  test("stop releases the guard key, so the loop can be started again", () => {
    const first = start();
    first.stop();

    const second = start();
    assert.equal(second.running, true);
  });

  test("stop is idempotent", () => {
    const handle = start();
    handle.stop();
    assert.doesNotThrow(() => handle.stop());
  });

  test("a throwing tick does not propagate", async () => {
    // One bad tick must never take the interval — or, here, the boot path —
    // down with it.
    const handle = start({
      tick: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(handle.running, true);
    await Promise.resolve();
  });

  test("a tick that outruns its interval is not re-entered", async () => {
    // The guarantee the crawler is the first loop to need: it ticks every 60s
    // over a Sleeper fan-out that can take longer than that, and a loop without
    // this skips nothing — it stacks a second fan-out on top of the first, and
    // then a third. The interval here is 1ms against a tick held open for 20,
    // so a loop that re-entered would show many.
    let entered = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    start({
      intervalMs: 1,
      tick: async () => {
        entered += 1;
        await held;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(entered, 1);

    release();
    await held;
  });
});
