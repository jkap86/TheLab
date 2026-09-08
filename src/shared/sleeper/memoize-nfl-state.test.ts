import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { memoizeNflState, NFL_STATE_TTL_MS } from "./memoize-nfl-state.ts";
import type { SleeperNflState } from "./types/sleeper.types.ts";

const state = (week: number): SleeperNflState => ({
  week,
  leg: week,
  season: "2026",
  season_type: "regular",
  display_week: week,
});

/** A fetch whose answers are scripted and whose calls are counted. */
function scripted(answers: (() => Promise<SleeperNflState | null>)[]) {
  let calls = 0;
  const fetch = () => {
    const next = answers[Math.min(calls, answers.length - 1)];
    calls += 1;
    return next();
  };
  return { fetch, calls: () => calls };
}

describe("memoizeNflState", () => {
  test("serves one answer for the TTL and asks again after it", async () => {
    let clock = 0;
    const upstream = scripted([
      () => Promise.resolve(state(1)),
      () => Promise.resolve(state(2)),
    ]);
    const memo = memoizeNflState(upstream.fetch, { now: () => clock });

    assert.equal((await memo())?.week, 1);
    clock = NFL_STATE_TTL_MS - 1;
    assert.equal((await memo())?.week, 1);
    assert.equal(upstream.calls(), 1);

    clock = NFL_STATE_TTL_MS;
    assert.equal((await memo())?.week, 2);
    assert.equal(upstream.calls(), 2);
  });

  test("concurrent callers share one in-flight request", async () => {
    let resolve!: (value: SleeperNflState | null) => void;
    const upstream = scripted([
      () => new Promise<SleeperNflState | null>((r) => (resolve = r)),
    ]);
    const memo = memoizeNflState(upstream.fetch, { now: () => 0 });

    const a = memo();
    const b = memo();
    assert.equal(a, b);
    assert.equal(upstream.calls(), 1);

    resolve(state(3));
    assert.equal((await a)?.week, 3);
  });

  test("a resolved null is an answer and is held like one", async () => {
    // Sleeper's 404 fold — the client hands back the caller's `null`. For a
    // minute that is as true as any state, so it must not become a retry loop.
    const upstream = scripted([() => Promise.resolve(null)]);
    const memo = memoizeNflState(upstream.fetch, { now: () => 0 });

    assert.equal(await memo(), null);
    assert.equal(await memo(), null);
    assert.equal(upstream.calls(), 1);
  });

  test("a rejection is evicted so the next caller retries", async () => {
    const upstream = scripted([
      () => Promise.reject(new Error("502")),
      () => Promise.resolve(state(4)),
    ]);
    const memo = memoizeNflState(upstream.fetch, { now: () => 0 });

    await assert.rejects(memo(), /502/);
    // Same instant, well inside the TTL: only a remembered failure would
    // answer from cache here.
    assert.equal((await memo())?.week, 4);
    assert.equal(upstream.calls(), 2);
  });

  test("a rejection evicts only its own entry, never a newer fetch's", async () => {
    let reject!: (error: Error) => void;
    const upstream = scripted([
      () => new Promise<SleeperNflState | null>((_, r) => (reject = r)),
      () => Promise.resolve(state(5)),
    ]);
    let clock = 0;
    const memo = memoizeNflState(upstream.fetch, { now: () => clock });

    const stale = memo();
    clock = NFL_STATE_TTL_MS;
    const fresh = memo();
    assert.notEqual(stale, fresh);

    reject(new Error("late 502"));
    await assert.rejects(stale, /late 502/);
    // The old failure landing must not have dropped the fetch that replaced it.
    assert.equal(memo(), fresh);
    assert.equal(upstream.calls(), 2);
  });

  test("clear drops the entry", async () => {
    const upstream = scripted([
      () => Promise.resolve(state(1)),
      () => Promise.resolve(state(2)),
    ]);
    const memo = memoizeNflState(upstream.fetch, { now: () => 0 });

    assert.equal((await memo())?.week, 1);
    memo.clear();
    assert.equal((await memo())?.week, 2);
  });
});
