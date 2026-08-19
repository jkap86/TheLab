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

/**
 * Let a refresh started behind a request finish.
 *
 * A macrotask, so every microtask the unawaited chain is made of has drained by
 * the time it resolves — awaiting a microtask would only get one link deep.
 */
const settle = () => new Promise<void>((r) => setImmediate(r));

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

  // Past the TTL the stale value is what answers, and the refresh runs behind
  // the request — so the rollover lands on the *next* caller. For a value that
  // changes once a year that is the trade the latency is worth.
  time.advance(1001);
  assert.equal(await resolver.resolve(), "2027", "stale, and nobody waited");
  await settle();
  assert.equal(await resolver.resolve(), "2028");
  assert.equal(upstream.calls, 2);
});

test("a stale read does not wait on the upstream", async () => {
  const time = clock();
  // A holder rather than a bare `let`, the idiom `query-fns` spells out: a local
  // assigned inside a closure narrows to its initialiser everywhere the compiler
  // can't see the write, so `release()` below would be typed `never`.
  const release: { current: (() => void) | null } = { current: null };
  let calls = 0;
  const resolver = createSeasonResolver({
    fetchState: async () => {
      calls += 1;
      // The second call never settles on its own: if `resolve` awaited it, the
      // assertion below could not run at all.
      if (calls > 1) await new Promise<void>((r) => (release.current = r));
      return { season: "2027" };
    },
    fallback: "2026",
    now: time.now,
    ttlMs: 1000,
  });

  assert.equal(await resolver.resolve(), "2027");
  time.advance(1001);
  assert.equal(await resolver.resolve(), "2027", "answered while the fetch hangs");
  assert.equal(calls, 2, "and the refresh was started, not skipped");
  release.current?.();
});

test("a failed attempt is not retried on every request", async () => {
  const time = clock();
  const upstream = state({ season: "2027" });
  upstream.breakIt();
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    now: time.now,
    ttlMs: 1000,
    failureBackoffMs: 500,
  });

  // Cold: the first caller waits, because there is nothing to serve and the
  // compiled-in fallback is exactly what must not be trusted silently.
  assert.equal(await resolver.resolve(), "2026");
  assert.equal(upstream.calls, 1);

  // Inside the backoff the upstream is known down, so the fallback is answered
  // without dialling it again — the case that used to cost a timeout ladder per
  // request.
  assert.equal(await resolver.resolve(), "2026");
  assert.equal(upstream.calls, 1, "no second attempt inside the backoff");

  time.advance(501);
  upstream.fixIt();
  assert.equal(await resolver.resolve(), "2027");
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
    failureBackoffMs: 500,
  });

  assert.equal(await resolver.resolve(), "2027");
  upstream.breakIt();
  time.advance(5000);
  assert.equal(
    await resolver.resolve(),
    "2027",
    "an expired cache still beats no answer",
  );
  await settle();

  // And a failed attempt does not re-stamp the *cache*, so recovery does not
  // wait out a TTL that was never earned — only the failure's own short backoff,
  // which is what keeps a down upstream from being re-dialled per request.
  upstream.fixIt();
  upstream.set({ season: "2028" });
  time.advance(1000);
  assert.equal(await resolver.resolve(), "2027", "stale until the refresh lands");
  await settle();
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

/**
 * The synchronous half.
 *
 * `peekSeason` exists for a caller whose *answer* does not depend on the season
 * and whose bookkeeping does — `comps/read-cache`, choosing how long to hold an
 * entry. Blocking a corpus that is entirely in Postgres on a Sleeper call, to
 * label how long a copy of it is worth keeping, is the failure it removes; so
 * what these pin is that it never reaches for the upstream, whatever state the
 * resolver is in.
 */
test("peekSeason answers undefined on a cold resolver, without a fetch", () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
  });

  assert.equal(resolver.peekSeason(), undefined);
  assert.equal(upstream.calls, 0, "peeking must never dial Sleeper");
  // Not even a refresh started behind the caller: a peek is a property read.
  assert.equal(resolver.peek(), null);
});

test("peekSeason answers the resolved season once one is known", async () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
  });

  await resolver.resolve();
  assert.equal(resolver.peekSeason(), "2027");
  assert.equal(upstream.calls, 1, "and the peek added no call of its own");
});

test("peekSeason keeps answering while the upstream is down", async () => {
  const time = clock();
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    now: time.now,
    ttlMs: 1000,
  });
  await resolver.resolve();

  upstream.breakIt();
  time.advance(10_000);
  // Stale by ten TTLs and the upstream refusing: a value that changes once a
  // year is still the right one to classify a cache entry against.
  assert.equal(resolver.peekSeason(), "2027");
  assert.equal(upstream.calls, 1);
});

test("peekSeason honours the override, without a fetch", () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    override: () => "2024",
  });

  assert.equal(resolver.peekSeason(), "2024");
  assert.equal(upstream.calls, 0);
});

test("an implausible override is ignored by the peek too", () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
    override: () => "next year",
  });

  // Falls through to what is cached — nothing, here — rather than to the
  // fallback: `undefined` means "this process does not know", which is a
  // different claim from the compiled-in constant.
  assert.equal(resolver.peekSeason(), undefined);
  assert.equal(upstream.calls, 0);
});

test("peekSeason never answers the compiled-in fallback", async () => {
  // The fallback is a release note (`DEFAULT_SEASON`); answering it from a peek
  // would hand a caller a plausible year this process never resolved, and the
  // caller's whole reason for peeking is that it can act on not knowing.
  const resolver = createSeasonResolver({
    fetchState: async () => {
      throw new Error("upstream down");
    },
    fallback: "2026",
  });

  assert.equal(await resolver.resolve(), "2026");
  assert.equal(resolver.peekSeason(), undefined);
});

test("reset makes the peek cold again", async () => {
  const upstream = state({ season: "2027" });
  const resolver = createSeasonResolver({
    fetchState: upstream.fetch,
    fallback: "2026",
  });
  await resolver.resolve();
  assert.equal(resolver.peekSeason(), "2027");

  resolver.reset();
  assert.equal(resolver.peekSeason(), undefined);
});
