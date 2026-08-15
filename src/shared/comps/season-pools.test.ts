import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_SEASON_BUILD_CONCURRENCY,
  collectSeasonPools,
} from "./season-pools.ts";

import type { CompsPoolRow } from "./knn.ts";

/**
 * The corpus walk's bound. `Promise.all(seasons.map(…))` returned the same
 * seasons in the same order and is what this replaced, so ordering and
 * completeness are the *unchanged* half — what is new is that at most a handful
 * of season builds are in flight, which on a cold process is the difference
 * between four expensive fan-outs and one per season on file.
 */

const rows = (season: string): readonly CompsPoolRow[] => [
  {
    player_id: `p-${season}`,
    season,
    name: season,
    position: "WR",
    team: null,
    draft: null,
    games: 17,
    values: {},
    points: { ppr: 0, half_ppr: 0, std: 0 },
  },
];

/** A loader that records how many builds overlap, and how many ran at all. */
function tracked(delayMs = 0) {
  const state = { inFlight: 0, peak: 0, calls: [] as string[] };
  const load = async (season: string): Promise<readonly CompsPoolRow[]> => {
    state.calls.push(season);
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    state.inFlight -= 1;
    return rows(season);
  };
  return { state, load };
}

const seasons = (n: number) =>
  Array.from({ length: n }, (_, i) => String(2026 - i));

describe("collectSeasonPools", () => {
  test("no more than the configured number of builds run at once", async () => {
    const { state, load } = tracked(5);
    await collectSeasonPools(seasons(20), load, 3);
    assert.equal(state.peak, 3);
  });

  test("the default bound is what pool.ts uses, and it is a handful", async () => {
    const { state, load } = tracked(5);
    await collectSeasonPools(seasons(20), load);
    assert.equal(state.peak, COMPS_SEASON_BUILD_CONCURRENCY);
    // The bound is a decision, not an accident: serialising a cold corpus would
    // be as wrong as starting all of it, so it is neither 1 nor unbounded.
    assert.ok(COMPS_SEASON_BUILD_CONCURRENCY >= 3);
    assert.ok(COMPS_SEASON_BUILD_CONCURRENCY <= 5);
  });

  test("every season comes back, in the order it was asked for", async () => {
    // Deliberately uneven work, so completion order is not input order — the
    // property that lets a caller zip the answer against its own season list.
    const load = async (season: string) => {
      await new Promise((resolve) =>
        setTimeout(resolve, season === "2026" ? 20 : 1),
      );
      return rows(season);
    };
    const pools = await collectSeasonPools(seasons(6), load, 3);
    assert.deepEqual(
      pools.map((pool) => pool.season),
      seasons(6),
    );
    assert.deepEqual(
      pools.map((pool) => pool.rows[0].player_id),
      seasons(6).map((season) => `p-${season}`),
    );
  });

  test("each season is built exactly once — the coalescing is the loader's", async () => {
    // `load` is `getCompsPool`, which is a `TtlPromiseCache` read: a cached
    // season resolves at once and a missing one is computed once however many
    // callers are waiting. This walk must never ask twice for the same season.
    const { state, load } = tracked();
    await collectSeasonPools(seasons(8), load, 3);
    assert.equal(state.calls.length, 8);
    assert.equal(new Set(state.calls).size, 8);
  });

  test("a cached season costs a slot for no time at all", async () => {
    // Half the corpus already cached: those resolve immediately, so the bound
    // is spent on the seasons that actually have to be built.
    const built: string[] = [];
    const cache = new Map(seasons(8).slice(0, 4).map((s) => [s, rows(s)]));
    const load = async (season: string) => {
      const hit = cache.get(season);
      if (hit) return hit;
      built.push(season);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return rows(season);
    };
    const pools = await collectSeasonPools(seasons(8), load, 3);
    assert.equal(pools.length, 8);
    assert.deepEqual(built, seasons(8).slice(4));
  });

  test("a failing season rejects the walk — a corpus missing a season is none", async () => {
    const load = async (season: string) => {
      if (season === "2024") throw new Error("2024 pool failed");
      return rows(season);
    };
    await assert.rejects(
      () => collectSeasonPools(seasons(6), load, 3),
      /2024 pool failed/,
    );
  });

  test("an empty corpus is an empty answer rather than a hang", async () => {
    const { state, load } = tracked();
    assert.deepEqual(await collectSeasonPools([], load), []);
    assert.equal(state.calls.length, 0);
  });
});
