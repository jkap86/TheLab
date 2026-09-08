import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  acquireLeagueLineup,
  clearLeagueLineups,
  invalidateLeagueLineups,
  leagueLineupCacheSize,
  MAX_ENTRIES,
  peekLeagueLineup,
} from "./league-lineup-cache.ts";
import type { LeagueLineupLoader } from "./league-lineup-cache.ts";

/**
 * The store behind every expanded league card, driven without React.
 *
 * **What it replaces is a per-hook `useState`,** and each of the rules below is
 * one of the reasons it had to: two cards naming one league made two requests;
 * closing a card and opening it again paid twice; a reader who opened forty
 * cards retained forty twelve-team solves; and nothing could tell an answer to
 * be read again after a sync wrote new rosters. Every one of those renders
 * perfectly while being wrong, which is why they are asserted here rather than
 * observed on a page.
 */

/** A loader whose promise the test resolves by hand. */
function deferred(): {
  load: LeagueLineupLoader;
  calls: number;
  settle: (payload?: unknown) => void;
  fail: (error: Error) => void;
  signals: AbortSignal[];
  reloads: boolean[];
} {
  const state = {
    calls: 0,
    signals: [] as AbortSignal[],
    reloads: [] as boolean[],
    resolve: null as ((value: unknown) => void) | null,
    reject: null as ((error: Error) => void) | null,
  };
  const handle = {
    load: ((signal: AbortSignal, options: { reload: boolean }) => {
      state.calls += 1;
      state.signals.push(signal);
      state.reloads.push(options.reload);
      return new Promise((resolve, reject) => {
        state.resolve = resolve as (value: unknown) => void;
        state.reject = reject;
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any as LeagueLineupLoader,
    get calls() {
      return state.calls;
    },
    get signals() {
      return state.signals;
    },
    get reloads() {
      return state.reloads;
    },
    settle: (payload: unknown = PAYLOAD) => state.resolve?.(payload),
    fail: (error: Error) => state.reject?.(error),
  };
  return handle as ReturnType<typeof deferred>;
}

const PAYLOAD = {
  season: "2026",
  from_week: 1,
  ktc: [],
  entry: { teams: [], ranks: {} },
};

/** Let the microtask queue drain, which is where the store publishes. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => clearLeagueLineups());

describe("acquireLeagueLineup", () => {
  test("one request answers every reader of a key", async () => {
    const source = deferred();
    let a = 0;
    let b = 0;
    acquireLeagueLineup("L1", source.load, () => (a += 1));
    acquireLeagueLineup("L1", source.load, () => (b += 1));

    assert.equal(source.calls, 1, "the second reader must not fetch again");
    source.settle();
    await flush();

    assert.equal(peekLeagueLineup("L1").payload, PAYLOAD);
    assert.ok(a > 0 && b > 0, "both readers were told");
  });

  test("a resolved answer survives its last reader leaving", async () => {
    const source = deferred();
    const release = acquireLeagueLineup("L1", source.load, () => {});
    source.settle();
    await flush();
    release();

    assert.equal(peekLeagueLineup("L1").payload, PAYLOAD);
    // Re-opening the card: the same key, and nothing is asked again.
    acquireLeagueLineup("L1", source.load, () => {});
    assert.equal(source.calls, 1);
  });

  test("the last reader of an in-flight request aborts and drops it", async () => {
    const source = deferred();
    const release = acquireLeagueLineup("L1", source.load, () => {});
    release();

    assert.equal(source.signals[0]?.aborted, true);
    assert.equal(leagueLineupCacheSize(), 0, "a half-read answer is kept by nobody");

    // And the entry is genuinely gone, so the next reader starts clean rather
    // than waiting on a promise nothing will publish.
    acquireLeagueLineup("L1", source.load, () => {});
    assert.equal(source.calls, 2);
  });

  test("a failure is reported and retried when its reader comes back", async () => {
    const source = deferred();
    acquireLeagueLineup("L1", source.load, () => {});
    source.fail(new Error("boom"));
    await flush();

    assert.equal(peekLeagueLineup("L1").error, "boom");
    assert.equal(peekLeagueLineup("L1").loading, false);

    // The card is still open, so the entry stays and a second reader inherits
    // the message rather than firing a request per mount. An invalidation is
    // the way back, and it asks again itself.
    acquireLeagueLineup("L1", source.load, () => {});
    assert.equal(source.calls, 1, "a second subscriber does not retry");

    invalidateLeagueLineups();
    assert.equal(source.calls, 2, "the invalidation asked again");
    // **And it asks the network rather than the browser cache.** The route
    // answers `private, max-age=60`, which is exactly the window a post-sync
    // re-read would be answered from with the pre-sync numbers.
    assert.deepEqual(source.reloads, [false, true]);
    assert.equal(peekLeagueLineup("L1").loading, true);
  });

  test("an answer for one key never lands on another", async () => {
    // The stale-response case, which on a hook holding its own state needs a
    // ticket: here the key *is* the guard. `a` is the previous manager's read.
    const a = deferred();
    const b = deferred();
    acquireLeagueLineup("L1 jkap86", a.load, () => {});
    acquireLeagueLineup("L1 someone-else", b.load, () => {});

    b.settle({ ...PAYLOAD, season: "B" });
    a.settle({ ...PAYLOAD, season: "A" });
    await flush();

    assert.equal(peekLeagueLineup("L1 someone-else").payload?.season, "B");
    assert.equal(peekLeagueLineup("L1 jkap86").payload?.season, "A");
  });
});

describe("the bound", () => {
  test("keeps at most MAX_ENTRIES unread answers, oldest out first", async () => {
    for (let i = 0; i < MAX_ENTRIES + 3; i++) {
      const source = deferred();
      const release = acquireLeagueLineup(`L${i}`, source.load, () => {});
      source.settle();
      await flush();
      release();
    }
    assert.equal(leagueLineupCacheSize(), MAX_ENTRIES);
    assert.equal(peekLeagueLineup("L0").payload, null, "the oldest went");
    assert.ok(peekLeagueLineup(`L${MAX_ENTRIES + 2}`).payload, "the newest stayed");
  });

  test("an open card costs the cache nothing — MAX_ENTRIES cached beside it", async () => {
    // The bug: the overflow was counted over the whole map, so a subscribed
    // entry was exempt from eviction *and* took one of the eight slots. One
    // open league beside eight cached ones evicted a cached one to get the map
    // to eight — a reader who opened a card was handed a smaller cache than a
    // reader who did not, and every further open took another slot.
    const live = deferred();
    const holdOpen = acquireLeagueLineup("open", live.load, () => {});
    live.settle();
    await flush();

    for (let i = 0; i < MAX_ENTRIES; i++) {
      const source = deferred();
      const release = acquireLeagueLineup(`C${i}`, source.load, () => {});
      source.settle();
      await flush();
      release();
    }

    assert.equal(
      leagueLineupCacheSize(),
      MAX_ENTRIES + 1,
      "eight cached answers and the one being read",
    );
    assert.ok(peekLeagueLineup("C0").payload, "the oldest cached answer stayed");
    assert.ok(peekLeagueLineup("open").payload, "and so did the open card's");

    // Released, that entry joins the droppable set and the bound applies to
    // the nine of them: the oldest cached answer is the one that goes.
    holdOpen();
    assert.equal(leagueLineupCacheSize(), MAX_ENTRIES);
    assert.equal(peekLeagueLineup("C0").payload, null, "the oldest went");
    assert.ok(
      peekLeagueLineup(`C${MAX_ENTRIES - 1}`).payload,
      "the newest cached answer stayed",
    );
    assert.ok(peekLeagueLineup("open").payload, "and so did the one just closed");
  });

  test("an in-flight read is not counted against the bound or dropped by it", async () => {
    // An unresolved fetch has no subscriber-free existence to bound — it is a
    // card waiting — and trimming one would abandon a request nothing would
    // re-issue. It is held by its listener, so it is never in the droppable set.
    const pending = deferred();
    const holdOpen = acquireLeagueLineup("pending", pending.load, () => {});

    for (let i = 0; i < MAX_ENTRIES + 2; i++) {
      const source = deferred();
      const release = acquireLeagueLineup(`P${i}`, source.load, () => {});
      source.settle();
      await flush();
      release();
    }

    assert.equal(leagueLineupCacheSize(), MAX_ENTRIES + 1);
    assert.equal(peekLeagueLineup("pending").loading, true, "still in flight");
    assert.equal(pending.signals[0]?.aborted, false, "and not aborted");

    // And it still resolves into its own entry when it lands.
    pending.settle({ ...PAYLOAD, season: "P" });
    await flush();
    assert.equal(peekLeagueLineup("pending").payload?.season, "P");
    holdOpen();
  });

  test("never evicts an answer a card is still reading", async () => {
    // Every one of these is held open, which is a reader with more cards open
    // than the bound — a page they can see rather than a cache they cannot.
    const releases: (() => void)[] = [];
    for (let i = 0; i < MAX_ENTRIES + 4; i++) {
      const source = deferred();
      releases.push(acquireLeagueLineup(`H${i}`, source.load, () => {}));
      source.settle();
      await flush();
    }
    assert.equal(leagueLineupCacheSize(), MAX_ENTRIES + 4);
    assert.ok(peekLeagueLineup("H0").payload, "the first is still on screen");

    // Released, the bound applies again on the next write.
    for (const release of releases) release();
    const source = deferred();
    acquireLeagueLineup("fresh", source.load, () => {});
    source.settle();
    await flush();
    assert.ok(leagueLineupCacheSize() <= MAX_ENTRIES + 1);
  });
});

describe("invalidateLeagueLineups", () => {
  test("re-asks the keys a card is reading and drops the rest", async () => {
    const read = deferred();
    const kept = deferred();
    acquireLeagueLineup("open", read.load, () => {});
    read.settle();
    const spare = acquireLeagueLineup("closed", kept.load, () => {});
    kept.settle();
    await flush();
    spare();

    let told = 0;
    const spare2 = acquireLeagueLineup("open", read.load, () => (told += 1));
    const before = read.calls;
    invalidateLeagueLineups();

    assert.equal(leagueLineupCacheSize(), 1, "the unread key went");
    assert.ok(told > 0, "the read key's card was told");
    assert.equal(read.calls, before + 1, "and its read was re-issued here");
    assert.equal(peekLeagueLineup("open").loading, true);
    spare2();
  });

  test("takes a predicate, so one league's entries go and others stay", async () => {
    const a = deferred();
    const b = deferred();
    const ra = acquireLeagueLineup("L1 2026", a.load, () => {});
    const rb = acquireLeagueLineup("L2 2026", b.load, () => {});
    a.settle();
    b.settle();
    await flush();
    ra();
    rb();

    assert.equal(invalidateLeagueLineups((key) => key.startsWith("L1 ")), 1);
    assert.equal(peekLeagueLineup("L1 2026").payload, null);
    assert.ok(peekLeagueLineup("L2 2026").payload, "L2 was not asked about");
  });

  test("a response that predates the invalidation cannot land after it", async () => {
    // The race the run counter exists for: a read starts, a sync lands, the
    // entry is re-asked, and only then does the first response resolve.
    // A loader with one deferred *per call*, so the first attempt's promise can
    // be settled after the second has replaced it.
    const settle: ((value: unknown) => void)[] = [];
    const load = ((() =>
      new Promise((resolve) => {
        settle.push(resolve as (value: unknown) => void);
      })) as unknown) as LeagueLineupLoader;


    acquireLeagueLineup("L1", load, () => {});
    invalidateLeagueLineups();
    assert.equal(settle.length, 2, "the invalidation asked again");

    settle[0]({ ...PAYLOAD, season: "stale" });
    await flush();
    assert.equal(peekLeagueLineup("L1").payload, null, "the old run cannot land");
    assert.equal(peekLeagueLineup("L1").loading, true);

    settle[1]({ ...PAYLOAD, season: "fresh" });
    await flush();
    assert.equal(peekLeagueLineup("L1").payload?.season, "fresh");
  });
});
