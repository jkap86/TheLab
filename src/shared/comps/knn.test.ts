import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fieldValue, runCompsKnn, similarityScore } from "./knn.ts";

import type { CompsFieldSpec, CompsPoolRow } from "./knn.ts";

const row = (over: Partial<CompsPoolRow> & { player_id: string }): CompsPoolRow => ({
  season: "2025",
  name: over.player_id,
  position: "WR",
  team: null,
  draft: null,
  games: 17,
  values: {},
  points: { ppr: 0, half_ppr: 0, std: 0 },
  ...over,
});

const field = (key: string, weight = 100, perGame = false): CompsFieldSpec => ({
  key,
  weight,
  perGame,
});

/** One field, `total` basis, position WR, permissive bounds. */
const run = (
  subject: CompsPoolRow,
  candidates: CompsPoolRow[],
  over: Partial<Parameters<typeof runCompsKnn>[0]> = {},
) =>
  runCompsKnn({
    subject,
    candidates,
    fields: [field("x")],
    basis: "total",
    k: 10,
    minGames: 1,
    positions: ["WR"],
    ...over,
  });

describe("fieldValue", () => {
  test("per-game divides a production total by games; total leaves it", () => {
    const r = row({ player_id: "1", games: 10, values: { rec_yd: 850 } });
    const spec = field("rec_yd", 100, true);
    assert.equal(fieldValue(r, spec, "per_game"), 85);
    assert.equal(fieldValue(r, spec, "total"), 850);
  });

  test("a non-per-game field never divides", () => {
    const r = row({ player_id: "1", games: 10, values: { age: 24 } });
    assert.equal(fieldValue(r, field("age"), "per_game"), 24);
  });

  test("null is unknown, and zero games has no per-game reading", () => {
    const r = row({ player_id: "1", games: 0, values: { ktc_sf: null, rec: 40 } });
    assert.equal(fieldValue(r, field("ktc_sf"), "total"), null);
    assert.equal(fieldValue(r, field("rec", 100, true), "per_game"), null);
    assert.equal(fieldValue(r, field("rec", 100, true), "total"), 40);
    assert.equal(fieldValue(r, field("absent"), "total"), null);
  });
});

describe("similarityScore", () => {
  test("the fixed map: d=0 → 100, d=1 → 37", () => {
    assert.equal(similarityScore(0), 100);
    assert.equal(similarityScore(1), 37);
  });
});

describe("runCompsKnn — the pipeline", () => {
  test("position filter, min_games and identity exclusion shape considered", () => {
    const subject = row({ player_id: "s", values: { x: 5 } });
    const out = run(subject, [
      subject, // identity — excluded
      row({ player_id: "s", season: "2024", values: { x: 4 } }), // same player, other season — kept
      row({ player_id: "a", values: { x: 3 } }),
      row({ player_id: "b", position: "TE", values: { x: 3 } }), // wrong position
      row({ player_id: "c", games: 2, values: { x: 3 } }), // under min_games
    ], { minGames: 3 });

    assert.equal(out.candidatesConsidered, 2);
    assert.deepEqual(
      out.results.map((r) => r.row.player_id).sort(),
      ["a", "s"],
    );
  });

  test("min_games never applies to the subject", () => {
    const subject = row({ player_id: "s", games: 1, values: { x: 5 } });
    const out = run(subject, [row({ player_id: "a", values: { x: 5 } })], {
      minGames: 10,
    });
    assert.equal(out.candidatesConsidered, 1);
    assert.equal(out.results.length, 1);
  });

  test("a candidate missing two weighted fields increments both counts, removes one row", () => {
    const subject = row({ player_id: "s", values: { x: 1, y: 1, ktc: 1 } });
    const out = run(
      subject,
      [
        row({ player_id: "a", values: { x: 1, y: 1, ktc: 1 } }),
        row({ player_id: "b", values: { x: 1, y: null, ktc: null } }),
      ],
      { fields: [field("x"), field("y"), field("ktc")] },
    );

    assert.equal(out.candidatesConsidered, 2);
    assert.equal(out.candidatesEligible, 1);
    assert.deepEqual(out.excludedMissing, { y: 1, ktc: 1 });
    // The documented inequality: Σ excluded ≥ considered − eligible.
    const sum = Object.values(out.excludedMissing).reduce((a, b) => a + b, 0);
    assert.ok(sum >= out.candidatesConsidered - out.candidatesEligible);
  });

  test("normalization statistics exclude the subject", () => {
    // Candidates {0,1,2}: mean 1, population σ = sqrt(2/3). The statistics must
    // be byte-identical whether the subject sits at 3 or at 100 — a subject in
    // the population would inflate σ exactly when the subject is exceptional.
    const candidates = [
      row({ player_id: "a", values: { x: 0 } }),
      row({ player_id: "b", values: { x: 1 } }),
      row({ player_id: "c", values: { x: 2 } }),
    ];
    const near = run(row({ player_id: "s", values: { x: 3 } }), candidates);
    const far = run(row({ player_id: "s", values: { x: 100 } }), candidates);

    assert.deepEqual(near.fieldStats, far.fieldStats);
    assert.equal(near.fieldStats[0].mean, 1);
    assert.equal(near.fieldStats[0].stdev, Math.sqrt(2 / 3));
  });

  test("the distance is the weight-normalized RMS z-gap, numerically", () => {
    // Candidates on x: {10, 20} → mean 15, σ 5. On y: {1, 3} → mean 2, σ 1.
    // Subject (20, 3). Candidate a (10, 1): z-gaps 2 and 2.
    //   d = sqrt((100·4 + 25·4) / 125) = 2.
    // Candidate b (20, 3): gaps 0 → d = 0.
    const subject = row({ player_id: "s", values: { x: 20, y: 3 } });
    const out = run(
      subject,
      [
        row({ player_id: "a", values: { x: 10, y: 1 } }),
        row({ player_id: "b", values: { x: 20, y: 3 } }),
      ],
      { fields: [field("x", 100), field("y", 25)] },
    );

    assert.equal(out.results[0].row.player_id, "b");
    assert.equal(out.results[0].distance, 0);
    assert.equal(out.results[0].similarity, 100);
    assert.equal(out.results[1].row.player_id, "a");
    assert.equal(out.results[1].distance, 2);
    assert.equal(out.results[1].similarity, similarityScore(2));
  });

  test("a zero-variance field contributes 0, never NaN", () => {
    const subject = row({ player_id: "s", values: { x: 7, y: 1 } });
    const out = run(
      subject,
      [
        row({ player_id: "a", values: { x: 7, y: 2 } }),
        row({ player_id: "b", values: { x: 7, y: 3 } }),
      ],
      { fields: [field("x"), field("y")] },
    );
    for (const result of out.results) {
      assert.ok(Number.isFinite(result.distance));
    }
    assert.equal(out.fieldStats[0].stdev, 0);
  });

  test("per-game and total bases rank differently when volume differs", () => {
    // Same total, different games: identical under total, apart under per-game.
    const subject = row({ player_id: "s", games: 10, values: { x: 100 } });
    const candidates = [
      row({ player_id: "same-rate", games: 10, values: { x: 100 } }),
      row({ player_id: "half-rate", games: 20, values: { x: 100 } }),
    ];
    const spec = [field("x", 100, true)];

    const total = run(subject, candidates, { fields: spec, basis: "total" });
    assert.equal(total.results[0].distance, total.results[1].distance);

    const perGame = run(subject, candidates, { fields: spec, basis: "per_game" });
    assert.equal(perGame.results[0].row.player_id, "same-rate");
    assert.ok(perGame.results[1].distance > perGame.results[0].distance);
  });

  test("ties break newer season first, then player id — deterministically", () => {
    const subject = row({ player_id: "s", values: { x: 5 } });
    const out = run(subject, [
      row({ player_id: "b", season: "2024", values: { x: 5 } }),
      row({ player_id: "a", season: "2024", values: { x: 5 } }),
      row({ player_id: "z", season: "2025", values: { x: 5 } }),
      // A spread candidate so σ > 0 and the ties are real ties at d > 0.
      row({ player_id: "w", season: "2025", values: { x: 1 } }),
    ]);
    assert.deepEqual(
      out.results.map((r) => `${r.row.season}:${r.row.player_id}`),
      ["2025:z", "2024:a", "2024:b", "2025:w"],
    );
  });

  test("k caps the results, not the counts", () => {
    const subject = row({ player_id: "s", values: { x: 0 } });
    const candidates = Array.from({ length: 20 }, (_, i) =>
      row({ player_id: `c${i}`, values: { x: i } }),
    );
    const out = run(subject, candidates, { k: 3 });
    assert.equal(out.results.length, 3);
    assert.equal(out.candidatesConsidered, 20);
    assert.equal(out.candidatesEligible, 20);
  });

  test("an empty eligible population answers empty stats, not NaN", () => {
    const subject = row({ player_id: "s", values: { x: 1 } });
    const out = run(subject, [row({ player_id: "a", values: { x: null } })]);
    assert.equal(out.candidatesConsidered, 1);
    assert.equal(out.candidatesEligible, 0);
    assert.deepEqual(out.results, []);
    assert.deepEqual(out.fieldStats, [{ key: "x", mean: null, stdev: null }]);
  });
});
