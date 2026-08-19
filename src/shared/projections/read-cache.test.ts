import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

import {
  LEAGUE_OUTLOOK_CACHE,
  leagueOutlookCacheKey,
  memoizeLeagueOutlook,
  rosterRevision,
  sortedScoring,
  type LeagueOutlookInput,
} from "./read-cache.ts";
import type { LeagueOutlook } from "./outlook.ts";
import { LEAGUE_DETAIL_CACHE } from "../manager/read-cache.ts";

/**
 * What the league outlook cache has to get right, which is two things a type
 * cannot carry: that identical work is done **once**, and that non-identical
 * work is never mistaken for it.
 *
 * The loader is an argument to {@link memoizeLeagueOutlook} precisely so the
 * assertion can be a *count* — the same shape `memoizeManagerLookup` is tested
 * in, and the reason the policy and the key live in a pure module rather than
 * beside the read that touches Postgres.
 *
 * Timers are mocked and computations are deferred rather than slept through: a
 * sleep long enough to be reliable is a test nobody runs, and one short enough
 * to be quick is a test that fails on a loaded machine.
 */

/** A league, and the deliberately fiddly bits of one: slots, scoring, rosters. */
function input(overrides: Partial<LeagueOutlookInput> = {}): LeagueOutlookInput {
  return {
    leagueId: "100",
    season: "2026",
    rosterPositions: ["QB", "RB", "WR", "FLEX", "BN"],
    scoringSettings: { pass_yd: 0.04, rec: 1 },
    teams: [
      { roster_id: 1, players: ["a", "b", "c"], starters: ["a", "b", "c"] },
      { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
    ],
    ...overrides,
  };
}

/** An outlook distinguishable from the next one. */
function outlook(n: number): LeagueOutlook {
  return { weeks: [n], players: {}, teams: [], unprojected_scoring: [] };
}

/** A memoised outlook over a counted loader. */
function counted(policy?: { name: string; ttlMs: number; max: number }) {
  let calls = 0;
  const cache = memoizeLeagueOutlook(async () => {
    calls += 1;
    return outlook(calls);
  }, policy);
  return { cache, calls: () => calls };
}

/** A loader that resolves only when the returned `release` is called. */
function deferred() {
  let release!: (value: LeagueOutlook | null) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<LeagueOutlook | null>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
}

describe("the league outlook cache", () => {
  test("two concurrent identical requests solve the league once", async () => {
    const { promise, release } = deferred();
    let calls = 0;
    const cache = memoizeLeagueOutlook(() => {
      calls += 1;
      return promise;
    });

    // The case no browser cache can reach: two tabs, or two readers of one
    // league, arriving inside the ~180ms the solve takes.
    const first = cache.read(input());
    const second = cache.read(input());
    assert.equal(calls, 1, "only the first caller solves");
    assert.equal(cache.inFlight, 1);

    release(outlook(7));
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.deepEqual(a, outlook(7));
    assert.equal(a, b, "and both are handed the same answer, not two of it");
    assert.equal(cache.inFlight, 0, "the in-flight entry is released on settle");
    assert.equal(cache.size, 1, "and the answer is what is kept");
  });

  test("a second read inside the TTL is served from memory", async () => {
    const { cache, calls } = counted();
    const first = await cache.read(input());
    assert.deepEqual(await cache.read(input()), first);
    assert.equal(calls(), 1);
  });

  test("an expired entry is solved again", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    t.after(() => mock.timers.reset());

    const { cache, calls } = counted();
    assert.deepEqual(await cache.read(input()), outlook(1));

    t.mock.timers.tick(LEAGUE_OUTLOOK_CACHE.ttlMs - 1_000);
    assert.deepEqual(await cache.read(input()), outlook(1), "still inside it");
    assert.equal(calls(), 1);

    t.mock.timers.tick(2_000);
    assert.deepEqual(await cache.read(input()), outlook(2), "past it, re-solved");
    assert.equal(calls(), 2);
  });

  test("a failed solve is not cached, and the next request retries", async () => {
    let calls = 0;
    const cache = memoizeLeagueOutlook(async () => {
      calls += 1;
      if (calls === 1) throw new Error("database is busy");
      return outlook(calls);
    });

    await assert.rejects(cache.read(input()), /database is busy/);
    assert.equal(cache.size, 0, "nothing was stored");
    assert.equal(cache.inFlight, 0, "and nothing was left in flight");

    // The point of not storing it: one database blip is not a TTL-long outage.
    assert.deepEqual(await cache.read(input()), outlook(2));
    assert.equal(calls, 2);
  });

  test("every waiter on a failed solve sees the failure", async () => {
    const { promise, fail } = deferred();
    let calls = 0;
    const cache = memoizeLeagueOutlook(() => {
      calls += 1;
      return promise;
    });

    const readers = [cache.read(input()), cache.read(input())];
    fail(new Error("statement timeout"));
    for (const reader of readers) {
      await assert.rejects(reader, /statement timeout/);
    }
    assert.equal(calls, 1);
    assert.equal(cache.size, 0);
  });

  test("a null is a real answer and is kept like any other", async () => {
    let calls = 0;
    const cache = memoizeLeagueOutlook(async () => {
      calls += 1;
      return null;
    });

    // A league with no slots, no scoring or nothing left on the schedule cannot
    // be projected, and re-deriving that per request is the repetition this
    // exists to stop. It is not a failure and must not be retried like one.
    assert.equal(await cache.read(input()), null);
    assert.equal(await cache.read(input()), null);
    assert.equal(calls, 1);
  });

  test("a shared answer is frozen", async () => {
    const cache = memoizeLeagueOutlook(async () => outlook(1));
    const held = await cache.read(input());
    assert.ok(Object.isFrozen(held), "every caller inside the TTL holds this");
    assert.ok(Object.isFrozen(held?.weeks));
  });

  test("forget makes the next request solve again", async () => {
    const { cache, calls } = counted();
    await cache.read(input());
    cache.forget(input());
    assert.deepEqual(await cache.read(input()), outlook(2));
    assert.equal(calls(), 2);
  });

  test("the bound is enforced, so a process cannot accumulate leagues", async () => {
    const { cache } = counted({ name: "test", ttlMs: 60_000, max: 2 });
    for (const leagueId of ["1", "2", "3"]) {
      await cache.read(input({ leagueId }));
    }
    assert.equal(cache.size, 2);
  });
});

describe("how long an outlook is held", () => {
  test("exactly as long as the league detail it was solved from", () => {
    // The agreement neither file can assert about itself, and the one that goes
    // wrong silently: the outlook is solved *from* that detail, so a longer
    // window here is an outlook outliving the rosters it describes, and a
    // shorter one re-solves a dozen teams over eighteen weeks for rosters this
    // process is still answering from memory. It is the same claim
    // `LEAGUE_DETAIL_STALE_TIME` makes for holding one client window across all
    // four of the panel's entries.
    assert.equal(LEAGUE_OUTLOOK_CACHE.ttlMs, LEAGUE_DETAIL_CACHE.ttlMs);
  });

  test("and is bounded in leagues, not left to grow", () => {
    assert.ok(LEAGUE_OUTLOOK_CACHE.max > 0 && LEAGUE_OUTLOOK_CACHE.max <= 256);
  });
});

describe("the outlook cache key", () => {
  /** Every input that must not be answered from another one's entry. */
  const SEPARATED: [string, Partial<LeagueOutlookInput>][] = [
    ["a different league", { leagueId: "999" }],
    ["a different season", { season: "2025" }],
    ["different slots", { rosterPositions: ["QB", "QB", "RB", "BN"] }],
    ["different scoring", { scoringSettings: { pass_yd: 0.05, rec: 1 } }],
    ["a scoring category dropped", { scoringSettings: { rec: 1 } }],
    ["no scoring at all", { scoringSettings: null }],
    [
      "a roster move",
      {
        teams: [
          { roster_id: 1, players: ["a", "b", "z"], starters: ["a", "b", "z"] },
          { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
        ],
      },
    ],
    [
      "a lineup change",
      {
        teams: [
          { roster_id: 1, players: ["a", "b", "c"], starters: ["c", "b", "a"] },
          { roster_id: 2, players: ["d", "e"], starters: ["d", "e"] },
        ],
      },
    ],
    ["a team leaving", { teams: [{ roster_id: 1, players: ["a"], starters: ["a"] }] }],
  ];

  for (const [what, overrides] of SEPARATED) {
    test(`${what} is a different key`, () => {
      assert.notEqual(leagueOutlookCacheKey(input()), leagueOutlookCacheKey(input(overrides)));
    });
  }

  test("two leagues never share an entry", async () => {
    // The failure this whole file exists against: one league's lineups served
    // under another's name, with nothing on the wire to say so.
    const { cache, calls } = counted();
    const one = await cache.read(input({ leagueId: "1" }));
    const two = await cache.read(input({ leagueId: "2" }));
    assert.equal(calls(), 2);
    assert.notDeepEqual(one, two);
    assert.deepEqual(await cache.read(input({ leagueId: "1" })), one, "kept apart");
  });

  test("the same league spelled twice is one key", () => {
    // Two reads assembling the same detail must not be two solves.
    assert.equal(leagueOutlookCacheKey(input()), leagueOutlookCacheKey(input()));
  });

  test("a roster listed in another order is the same key", () => {
    // `players` is a set of candidates, and Sleeper's order for it is not a fact
    // about the roster — so two syncs that returned one roster two ways are one
    // solve rather than two.
    const reordered = input({
      teams: [
        { roster_id: 1, players: ["c", "a", "b"], starters: ["a", "b", "c"] },
        { roster_id: 2, players: ["e", "d"], starters: ["d", "e"] },
      ],
    });
    assert.equal(leagueOutlookCacheKey(input()), leagueOutlookCacheKey(reordered));
  });

  test("a scoring blob assembled in another order is the same key", () => {
    // Property order is not a fact about the values — `manager/read-cache`'s
    // rule, which is why this is spelled out rather than `JSON.stringify`d.
    const reordered = input({ scoringSettings: { rec: 1, pass_yd: 0.04 } });
    assert.equal(leagueOutlookCacheKey(input()), leagueOutlookCacheKey(reordered));
  });

  test("the slot list keeps its order", () => {
    // Slots are positional: the i-th one is the seat the i-th starter fills.
    const swapped = input({ rosterPositions: ["RB", "QB", "WR", "FLEX", "BN"] });
    assert.notEqual(leagueOutlookCacheKey(input()), leagueOutlookCacheKey(swapped));
  });

  test("the ids go in verbatim rather than digested", () => {
    // A hash trades a silent collision for a shorter key, and a collision here
    // is one league's lineups served to another.
    assert.ok(leagueOutlookCacheKey(input()).includes("\"a\""));
    assert.ok(leagueOutlookCacheKey(input()).includes("\"100\""));
  });
});

describe("rosterRevision", () => {
  test("names what a lineup answer varies on and nothing else", () => {
    // Records, points for, picks and the manager behind a roster reach no solve.
    // A key naming them would re-solve every league every time a game finished.
    const withNoise = [
      {
        roster_id: 1,
        players: ["a"],
        starters: ["a"],
        fpts: 1234.5,
        record: { wins: 3, losses: 1, ties: 0 },
        picks: [{ season: "2027", round: 1 }],
      },
    ];
    assert.deepEqual(rosterRevision(withNoise), rosterRevision([
      { roster_id: 1, players: ["a"], starters: ["a"] },
    ]));
  });
});

describe("sortedScoring", () => {
  test("null stays null", () => {
    // A league with no scoring on file is not a league scoring nothing.
    assert.equal(sortedScoring(null), null);
    assert.notDeepEqual(sortedScoring({}), sortedScoring(null));
  });
});
