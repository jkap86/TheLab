import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSeasonResolver,
  isPlausibleSeason,
  type SeasonState,
} from "./resolve.ts";

/** A clock the test drives by hand — no timers, no sleeping. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** A state fetch that counts calls and can be made to fail or drift. */
function state(initial: SeasonState) {
  let value = initial;
  let fail = false;
  let calls = 0;
  return {
    fetch: async (): Promise<SeasonState> => {
      calls += 1;
      if (fail) throw new Error("upstream down");
      return value;
    },
    set: (next: SeasonState) => (value = next),
    breakIt: () => (fail = true),
    fixIt: () => (fail = false),
    get calls() {
      return calls;
    },
  };
}

test("the environment override wins, without touching Sleeper", async () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    override: () => "2024",
  });
  assert.equal(await resolver.resolve(), "2024");
  assert.equal(upstream.calls, 0);
});

test("an implausible override is ignored rather than trusted", async () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    override: () => "next year",
  });
  assert.equal(await resolver.resolve(), "2027");
});

test("a valid Sleeper state is used and cached", async () => {
  const time = clock();
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    now: time.now,
    ttlMs: 1000,
  });

  assert.equal(await resolver.resolve(), "2027");
  assert.equal(await resolver.resolve(), "2027");
  assert.equal(upstream.calls, 1, "second call inside the TTL is served warm");
  assert.equal(resolver.peek()?.season, "2027");
});

test("the cache expires, and a rollover is picked up without a redeploy", async () => {
  const time = clock();
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    now: time.now,
    ttlMs: 1000,
  });

  assert.equal(await resolver.resolve(), "2027");
  upstream.set({ season: "2028" });
  assert.equal(await resolver.resolve(), "2027", "still inside the TTL");

  time.advance(1001);
  assert.equal(await resolver.resolve(), "2028");
  assert.equal(upstream.calls, 2);
});

test("an invalid upstream response falls back rather than being stored", async () => {
  const upstream = state({ season: "not-a-season" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
  });
  assert.equal(await resolver.resolve(), "2026");
  assert.equal(resolver.peek(), null, "junk must never enter the cache");
});

test("a null state answers with the fallback", async () => {
  const resolver = createSeasonResolver({
    fetchState: async () => null,
    fallback: "2026",
  });
  assert.equal(await resolver.resolve(), "2026");
});

test("an upstream failure with a cached value keeps serving that value", async () => {
  const time = clock();
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    now: time.now,
    ttlMs: 1000,
  });

  assert.equal(await resolver.resolve(), "2027");
  upstream.breakIt();
  time.advance(5000);
  assert.equal(
    await resolver.resolve(),
    "2027",
    "an expired cache still beats no answer",
  );

  // And a failed attempt does not re-stamp the cache, so recovery is immediate
  // rather than waiting out a TTL that was never earned.
  upstream.fixIt();
  upstream.set({ season: "2028" });
  assert.equal(await resolver.resolve(), "2028");
});

test("an upstream failure with no cached value answers with the fallback", async () => {
  const resolver = createSeasonResolver({
    fetchState: async () => {
      throw new Error("upstream down");
    },
    fallback: "2026",
  });
  assert.equal(await resolver.resolve(), "2026");
  assert.equal(resolver.peek(), null);
});

test("concurrent cold resolves share one upstream call", async () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
  });
  const answers = await Promise.all([
    resolver.resolve(),
    resolver.resolve(),
    resolver.resolve(),
  ]);
  assert.deepEqual(answers, ["2027", "2027", "2027"]);
  assert.equal(upstream.calls, 1);
});

test("reset drops the cache", async () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
  });
  await resolver.resolve();
  resolver.reset();
  await resolver.resolve();
  assert.equal(upstream.calls, 2);
});

test("isPlausibleSeason accepts a 4-digit year in range and nothing else", () => {
  assert.equal(isPlausibleSeason("2026"), true);
  assert.equal(isPlausibleSeason("1999"), false);
  assert.equal(isPlausibleSeason("2101"), false);
  assert.equal(isPlausibleSeason("26"), false);
  assert.equal(isPlausibleSeason(2026), false);
  assert.equal(isPlausibleSeason(null), false);
  assert.equal(isPlausibleSeason(""), false);
});
