import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deriveCareerValues, withCareerValues } from "./career.ts";

import type { CompsPoolRow } from "./knn.ts";

const poolRow = (
  player_id: string,
  season: string,
  games: number,
  ppr: number,
): CompsPoolRow => ({
  player_id,
  season,
  name: player_id,
  position: "WR",
  team: null,
  draft: null,
  games,
  values: { rec_yd: 1000 },
  points: { ppr, half_ppr: ppr * 0.9, std: ppr * 0.8 },
});

const pools = (rows: CompsPoolRow[]) => {
  const bySeason = new Map<string, CompsPoolRow[]>();
  for (const row of rows) {
    bySeason.set(row.season, [...(bySeason.get(row.season) ?? []), row]);
  }
  return [...bySeason].map(([season, seasonRows]) => ({
    season,
    rows: seasonRows,
  }));
};

const rowFor = (
  enriched: { season: string; rows: readonly CompsPoolRow[] }[],
  player: string,
  season: string,
) =>
  enriched
    .find((pool) => pool.season === season)!
    .rows.find((row) => row.player_id === player)!;

describe("withCareerValues", () => {
  test("career is the PPR/g over every strictly prior stored season, pooled", () => {
    // 2024: (300 + 150) points over (15 + 10) games = 18/g — a per-game
    // average of the pooled totals, not an average of two seasons' averages.
    const enriched = withCareerValues(
      pools([
        poolRow("p", "2022", 15, 300),
        poolRow("p", "2023", 10, 150),
        poolRow("p", "2024", 17, 400),
      ]),
    );
    assert.equal(rowFor(enriched, "p", "2024").values.career_ppg, 18);
    // 2023 sees only 2022; the row's own season and the future never count.
    assert.equal(rowFor(enriched, "p", "2023").values.career_ppg, 20);
    assert.equal(rowFor(enriched, "p", "2022").values.career_ppg, null);
  });

  test("the recent window is the previous three calendar seasons only", () => {
    // At 2024 the window is 2021–2023, so the 2019 season is career-only.
    const enriched = withCareerValues(
      pools([
        poolRow("p", "2019", 16, 480),
        poolRow("p", "2021", 10, 100),
        poolRow("p", "2024", 17, 400),
      ]),
    );
    const row = rowFor(enriched, "p", "2024");
    assert.equal(row.values.prev3_ppg, 10);
    assert.equal(row.values.career_ppg, round2(580 / 26));
  });

  test("a missed year inside the window averages what was played", () => {
    const enriched = withCareerValues(
      pools([poolRow("p", "2021", 8, 120), poolRow("p", "2024", 17, 400)]),
    );
    assert.equal(rowFor(enriched, "p", "2024").values.prev3_ppg, 15);
  });

  test("a first stored season answers null on both — no prior form is a fact", () => {
    const enriched = withCareerValues(pools([poolRow("p", "2024", 17, 400)]));
    const row = rowFor(enriched, "p", "2024");
    assert.equal(row.values.career_ppg, null);
    assert.equal(row.values.prev3_ppg, null);
  });

  test("players don't mix, and existing values survive the enrichment", () => {
    const enriched = withCareerValues(
      pools([
        poolRow("a", "2023", 10, 200),
        poolRow("b", "2023", 10, 50),
        poolRow("a", "2024", 17, 400),
      ]),
    );
    const row = rowFor(enriched, "a", "2024");
    assert.equal(row.values.career_ppg, 20);
    assert.equal(row.values.rec_yd, 1000);
    assert.equal(rowFor(enriched, "b", "2023").values.career_ppg, null);
  });

  test("does not mutate the input rows — they are the frozen cached pools", () => {
    const input = pools([
      poolRow("p", "2023", 10, 150),
      poolRow("p", "2024", 17, 400),
    ]);
    for (const pool of input) {
      for (const row of pool.rows) Object.freeze(row.values);
    }
    const enriched = withCareerValues(input);
    assert.equal(rowFor(enriched, "p", "2024").values.career_ppg, 15);
    assert.equal(
      input.find((p) => p.season === "2024")!.rows[0].values.career_ppg,
      undefined,
    );
  });
});

/**
 * The pass is O(corpus) — a map per player, then a fresh row and a fresh
 * `values` object for every player-season on file — and it ran on every
 * `/api/comps` request, so nudging a weight notch rebuilt the whole historical
 * archive in JavaScript while the expensive season pools underneath it sat
 * cached and untouched.
 *
 * It is memoized against the corpus's own identity, which is the only key it
 * can have: the answer depends on nothing a request carries, and
 * `getCompsPool`'s frozen arrays are stable for exactly as long as the answer
 * is valid. There is no second TTL to keep in step and one slot to hold.
 */
describe("withCareerValues — the corpus memo", () => {
  const corpus = () =>
    pools([poolRow("p", "2023", 10, 150), poolRow("p", "2024", 17, 400)]);

  test("the same corpus comes back as the same object", () => {
    const input = corpus();
    const first = withCareerValues(input);
    assert.equal(withCareerValues(input), first);
    // And a fresh wrapper around the *same* season arrays hits too, which is
    // the case that matters: `getCompsPools` builds a new outer array every
    // call while the season rows stay the cached ones.
    const rewrapped = input.map((pool) => ({ ...pool }));
    assert.equal(withCareerValues(rewrapped), first);
  });

  test("a rebuilt season invalidates it — the pool cache is the lifecycle", () => {
    const input = corpus();
    const first = withCareerValues(input);
    const rebuilt = input.map((pool) =>
      pool.season === "2024" ? { season: pool.season, rows: [...pool.rows] } : pool,
    );
    const second = withCareerValues(rebuilt);
    assert.notEqual(second, first, "a new rows array is a new corpus");
    assert.equal(
      rowFor(second, "p", "2024").values.career_ppg,
      rowFor(first, "p", "2024").values.career_ppg,
    );
  });

  test("a deepening archive re-answers rather than serving the old numbers", () => {
    // The reason this is derived at read time at all: backfilling an older
    // season changes every later season's career figure without any of those
    // seasons' own data moving.
    const shallow = withCareerValues(pools([poolRow("q", "2024", 10, 200)]));
    assert.equal(rowFor(shallow, "q", "2024").values.career_ppg, null);

    const deepened = withCareerValues(
      pools([poolRow("q", "2023", 10, 100), poolRow("q", "2024", 10, 200)]),
    );
    assert.equal(rowFor(deepened, "q", "2024").values.career_ppg, 10);
  });

  test("a shared answer is frozen — every caller holds the same rows", () => {
    const enriched = withCareerValues(corpus());
    const row = rowFor(enriched, "p", "2024");
    assert.ok(Object.isFrozen(enriched), "the corpus");
    assert.ok(Object.isFrozen(row), "each row");
    assert.ok(Object.isFrozen(row.values), "and the values it enriched");
    assert.throws(() => {
      (row.values as Record<string, number>).career_ppg = 999;
    }, TypeError);
  });

  test("the memo changes no number — it is the same pass", () => {
    const input = corpus();
    assert.deepEqual(
      withCareerValues(input).map((pool) => pool.rows.map((r) => r.values)),
      deriveCareerValues(input).map((pool) => pool.rows.map((r) => r.values)),
    );
  });
});

const round2 = (value: number): number => Math.round(value * 100) / 100;
