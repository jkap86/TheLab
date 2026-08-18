import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  fieldValue,
  normalizationScale,
  runCompsKnn,
  similarityScore,
} from "./knn.ts";

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

/**
 * The invariant a zero-variance field has to hold *where the subject shares the
 * constant*, which is stronger than "not NaN" and is what the earlier
 * arithmetic broke: a field carrying no comparative information must not be in
 * the distance *at all*, denominator included. Its weight left in the total
 * divided a real gap by weight nothing paid, so adding a constant dimension
 * left the ranking alone and made every similarity score better — a number that
 * looks like a result and is an artefact of the normalization.
 *
 * Every subject below sits **on** the constant, which is the whole of that
 * case. A subject sitting off it is the opposite reading and has its own block.
 */
describe("runCompsKnn — a constant field the subject matches is not in the comparison", () => {
  const spread = [
    row({ player_id: "a", values: { y: 1, k: 5, k2: -3 } }),
    row({ player_id: "b", values: { y: 2, k: 5, k2: -3 } }),
    row({ player_id: "c", values: { y: 3, k: 5, k2: -3 } }),
  ];
  const subject = row({ player_id: "s", values: { y: 3, k: 5, k2: -3 } });

  const readings = (fields: CompsFieldSpec[]) =>
    run(subject, spread, { fields }).results.map((result) => [
      result.row.player_id,
      result.distance,
      result.similarity,
    ]);

  test("adding an equally weighted constant changes nothing at all", () => {
    // The regression in its own numbers. y over {1,2,3} is mean 2, σ = √(2/3),
    // so candidate `a` sits 2 z-units from the subject: d = 2/√(2/3) ≈ 2.4495.
    // With `k` in the denominator and not the numerator that became √(1/2) of
    // it — the same order, uniformly flattered.
    const alone = readings([field("y", 100)]);
    assert.deepEqual(readings([field("y", 100), field("k", 100)]), alone);
  });

  test("nor does a lighter one, a heavier one, or several", () => {
    const alone = readings([field("y", 100)]);
    assert.deepEqual(readings([field("y", 100), field("k", 20)]), alone);
    assert.deepEqual(
      readings([field("k2", 100), field("y", 100), field("k", 60)]),
      alone,
    );
  });

  test("a constant field is still reported, with its σ of 0", () => {
    // Out of the arithmetic is not out of the payload: the reader asked for the
    // dimension, and `pool_stdev: 0` is where they see why it separated nobody.
    const out = run(subject, spread, {
      fields: [field("y", 100), field("k", 100)],
    });
    assert.deepEqual(
      out.fieldStats.map((stats) => [stats.key, stats.stdev]),
      [
        ["y", Math.sqrt(2 / 3)],
        ["k", 0],
      ],
    );
    // And it excludes nobody — every candidate answers it.
    assert.equal(out.candidatesEligible, 3);
    assert.deepEqual(out.excludedMissing, {});
  });

  test("every field constant: distance 0 for all, never NaN or Infinity", () => {
    const out = run(subject, spread, {
      fields: [field("k", 100), field("k2", 40)],
    });
    assert.equal(out.results.length, 3);
    for (const result of out.results) {
      assert.ok(Number.isFinite(result.distance), "finite, so neither NaN nor ∞");
      assert.equal(result.distance, 0);
      assert.equal(result.similarity, 100);
    }
    // Indistinguishable on what was asked, so the deterministic tiebreak orders
    // them rather than whatever the sort happened to do.
    assert.deepEqual(
      out.results.map((result) => result.row.player_id),
      ["a", "b", "c"],
    );
  });

  test("a field the subject cannot answer leaves the denominator too", () => {
    // The same arithmetic from the other side. Resolution normally drops these,
    // so this guards a caller that skipped it: `z` varies across the
    // candidates, so it is not a constant field — it is simply one the subject
    // has no value for, and its weight must not divide the field that did
    // participate.
    const varied = [
      row({ player_id: "a", values: { y: 1, z: 10 } }),
      row({ player_id: "b", values: { y: 2, z: 40 } }),
      row({ player_id: "c", values: { y: 3, z: 90 } }),
    ];
    const blind = row({ player_id: "s", values: { y: 3 } });
    const alone = run(blind, varied, { fields: [field("y", 100)] });
    const withMissing = run(blind, varied, {
      fields: [field("y", 100), field("z", 100)],
    });

    assert.deepEqual(
      withMissing.results.map((result) => [result.row.player_id, result.distance]),
      alone.results.map((result) => [result.row.player_id, result.distance]),
    );
    for (const result of withMissing.results) {
      assert.ok(Number.isFinite(result.distance));
    }
  });

  test("a subject answering nothing is distance 0, not NaN", () => {
    const blind = row({ player_id: "s", values: {} });
    const out = run(blind, spread, { fields: [field("y", 100)] });
    assert.equal(out.results.length, 3);
    for (const result of out.results) {
      assert.equal(result.distance, 0);
      assert.ok(Number.isFinite(result.similarity));
    }
  });
});

/**
 * The other reading of σ = 0, which the block above used to swallow: a
 * population holding one value the subject does **not** hold. Nobody matches
 * the subject on the dimension, so dropping it reported the exact opposite —
 * every candidate a perfect match on the one field the reader asked about.
 *
 * The scale is `max(|subject|, |constant|)`, making the gap the relative
 * difference, so the numbers below are closed forms rather than fixtures.
 */
describe("runCompsKnn — a constant field the subject does not match", () => {
  /** y over {1,2,3}: mean 2, σ = √(2/3). k constant at 5 for every candidate. */
  const spread = [
    row({ player_id: "a", values: { y: 1, k: 5 } }),
    row({ player_id: "b", values: { y: 2, k: 5 } }),
    row({ player_id: "c", values: { y: 3, k: 5 } }),
  ];

  test("A — zero variance and the subject matches: no penalty at all", () => {
    // subject 5 against {5, 5, 5}. The dimension separates nobody from anybody
    // including the subject, so it costs nothing and everyone is a perfect
    // match on what was asked.
    const subject = row({ player_id: "s", values: { k: 5 } });
    const out = run(subject, spread, { fields: [field("k", 100)] });

    assert.equal(out.results.length, 3);
    for (const result of out.results) {
      assert.equal(result.distance, 0);
      assert.equal(result.similarity, 100);
    }
    assert.equal(out.fieldStats[0].stdev, 0);
  });

  test("B — zero variance and the subject differs: never similarity 100", () => {
    // subject 10 against {5, 5, 5}, the only requested field. The regression:
    // σ = 0 dropped the dimension, so d = 0 and every candidate came back at
    // 100 while matching the subject nowhere.
    //
    // Now scale = max(10, 5) = 10 and the gap is (5 − 10)/10 = −0.5, so
    // d = √(100·0.25 / 100) = 0.5 for every candidate.
    const subject = row({ player_id: "s", values: { k: 10 } });
    const out = run(subject, spread, { fields: [field("k", 100)] });

    assert.equal(out.results.length, 3);
    for (const result of out.results) {
      assert.equal(result.distance, 0.5);
      assert.equal(result.similarity, similarityScore(0.5));
      assert.notEqual(result.similarity, 100);
      assert.ok(Number.isFinite(result.distance));
    }
    // 61, not 100 — the number the bug produced is pinned so a revert is loud.
    assert.equal(out.results[0].similarity, 61);
    // The reported statistics are the population's own and unchanged: σ really
    // is 0, and the fallback is a property of the distance, not of the pool.
    assert.deepEqual(out.fieldStats, [{ key: "k", mean: 5, stdev: 0 }]);
  });

  test("B — the mismatch is the relative difference, and is bounded by 2", () => {
    // A gap with no σ behind it must not be able to out-shout one that measured
    // its own scale, so the fallback is bounded rather than an invented z.
    const pairs: [number, number][] = [
      [10, 5], // subject above the constant
      [1, 5], // and below it
      [0, 5], // the subject at zero
      [5, 0], // the constant at zero
      [-5, 5], // opposite signs — the bound, exactly 2
      [1e6, 5], // and an enormous ratio, which does not exceed it
    ];
    for (const [subjectValue, constant] of pairs) {
      const out = run(
        row({ player_id: "s", values: { k: subjectValue } }),
        [
          row({ player_id: "a", values: { k: constant } }),
          row({ player_id: "b", values: { k: constant } }),
        ],
        { fields: [field("k", 100)] },
      );
      const expected =
        Math.abs(constant - subjectValue) /
        Math.max(Math.abs(subjectValue), Math.abs(constant));
      for (const result of out.results) {
        assert.ok(
          Math.abs(result.distance - expected) < 1e-12,
          `${subjectValue} vs ${constant}: ${result.distance} ≠ ${expected}`,
        );
        assert.ok(result.distance <= 2, "bounded, so no runaway z-score");
        assert.ok(result.similarity < 100);
      }
    }
  });

  test("C — beside a varying field it costs everyone the same, and reorders nobody", () => {
    // y varies and the subject matches candidate `c` on it exactly; k is
    // constant at 5 against a subject at 10. Both weighted 100.
    //   c: √((100·0 + 100·0.25) / 200) = √0.125
    //   b: y-gap −1/√(2/3), so √((100·1.5 + 100·0.25) / 200) = √0.875
    //   a: y-gap −2/√(2/3), so √((100·6 + 100·0.25) / 200) = √3.125
    const subject = row({ player_id: "s", values: { y: 3, k: 10 } });
    const out = run(subject, spread, {
      fields: [field("y", 100), field("k", 100)],
    });

    assert.deepEqual(
      out.results.map((result) => result.row.player_id),
      ["c", "b", "a"],
    );
    const distances = out.results.map((result) => result.distance);
    for (const [i, expected] of [
      Math.sqrt(0.125),
      Math.sqrt(0.875),
      Math.sqrt(3.125),
    ].entries()) {
      assert.ok(Math.abs(distances[i] - expected) < 1e-12, `${distances[i]}`);
    }

    // The point of the fix, on the candidate the varying field called perfect:
    // `c` matched the subject on everything the population could measure and
    // still differs from it on the field it could not.
    assert.ok(out.results[0].distance > 0);
    assert.notEqual(out.results[0].similarity, 100);

    // The ordering is the varying field's, untouched: the mismatch is identical
    // for every candidate, so it moves how well anybody matches and never who
    // matches best.
    const alone = run(subject, spread, { fields: [field("y", 100)] });
    assert.deepEqual(
      out.results.map((result) => result.row.player_id),
      alone.results.map((result) => result.row.player_id),
    );
  });

  test("D — the configured weight of the mismatch is respected", () => {
    // Same board, varying `y` pinned at 100, and `k`'s weight swept. For the
    // candidate matching on y the whole distance is the mismatch:
    //   d = √(w · 0.25 / (100 + w))
    const subject = row({ player_id: "s", values: { y: 3, k: 10 } });
    const matched = (weight: number) => {
      const out = run(subject, spread, {
        fields: [field("y", 100), field("k", weight)],
      });
      assert.equal(out.results[0].row.player_id, "c");
      return out.results[0].distance;
    };

    for (const weight of [20, 100, 300]) {
      const expected = Math.sqrt((weight * 0.25) / (100 + weight));
      assert.ok(
        Math.abs(matched(weight) - expected) < 1e-12,
        `weight ${weight}: ${matched(weight)} ≠ ${expected}`,
      );
    }
    // Monotone in the weight, which is what "respected" has to mean on screen:
    // weighting the field the subject differs on more costs the board more.
    assert.ok(matched(20) < matched(100));
    assert.ok(matched(100) < matched(300));

    // And the weight is in the denominator as well as the numerator — the
    // dimension participates fully rather than being bolted onto the distance,
    // so the metric stays the weighted RMS its similarity map is scaled for.
    assert.ok(matched(300) < 0.5, "an RMS over both fields, not a sum");
  });

  test("E — normal fields keep their exact rankings and distances", () => {
    // The existing arithmetic, re-pinned: a board with real spread on every
    // field is untouched by this change. Candidates on x {10, 20} → σ 5, on y
    // {1, 3} → σ 1; subject (20, 3); a's z-gaps are 2 and 2.
    const subject = row({ player_id: "s", values: { x: 20, y: 3 } });
    const out = run(
      subject,
      [
        row({ player_id: "a", values: { x: 10, y: 1 } }),
        row({ player_id: "b", values: { x: 20, y: 3 } }),
      ],
      { fields: [field("x", 100), field("y", 25)] },
    );
    assert.deepEqual(
      out.results.map((result) => [result.row.player_id, result.distance]),
      [
        ["b", 0],
        ["a", 2],
      ],
    );

    // And a larger ordered board keeps its order exactly: y = 0…7 against a
    // subject at 3, so the distance is |i − 3| z-units and each pair either
    // side of the subject ties — broken by player id, the season being equal.
    const graded = run(
      row({ player_id: "s", values: { y: 3 } }),
      Array.from({ length: 8 }, (_, i) =>
        row({ player_id: `c${i}`, values: { y: i } }),
      ),
      { fields: [field("y", 100)] },
    );
    assert.deepEqual(
      graded.results.map((result) => result.row.player_id),
      ["c3", "c2", "c4", "c1", "c5", "c0", "c6", "c7"],
    );
  });

  test("a population constant to within float noise is a constant population", () => {
    // Three identical 0.1s have a σ of 1.4e-17 rather than 0 — the mean is
    // 0.30000000000000004/3. An exact `=== 0` test calls that spread and
    // divides a real gap by it: the subject lands 7e15 σ out and every
    // candidate scores 0, which is the divide-by-zero wearing a finite number.
    const noisy = [
      row({ player_id: "a", values: { y: 1, k: 0.1 } }),
      row({ player_id: "b", values: { y: 2, k: 0.1 } }),
      row({ player_id: "c", values: { y: 3, k: 0.1 } }),
    ];
    assert.notEqual(
      run(row({ player_id: "s", values: { k: 0.1 } }), noisy, {
        fields: [field("k", 100)],
      }).fieldStats[0].stdev,
      0,
    );

    // Subject off the constant: the relative difference, not 7e15.
    const differs = run(row({ player_id: "s", values: { k: 0.2 } }), noisy, {
      fields: [field("k", 100)],
    });
    for (const result of differs.results) {
      assert.ok(Math.abs(result.distance - 0.5) < 1e-12, `${result.distance}`);
      assert.equal(result.similarity, 61);
    }

    // Subject on it: dropped, denominator included, exactly as an exactly
    // constant field is — so a noisy constant cannot flatter a real dimension
    // either.
    const subject = row({ player_id: "s", values: { y: 3, k: 0.1 } });
    const reading = (fields: CompsFieldSpec[]) =>
      run(subject, noisy, { fields }).results.map((result) => [
        result.row.player_id,
        result.distance,
      ]);
    assert.deepEqual(
      reading([field("y", 100), field("k", 100)]),
      reading([field("y", 100)]),
    );
  });
});

describe("normalizationScale", () => {
  test("a population with spread is scaled by its own σ", () => {
    assert.equal(normalizationScale(2, 0.8, 5), 0.8);
    assert.equal(normalizationScale(2, 0.8, 2), 0.8);
    // Even a subject far outside it — the σ is measured, so it is used.
    assert.equal(normalizationScale(2, 0.8, 1e6), 0.8);
  });

  test("a constant population the subject sits on has no scale and no say", () => {
    assert.equal(normalizationScale(5, 0, 5), null);
    assert.equal(normalizationScale(0, 0, 0), null);
    assert.equal(normalizationScale(-3, 0, -3), null);
    // Within float noise of it is sitting on it.
    assert.equal(normalizationScale(0.1, 1.4e-17, 0.1), null);
  });

  test("a constant population the subject sits off is scaled by the larger magnitude", () => {
    assert.equal(normalizationScale(5, 0, 10), 10);
    assert.equal(normalizationScale(5, 0, 1), 5);
    assert.equal(normalizationScale(0, 0, 3), 3);
    assert.equal(normalizationScale(5, 0, 0), 5);
    assert.equal(normalizationScale(5, 0, -5), 5);
  });
});
