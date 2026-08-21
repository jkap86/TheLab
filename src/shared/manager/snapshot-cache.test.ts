import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { HorizonProjectionInputs, OptimalLineups } from "../projections/outlook.ts";

import {
  MANAGER_LINEUPS_CACHE,
  MANAGER_PROJECTION_INPUTS_CACHE,
  MANAGER_SNAPSHOT_CACHE,
  managerSnapshotCacheKey,
  memoizeManagerSnapshot,
  ownedLeagues,
  toLeagueTeamsInput,
} from "./snapshot-cache.ts";
import type { ManagerSnapshotLoaders } from "./snapshot-cache.ts";
import type { LeagueRosterSet } from "./types.ts";

/**
 * That one Manager screen load costs one of each expensive thing.
 *
 * **Call counts, not timings.** What this module is for is that three requests
 * arriving together do the shared work once, and the only honest way to state
 * that is to count what the loaders were asked — a wall-clock assertion about
 * "faster" would pass on a quiet machine and fail on a busy one while saying
 * nothing about whether anything was shared.
 *
 * The loaders are arguments (see {@link memoizeManagerSnapshot}), which is what
 * makes the counting possible with nothing behind them. The other half of the
 * claim — that the *real* reads underneath collapse the same way — is
 * `./manager-snapshot.test.ts`, which drives them against a counting `pool`.
 */

const USER = "user-1";
const OTHER = "user-2";
const SEASON = "2025";

function league(id: string, ownerIds: (string | null)[]): LeagueRosterSet {
  return {
    league_id: id,
    roster_positions: ["QB", "RB", "WR", "BN"],
    scoring_settings: { rec: 1 },
    best_ball: false,
    median_match: false,
    teams: ownerIds.map((owner_id, index) => ({
      roster_id: index + 1,
      owner_id,
      players: [`p${index}`],
      starters: [`p${index}`],
      reserve: [],
      taxi: [],
      record: { wins: 0, losses: 0, ties: 0 },
      fpts: 0,
    })),
  };
}

/** Every league this manager fielded a team in; only the first holds a roster. */
const LEAGUES = [league("owned", [USER, OTHER]), league("left", [OTHER, null])];

type Counts = { rosters: number; inputs: number; lineups: number };

/**
 * A memoiser over loaders that count and can be made to fail or to hang.
 *
 * `gate` is a promise every loader awaits before answering, which is how the
 * "three requests arrive together" case is staged deterministically: nothing
 * resolves until the test lets it, so every caller is genuinely in flight rather
 * than accidentally serialised by the microtask queue.
 */
function harness(
  options: {
    fail?: Partial<Record<keyof Counts, () => boolean>>;
    gate?: Promise<void>;
  } = {},
) {
  const counts: Counts = { rosters: 0, inputs: 0, lineups: 0 };

  const refuse = (kind: keyof Counts) => options.fail?.[kind]?.() ?? false;
  const wait = async () => {
    if (options.gate) await options.gate;
  };

  const loaders: ManagerSnapshotLoaders = {
    async rosters(userId, season) {
      counts.rosters += 1;
      await wait();
      if (refuse("rosters")) throw new Error("rosters read failed");
      // Tagged with who asked, so a snapshot served across users or seasons is
      // visible in the answer rather than only in a count.
      return LEAGUES.map((l) => ({ ...l, league_id: `${userId}:${season}:${l.league_id}` }));
    },
    async projectionInputs(snapshot) {
      counts.inputs += 1;
      await wait();
      if (refuse("inputs")) throw new Error("projections read failed");
      return {
        season: snapshot.season,
        weeks: [10, 11],
        stats: [],
        positions: {},
      } satisfies HorizonProjectionInputs;
    },
    async optimalLineups(snapshot, inputs) {
      counts.lineups += 1;
      await wait();
      if (refuse("lineups")) throw new Error("solve failed");
      return {
        weeks: [...inputs.weeks],
        lineups: new Map(
          snapshot.owned.map((l) => [l.league_id, new Map([[1, ["p0"]]])]),
        ),
      } satisfies OptimalLineups;
    },
  };

  return { counts, cache: memoizeManagerSnapshot(loaders) };
}

/** The three requests a default Manager load fires, started together. */
function screenLoad(cache: ReturnType<typeof harness>["cache"]) {
  return Promise.all([
    // …/ranks: the rosters, and the projection inputs its weekly solves run on.
    cache
      .rosters(USER, SEASON)
      .then(() => cache.projectionInputs(USER, SEASON)),
    // …/ktc: the rosters, and the aggregate lineup.
    cache.rosters(USER, SEASON).then(() => cache.optimalLineups(USER, SEASON)),
    // …/adp-value: the same two.
    cache.rosters(USER, SEASON).then(() => cache.optimalLineups(USER, SEASON)),
  ]);
}

describe("one Manager screen load", () => {
  test("reads the manager's roster graph once", async () => {
    // Three requests, three `getManagerLeagueRosters` calls before this module:
    // two statements over `leagues` and `rosters` for the whole account, each.
    const { counts, cache } = harness();
    await screenLoad(cache);
    assert.equal(counts.rosters, 1);
  });

  test("reads the projection inputs once", async () => {
    // The ranks' weekly solves and the value lenses' aggregate lineup want the
    // identical stat lines and positions — the heaviest read on the screen.
    const { counts, cache } = harness();
    await screenLoad(cache);
    assert.equal(counts.inputs, 1);
  });

  test("solves the aggregate lineups once, and hands both lenses the same one", async () => {
    const { counts, cache } = harness();
    const [, ktc, adp] = await screenLoad(cache);

    assert.equal(counts.lineups, 1);
    // Identity, not deep equality: two equal solves would satisfy `deepEqual`
    // and would be exactly the duplication this exists to remove.
    assert.equal(ktc, adp);
  });

  test("coalesces callers that arrive before anything has resolved", async () => {
    // Staged so every request is genuinely in flight: nothing answers until the
    // gate opens, so a count of one is coalescing rather than a cache hit.
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { counts, cache } = harness({ gate });

    const load = screenLoad(cache);
    assert.equal(counts.rosters, 1);
    open();
    await load;

    assert.deepEqual(counts, { rosters: 1, inputs: 1, lineups: 1 });
  });

  test("a lens that wants only the rosters never waits on a solve", async () => {
    const { counts, cache } = harness();
    await cache.rosters(USER, SEASON);
    assert.deepEqual(counts, { rosters: 1, inputs: 0, lineups: 0 });
  });
});

describe("what a snapshot is keyed by", () => {
  test("two managers never share one", async () => {
    const { counts, cache } = harness();
    const [mine, theirs] = await Promise.all([
      cache.rosters(USER, SEASON),
      cache.rosters(OTHER, SEASON),
    ]);

    assert.equal(counts.rosters, 2);
    assert.equal(mine.userId, USER);
    assert.equal(theirs.userId, OTHER);
    assert.notEqual(mine.leagues[0].league_id, theirs.leagues[0].league_id);
  });

  test("two seasons never share one", async () => {
    const { counts, cache } = harness();
    const [now, then] = await Promise.all([
      cache.projectionInputs(USER, SEASON),
      cache.projectionInputs(USER, "2024"),
    ]);

    // Two rosters reads and two projections reads: a season selects a different
    // set of rosters *and* a different set of projections.
    assert.equal(counts.rosters, 2);
    assert.equal(counts.inputs, 2);
    assert.equal(now.season, SEASON);
    assert.equal(then.season, "2024");
  });

  test("the key spells the pair out rather than joining it", () => {
    // A separator inside an id must not be able to collide with the pair
    // boundary — `a|b` and `a` + `b` are one string and two subjects.
    assert.notEqual(
      managerSnapshotCacheKey("a", "b:c"),
      managerSnapshotCacheKey("a:b", "c"),
    );
    assert.equal(
      managerSnapshotCacheKey(USER, SEASON),
      managerSnapshotCacheKey(USER, SEASON),
    );
  });
});

describe("a read that fails", () => {
  test("is never stored, so the next request retries", async () => {
    let broken = true;
    const { counts, cache } = harness({ fail: { rosters: () => broken } });

    await assert.rejects(cache.rosters(USER, SEASON), /rosters read failed/);
    broken = false;
    const snapshot = await cache.rosters(USER, SEASON);

    assert.equal(counts.rosters, 2);
    assert.equal(snapshot.userId, USER);
  });

  test("releases its in-flight entry, so a later retry is not the failure again", async () => {
    // The failure mode this guards: a rejected promise left in the in-flight map
    // is handed to every caller for the rest of the window, turning one database
    // blip into a blank Manager screen nothing can recover from.
    let broken = true;
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { counts, cache } = harness({ fail: { inputs: () => broken }, gate });

    const waiting = [
      cache.projectionInputs(USER, SEASON),
      cache.projectionInputs(USER, SEASON),
    ];
    open();
    for (const attempt of waiting) {
      await assert.rejects(attempt, /projections read failed/);
    }
    assert.equal(counts.inputs, 1, "the two that waited shared one read");
    assert.equal(cache.inFlight, 0, "and it was retired when it failed");

    broken = false;
    assert.deepEqual((await cache.projectionInputs(USER, SEASON)).weeks, [10, 11]);
    assert.equal(counts.inputs, 2);
  });

  test("fails only what is computed from it", async () => {
    // The isolation the routes already have and must keep: KTC and ADP price a
    // roster with no projection behind it at all, so a projections read that
    // fails costs the lineups and leaves the rosters answering.
    const { counts, cache } = harness({ fail: { inputs: () => true } });

    await assert.rejects(cache.optimalLineups(USER, SEASON), /projections read failed/);
    const snapshot = await cache.rosters(USER, SEASON);

    assert.equal(snapshot.owned.length, 1);
    assert.equal(counts.rosters, 1, "read once, for the solve that then failed");
  });
});

describe("invalidation", () => {
  test("forgetting a manager drops all three entries", async () => {
    const { counts, cache } = harness();
    await screenLoad(cache);
    assert.deepEqual(counts, { rosters: 1, inputs: 1, lineups: 1 });

    cache.forget(USER, SEASON);
    await screenLoad(cache);

    // A league graph this manager is rostered in has been rewritten: every one
    // of these is an answer about the rows that write replaced.
    assert.deepEqual(counts, { rosters: 2, inputs: 2, lineups: 2 });
  });

  test("it drops that manager alone", async () => {
    const { counts, cache } = harness();
    await Promise.all([cache.rosters(USER, SEASON), cache.rosters(OTHER, SEASON)]);

    cache.forget(USER, SEASON);
    await Promise.all([cache.rosters(USER, SEASON), cache.rosters(OTHER, SEASON)]);

    assert.equal(counts.rosters, 3);
  });
});

describe("the owned-league rule", () => {
  test("keeps the leagues this manager holds a roster in", () => {
    assert.deepEqual(
      ownedLeagues(USER, LEAGUES).map((l) => l.league_id),
      ["owned"],
    );
  });

  test("a league they have left is still on the snapshot", () => {
    // Different questions on purpose: the projected ranks place the manager in a
    // league they no longer own a roster in, where a value lens has nothing to
    // price there.
    assert.equal(LEAGUES.length, 2);
    assert.equal(ownedLeagues(OTHER, LEAGUES).length, 2);
  });

  test("an ownerless roster names nobody", () => {
    assert.deepEqual(ownedLeagues("nobody", LEAGUES), []);
  });
});

describe("what a league is to the solver", () => {
  test("is the four fields the lineup entry points read, and no others", () => {
    // One spelling for the ranks' weekly solves and the value lenses' aggregate
    // one, so a shared read cannot be taken over a different set of leagues than
    // it is solved against.
    const input = toLeagueTeamsInput(LEAGUES[0]);

    assert.deepEqual(Object.keys(input).sort(), [
      "league_id",
      "rosterPositions",
      "scoringSettings",
      "teams",
    ]);
    assert.equal(input.league_id, "owned");
    assert.deepEqual(input.rosterPositions, LEAGUES[0].roster_positions);
    assert.deepEqual(input.scoringSettings, LEAGUES[0].scoring_settings);
    assert.equal(input.teams, LEAGUES[0].teams);
  });

  test("carries no `bestBall`, which belongs to the week's solve alone", () => {
    // `getWeekLineups` is the one entry point that asks what a roster is
    // *currently* starting, and it does not come through this snapshot at all.
    assert.equal("bestBall" in toLeagueTeamsInput(LEAGUES[0]), false);
  });
});

describe("the cache policies", () => {
  test("are windows in seconds, not minutes", () => {
    // This holds user-specific roster state, so the window is the fan-out of one
    // screen load rather than a freshness claim — see the module comment. A TTL
    // that crept up to the other caches' minutes would be a reader watching
    // their own sync finish and being shown the rosters it replaced.
    for (const policy of [
      MANAGER_SNAPSHOT_CACHE,
      MANAGER_PROJECTION_INPUTS_CACHE,
      MANAGER_LINEUPS_CACHE,
    ]) {
      assert.ok(policy.ttlMs > 0, `${policy.name} stores something`);
      assert.ok(policy.ttlMs <= 60 * 1000, `${policy.name} is at most a minute`);
      assert.ok(policy.max > 0 && policy.max <= 16, `${policy.name} is bounded`);
    }
  });

  test("the lineups never outlive the rosters they were solved over", () => {
    assert.equal(MANAGER_LINEUPS_CACHE.ttlMs, MANAGER_SNAPSHOT_CACHE.ttlMs);
  });

  test("the largest value is held for the shortest time", () => {
    // An entry is every stat line of every remaining week for every rostered
    // player of the account; the bound is in entries, so it has to be the
    // tightest of the three.
    assert.ok(
      MANAGER_PROJECTION_INPUTS_CACHE.ttlMs <= MANAGER_SNAPSHOT_CACHE.ttlMs,
    );
    assert.ok(MANAGER_PROJECTION_INPUTS_CACHE.max <= MANAGER_SNAPSHOT_CACHE.max);
  });
});
