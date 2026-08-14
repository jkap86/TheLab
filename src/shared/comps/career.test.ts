import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withCareerValues } from "./career.ts";

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

const round2 = (value: number): number => Math.round(value * 100) / 100;
