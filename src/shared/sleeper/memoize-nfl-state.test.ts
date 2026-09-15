import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  holdLastGood,
  memoizeNflState,
  NFL_STATE_TTL_MS,
} from "./memoize-nfl-state.ts";
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

describe("holdLastGood", () => {
  test("serves the last state it read when a later read fails", async () => {
    let fail = false;
    const held = holdLastGood(() =>
      fail ? Promise.reject(new Error("503")) : Promise.resolve(state(2)),
    );

    assert.equal((await held())?.week, 2);
    fail = true;
    // The whole point: week 2, not the caller's fallback to week 1.
    assert.equal((await held())?.week, 2);
    assert.equal(held.lastGood()?.week, 2);
  });

  test("throws when it has never read one — a cold process has no week", async () => {
    const held = holdLastGood(() => Promise.reject(new Error("503")));

    await assert.rejects(held(), /503/);
    assert.equal(held.lastGood(), null);
  });

  test("a null body falls back where a good state is held", async () => {
    let body: SleeperNflState | null = state(3);
    const held = holdLastGood(() => Promise.resolve(body));

    assert.equal((await held())?.week, 3);
    // `sleeperGet` folds a missing body to null, so an unreachable state and an
    // empty one arrive spelled identically. Neither is Sleeper saying "no week".
    body = null;
    assert.equal((await held())?.week, 3);
  });

  test("a null body is answered as null when nothing is held", async () => {
    const held = holdLastGood(() => Promise.resolve(null));

    assert.equal(await held(), null);
    assert.equal(held.lastGood(), null);
  });

  test("a recovered read replaces the held one", async () => {
    let answer: () => Promise<SleeperNflState | null> = () =>
      Promise.resolve(state(2));
    const held = holdLastGood(() => answer());

    assert.equal((await held())?.week, 2);
    answer = () => Promise.reject(new Error("503"));
    assert.equal((await held())?.week, 2);
    answer = () => Promise.resolve(state(3));
    assert.equal((await held())?.week, 3);
    assert.equal(held.lastGood()?.week, 3);
  });

  test("holds across a shed wait, which fails outside the memo", async () => {
    // The order `state.ts` composes: the hold is outside the bounded wait, so a
    // reader whose own budget ran out still gets the week rather than a 1.
    let shed = false;
    const memo = memoizeNflState(() => Promise.resolve(state(4)), {
      ttlMs: 0,
    });
    const held = holdLastGood(async () => {
      const value = await memo();
      if (shed) throw new Error("SleeperBudgetExhausted");
      return value;
    });

    assert.equal((await held())?.week, 4);
    shed = true;
    assert.equal((await held())?.week, 4);
  });
});
