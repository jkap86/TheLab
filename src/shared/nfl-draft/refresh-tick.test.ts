import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nflDraftRefreshTick } from "./refresh-tick.ts";

import type { NflDraftSync, TickLog } from "./refresh-tick.ts";
import type { NflDraftSyncSummary } from "./sync.ts";

/**
 * What a scheduled tick asks for, which is the whole of the bug: it used to
 * force on every run but the boot one, so the freshness gate inside the
 * advisory lock was bypassed by every tick that mattered — and one forcing tick
 * per instance is one 2.6MB fetch per instance, whatever the lock does about
 * overlap.
 */

const summary = (over: Partial<NflDraftSyncSummary> = {}): NflDraftSyncSummary => ({
  locked: false,
  skipped: false,
  count: 12000,
  drafted: 9000,
  removed: 0,
  rejected: null,
  ...over,
});

/** A sync that records the options each call was given. */
function spy(result: NflDraftSyncSummary | Error) {
  const calls: ({ force?: boolean } | undefined)[] = [];
  const sync: NflDraftSync = async (options) => {
    calls.push(options);
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, sync };
}

function recorder(): TickLog & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    log: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  };
}

describe("nflDraftRefreshTick", () => {
  test("a routine tick never forces — the freshness gate decides", () => {
    const { calls, sync } = spy(summary());
    return nflDraftRefreshTick(sync, recorder()).then(() => {
      assert.equal(calls.length, 1);
      // Either shape is honest: no options at all, or an explicit false. What
      // must never appear is `force: true` on a scheduled run.
      assert.notEqual(calls[0]?.force, true);
    });
  });

  test("every tick asks the same question — there is no boot special case", async () => {
    // The old shape was `force: !firstRun`, so ticks 2..n each pulled the file
    // whether or not it had changed. Ticking repeatedly must not change what is
    // asked for.
    const { calls, sync } = spy(summary({ skipped: true }));
    const log = recorder();
    for (let i = 0; i < 4; i += 1) await nflDraftRefreshTick(sync, log);
    assert.equal(calls.length, 4);
    for (const options of calls) assert.notEqual(options?.force, true);
  });

  test("a fresh table is reported as skipped, not as a refresh", async () => {
    const log = recorder();
    const { sync } = spy(summary({ skipped: true, count: 12345 }));
    await nflDraftRefreshTick(sync, log);
    assert.match(log.lines.join("\n"), /still fresh; skipped \(12345 rows\)/);
  });

  test("a stale table's refresh is narrated with its counts", async () => {
    const log = recorder();
    const { sync } = spy(summary({ count: 100, drafted: 60, removed: 3 }));
    await nflDraftRefreshTick(sync, log);
    assert.match(log.lines.join("\n"), /Stored 100 pick\(s\)/);
    assert.match(log.lines.join("\n"), /60 drafted, 40 undrafted/);
    assert.match(log.lines.join("\n"), /removed 3/);
  });

  test("a lost lock is reported and is not an error", async () => {
    // Unchanged behaviour: the lock is what stops two instances fetching at
    // once, and it is not a substitute for the freshness gate above.
    const log = recorder();
    const { sync } = spy(summary({ locked: true, skipped: true, count: 0 }));
    await nflDraftRefreshTick(sync, log);
    assert.match(log.lines.join("\n"), /already running elsewhere/);
  });

  test("a refused payload says so and names the stored count it preserved", async () => {
    const log = recorder();
    const { sync } = spy(
      summary({ skipped: true, rejected: "too_few_drafted", count: 11800 }),
    );
    await nflDraftRefreshTick(sync, log);
    assert.match(log.lines.join("\n"), /rejected \(too_few_drafted\)/);
    assert.match(log.lines.join("\n"), /11800 stored pick\(s\) preserved/);
  });

  test("a throwing sync is logged, never propagated — the loop survives it", async () => {
    const log = recorder();
    const { sync } = spy(new Error("GitHub is down"));
    await nflDraftRefreshTick(sync, log);
    assert.match(log.lines.join("\n"), /Refresh failed/);
  });

  test("an explicit force is still available to a caller that wants one", async () => {
    // `force` is for recovery — "the stored crosswalk looks wrong, pull it
    // now" — and the tick simply is not that caller.
    const { calls, sync } = spy(summary());
    await sync({ force: true });
    assert.deepEqual(calls, [{ force: true }]);
  });
});
