import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

import {
  LEAGUE_WEEK_CACHE,
  leagueWeekCacheKey,
  memoizeLeagueWeek,
  weekEntryTtlMs,
  type LeagueWeekInput,
} from "./read-cache.ts";
import type { LeagueWeekView } from "./league-week.ts";

/**
 * What the league week cache has to get right — which is more than its
 * rest-of-season sibling, because this is the panel's one *live* read.
 *
 * Three properties, in the order they matter. **Coalescing costs no freshness at
 * all**, so it is unconditional: a caller arriving while a read is running asked
 * for an answer that did not exist yet. **The key carries the lineup**, so a
 * manager's move cannot be answered from the entry it was meant to replace.
 * And **the entry is cut short at the next kickoff**, because that is the minute
 * seats lock and a stale answer there names a swap Sleeper would refuse.
 *
 * Deferred promises and a fake clock rather than sleeps: the boundary being
 * asserted is a specific instant, and a test that waits for one is a test that
 * fails on a loaded machine.
 */

const SUNDAY_1PM = Date.UTC(2026, 8, 13, 17, 0, 0);

function input(overrides: Partial<LeagueWeekInput> = {}): LeagueWeekInput {
  return {
    leagueId: "100",
    season: "2026",
    week: 3,
    rosterPositions: ["QB", "RB", "WR", "FLEX", "BN"],
    scoringSettings: { pass_yd: 0.04, rec: 1 },
    bestBall: false,
    medianMatch: false,
    teams: [
      { roster_id: 1, players: ["a", "b", "c"], starters: ["a", "b", "c"] },
      { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
    ],
    ...overrides,
  };
}

/** A week view, optionally carrying the week's kickoffs. */
function view(n: number, kickoffs: (number | null)[] = []): LeagueWeekView {
  return {
    week: n,
    ppg_source: { season: "2026", weeks: [], prior: false },
    projection: new Map(),
    ppg: new Map(),
    team_projection: new Map(),
    median: null,
    team_ppg: new Map(),
    games: new Map(
      kickoffs.map((kickoff, i) => [
        `T${i}`,
        { opponent: null, home: true, kickoff },
      ]),
    ),
  };
}

function counted(options?: Parameters<typeof memoizeLeagueWeek>[1]) {
  let calls = 0;
  const cache = memoizeLeagueWeek<LeagueWeekInput>(async () => {
    calls += 1;
    return view(calls);
  }, options);
  return { cache, calls: () => calls };
}

function deferred() {
  let release!: (value: LeagueWeekView) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<LeagueWeekView>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

describe("the league week cache", () => {
  test("two concurrent requests for one league-week read it once", async () => {
    const { promise, release } = deferred();
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(() => {
      calls += 1;
      return promise;
    });

    const first = cache.read(input());
    const second = cache.read(input());
    assert.equal(calls, 1, "only the first caller reads");
    assert.equal(cache.inFlight, 1);

    release(view(3));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(a, b, "and both are handed the same view");
    assert.equal(a.week, 3);
    assert.equal(cache.inFlight, 0);
  });

  test("different weeks do not coalesce", async () => {
    const { promise, release } = deferred();
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(() => {
      calls += 1;
      return promise;
    });

    void cache.read(input({ week: 3 }));
    void cache.read(input({ week: 4 }));
    // Two weeks of one league are two answers over the same rosters — the
    // cross-contamination that would be entirely invisible on the wire.
    assert.equal(calls, 2);
    assert.equal(cache.inFlight, 2);
    release(view(3));
  });

  test("different leagues do not coalesce", async () => {
    const { promise, release } = deferred();
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(() => {
      calls += 1;
      return promise;
    });

    void cache.read(input({ leagueId: "1" }));
    void cache.read(input({ leagueId: "2" }));
    assert.equal(calls, 2);
    release(view(3));
  });

  test("a failed read is removed, and the next request retries", async () => {
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(async () => {
      calls += 1;
      if (calls === 1) throw new Error("database is busy");
      return view(calls);
    });

    await assert.rejects(cache.read(input()), /database is busy/);
    assert.equal(cache.size, 0, "nothing was stored");
    assert.equal(cache.inFlight, 0, "and nothing was left in flight");

    assert.equal((await cache.read(input())).week, 2, "the retry runs");
    assert.equal(calls, 2);
  });

  test("every waiter on a failed read sees the failure", async () => {
    const { promise, fail } = deferred();
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(() => {
      calls += 1;
      return promise;
    });

    const readers = [cache.read(input()), cache.read(input())];
    fail(new Error("statement timeout"));
    for (const reader of readers) await assert.rejects(reader, /statement timeout/);
    assert.equal(calls, 1);
    assert.equal(cache.size, 0);
  });

  test("a second read inside the window is served from memory", async () => {
    const { cache, calls } = counted({ now: () => SUNDAY_1PM });
    await cache.read(input());
    await cache.read(input());
    assert.equal(calls(), 1);
  });

  test("the window is a minute, and then it is read again", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: SUNDAY_1PM });
    t.after(() => mock.timers.reset());

    const { cache, calls } = counted();
    await cache.read(input());

    t.mock.timers.tick(LEAGUE_WEEK_CACHE.ttlMs - 1_000);
    await cache.read(input());
    assert.equal(calls(), 1, "still inside it");

    t.mock.timers.tick(2_000);
    await cache.read(input());
    assert.equal(calls(), 2, "past it, the week is read again");
  });

  test("the bound is enforced", async () => {
    const { cache } = counted({
      policy: { name: "test", ttlMs: 60_000, max: 2 },
      now: () => SUNDAY_1PM,
    });
    for (const week of [1, 2, 3]) await cache.read(input({ week }));
    assert.equal(cache.size, 2);
  });
});

describe("the week entry's freshness boundary", () => {
  test("an entry is cut short at the next kickoff", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: SUNDAY_1PM });
    t.after(() => mock.timers.reset());

    let calls = 0;
    // The 1pm games have kicked off; the 4:25 window has not, and ten seconds
    // from now a late-afternoon game does.
    const cache = memoizeLeagueWeek<LeagueWeekInput>(async () => {
      calls += 1;
      return view(calls, [SUNDAY_1PM - 60_000, SUNDAY_1PM + 10_000]);
    });

    await cache.read(input());
    t.mock.timers.tick(9_000);
    await cache.read(input());
    assert.equal(calls, 1, "still before the kickoff, so still reusable");

    t.mock.timers.tick(2_000);
    await cache.read(input());
    assert.equal(calls, 2, "past it, the locks have changed and it is read again");
  });

  test("a kickoff a moment away leaves nothing worth keeping", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: SUNDAY_1PM });
    t.after(() => mock.timers.reset());

    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(async () => {
      calls += 1;
      return view(calls, [SUNDAY_1PM + 1]);
    });

    await cache.read(input());
    t.mock.timers.tick(1);
    await cache.read(input());
    // The minute around a kickoff degrades to coalescing alone rather than to
    // an answer naming a swap Sleeper would refuse.
    assert.equal(calls, 2);
  });

  test("a kickoff exactly now is behind the answer, not ahead of it", async () => {
    // `lockedPlayers` settles a seat at `kickoff <= now`, so an instant reached
    // is part of what this view already says — the next boundary is the next
    // game, and refusing to keep anything here would refuse every entry written
    // at the top of a window.
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(
      async () => {
        calls += 1;
        return view(calls, [SUNDAY_1PM]);
      },
      { now: () => SUNDAY_1PM },
    );

    await cache.read(input());
    await cache.read(input());
    assert.equal(calls, 1);
    assert.equal(cache.size, 1);
  });

  test("a window of zero is coalescing and nothing else", async () => {
    const { promise, release } = deferred();
    let calls = 0;
    const cache = memoizeLeagueWeek<LeagueWeekInput>(
      () => {
        calls += 1;
        return promise;
      },
      { policy: { name: "test", ttlMs: 0, max: 8 }, now: () => SUNDAY_1PM },
    );

    // The half that costs no freshness whatsoever: callers already waiting
    // share the read, because they asked before the answer existed. Nothing is
    // kept, so the next request reads again — which is what this cache would be
    // if the freshness argument for holding a week ever stopped holding.
    const readers = [cache.read(input()), cache.read(input())];
    assert.equal(calls, 1);
    release(view(1));
    await Promise.all(readers);
    assert.equal(cache.size, 0, "nothing is stored");

    await cache.read(input());
    assert.equal(calls, 2, "and the next request reads again");
  });

  test("a week with no scheduled instants takes the full window", async () => {
    const { cache, calls } = counted({ now: () => SUNDAY_1PM });
    await cache.read(input());
    await cache.read(input());
    // An unpublished or unreadable schedule is exactly what the day-accurate
    // lock fallback underneath already handles; it is not a reason to refuse
    // every entry.
    assert.equal(calls(), 1);
  });

  test("weekEntryTtlMs takes the earliest kickoff still ahead", () => {
    const now = SUNDAY_1PM;
    assert.equal(
      weekEntryTtlMs([now + 30_000, now + 10_000, now + 20_000], now, 60_000),
      10_000,
    );
  });

  test("weekEntryTtlMs ignores kickoffs already past and unscheduled games", () => {
    const now = SUNDAY_1PM;
    // A kickoff behind us is part of what the answer already says; a null is
    // "not dated", never "never plays".
    assert.equal(weekEntryTtlMs([now - 1, null], now, 60_000), 60_000);
  });

  test("weekEntryTtlMs never exceeds the window it is given", () => {
    const now = SUNDAY_1PM;
    assert.equal(weekEntryTtlMs([now + 5 * 60_000], now, 60_000), 60_000);
    assert.equal(weekEntryTtlMs([], now, 60_000), 60_000);
  });

  test("a kickoff at this very instant is zero, never negative", () => {
    // `lockedPlayers` settles a seat at `kickoff <= now`, so the boundary is
    // reached rather than approaching — and a non-positive lifetime stores
    // nothing (`BoundedCache.set`).
    const now = SUNDAY_1PM;
    assert.equal(weekEntryTtlMs([now], now, 60_000), 60_000);
    assert.equal(weekEntryTtlMs([now + 1], now, 60_000), 1);
    assert.ok(weekEntryTtlMs([now - 10_000], now, 60_000) >= 0);
  });
});

describe("the week cache key", () => {
  const SEPARATED: [string, Partial<LeagueWeekInput>][] = [
    ["a different league", { leagueId: "999" }],
    ["a different season", { season: "2025" }],
    ["a different week", { week: 4 }],
    ["different slots", { rosterPositions: ["QB", "QB", "RB", "BN"] }],
    ["different scoring", { scoringSettings: { pass_yd: 0.05, rec: 1 } }],
    ["best ball", { bestBall: true }],
    ["a median league", { medianMatch: true }],
    [
      "a lineup change",
      {
        teams: [
          { roster_id: 1, players: ["a", "b", "c"], starters: ["c", "b", "a"] },
          { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
        ],
      },
    ],
    [
      "a waiver claim",
      {
        teams: [
          { roster_id: 1, players: ["a", "b", "c", "z"], starters: ["a", "b", "c"] },
          { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
        ],
      },
    ],
  ];

  for (const [what, overrides] of SEPARATED) {
    test(`${what} is a different key`, () => {
      assert.notEqual(leagueWeekCacheKey(input()), leagueWeekCacheKey(input(overrides)));
    });
  }

  test("a lineup change cannot be answered from the entry before it", async () => {
    // The press this protects: a reader moves somebody, hits the panel's sync
    // key, and the refetch arrives with the new starters — which is a key
    // nothing has answered. Serving the old one would make the key look broken.
    const { cache, calls } = counted({ now: () => SUNDAY_1PM });
    const before = await cache.read(input());
    const after = await cache.read(
      input({
        teams: [
          { roster_id: 1, players: ["a", "b", "c"], starters: ["b", "a", "c"] },
          { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
        ],
      }),
    );
    assert.equal(calls(), 2);
    assert.notEqual(before, after);
  });

  test("the same request spelled twice is one key", () => {
    assert.equal(leagueWeekCacheKey(input()), leagueWeekCacheKey(input()));
  });

  test("a roster listed in another order is the same key", () => {
    const reordered = input({
      teams: [
        { roster_id: 1, players: ["b", "c", "a"], starters: ["a", "b", "c"] },
        { roster_id: 2, players: ["e", "d"], starters: ["d", "e"] },
      ],
    });
    assert.equal(leagueWeekCacheKey(input()), leagueWeekCacheKey(reordered));
  });
});
