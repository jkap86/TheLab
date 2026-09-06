import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CompPair, CompWindowId } from "@/shared/contract";
import {
  CRITERIA,
  UDFA_PICK,
  WINDOWS,
  criterionById,
  isStatField,
  isWindowed,
  pairKey,
} from "../comps/criteria.ts";
import type { CompField } from "../comps/criteria.ts";
import { MIN_WEIGHTED_COVERAGE } from "../comps/coverage.ts";
import { isEligible, rankComps } from "../comps/knn.ts";
import type { CompRow } from "../comps/windows.ts";

import { SAMPLE_CORPUS } from "./sample.ts";

/**
 * The sample corpus end to end: the whole ranking, run against an independent
 * implementation of the documented arithmetic rather than rule by rule.
 *
 * **This used to pin the design prototype's own output to six decimal places**
 * — its `CORPUS`, `PREV`, `windowValue` and distance loop extracted from
 * `Comps.dc.html` and run under Node — and those figures no longer apply,
 * because the prototype z-scored the candidate pool **plus the subject** and
 * this does not. That was not a transcription error to preserve; it was the
 * bug `shared/comps/knn` documents at length, where an extreme subject widens
 * the scale and thereby turns down the criterion he is extreme on.
 *
 * A frozen snapshot of the *new* numbers would be a test that only says the
 * code still does what it did, which is worth much less. So the reference
 * below is a second, deliberately naive implementation of the formula as this
 * repo's own documentation states it: pool-only statistics, a pair gap that is
 * the mean of its fields' z-gaps, a weighted RMS over the available weight.
 * If the module and this file agree over twenty-six seasons, four windows and
 * eleven criteria, they agree about the spec.
 */

const defaultPairs = (): CompPair[] =>
  CRITERIA.filter((c) => c.on).flatMap((c) =>
    c.wins.map((w) => ({ criterion: c.id, window: w.id, weight: w.w })),
  );

const everyWindow = (): CompPair[] =>
  CRITERIA.flatMap((c) =>
    isWindowed(c)
      ? WINDOWS.map((w) => ({ criterion: c.id, window: w.id, weight: 1 }))
      : c.wins.map((w) => ({ criterion: c.id, window: w.id, weight: w.w })),
  );

/* ── the reference implementation ─────────────────────────────────────── */

/** The documented window read, written out rather than imported. */
function refValue(row: CompRow, field: CompField, window: CompWindowId): number | null {
  if (!isStatField(field)) {
    if (field === "age") return row.facts.age;
    if (field === "exp") return row.facts.exp;
    if (row.facts.draft === null) return null;
    return row.facts.draft === "udfa" ? UDFA_PICK : row.facts.draft;
  }
  const span =
    window === "last"
      ? 1
      : window === "avg2"
        ? Math.min(2, row.history.length)
        : row.history.length;
  const series: number[] = [];
  for (let i = 0; i < span; i++) {
    const value = row.history[i][field];
    if (value !== null) series.push(value);
  }
  if (series.length === 0) return null;
  if (window === "chigh") return Math.max(...series);
  return series.reduce((a, b) => a + b, 0) / series.length;
}

/** Mean and population SD over the **pool alone**. */
function refStats(values: number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return { mean, sd: sd > 0 ? sd : 1 };
}

type RefRanked = { name: string; season: number; distance: number; coverage: number };

function refRank(
  subject: CompRow,
  pool: readonly (CompRow & { name: string; season: number })[],
  pairs: readonly CompPair[],
): RefRanked[] {
  const stats = (field: CompField, window: CompWindowId) =>
    refStats(
      pool
        .map((row) => refValue(row, field, window))
        .filter((v): v is number => v !== null),
    );

  const subjectReadable = pairs.filter((pair) =>
    criterionById(pair.criterion).fields.every(
      (field) => refValue(subject, field, pair.window) !== null,
    ),
  );
  const comparable = subjectReadable.reduce((sum, p) => sum + p.weight, 0);
  if (comparable === 0) return [];

  const out: RefRanked[] = [];
  for (const row of pool) {
    let acc = 0;
    let available = 0;
    for (const pair of subjectReadable) {
      const fields = criterionById(pair.criterion).fields;
      const readings = fields.map((field) => ({
        a: refValue(row, field, pair.window),
        b: refValue(subject, field, pair.window),
        field,
      }));
      if (readings.some((r) => r.a === null)) continue;
      let gapSum = 0;
      for (const { a, b, field } of readings) {
        const { mean, sd } = stats(field, pair.window);
        gapSum += Math.abs((a! - mean) / sd - (b! - mean) / sd);
      }
      const gap = gapSum / fields.length;
      acc += pair.weight * gap * gap;
      available += pair.weight;
    }
    const coverage = available / comparable;
    if (coverage + 1e-9 < MIN_WEIGHTED_COVERAGE) continue;
    out.push({
      name: row.name,
      season: row.season,
      distance: Math.sqrt(acc / available),
      coverage,
    });
  }
  return out.sort((a, b) => a.distance - b.distance || b.coverage - a.coverage);
}

/* ── the runs ─────────────────────────────────────────────────────────── */

function poolFor(name: string) {
  const subject = SAMPLE_CORPUS.subjects.find((s) => s.name === name)!;
  const pool = SAMPLE_CORPUS.seasons.filter((s) =>
    isEligible(s, subject, { posLock: true, excludeOwn: true, from: 2018, to: 2024 }),
  );
  return { subject, pool };
}

const shape = (rows: { name: string; season: number; distance: number }[]) =>
  rows.map((r) => [r.name, r.season, Number(r.distance.toFixed(9))]);

describe("the sample corpus", () => {
  test("is the prototype's: 26 seasons, 12 subjects entering 2026, three rookie rows", () => {
    assert.equal(SAMPLE_CORPUS.source, "sample");
    assert.equal(SAMPLE_CORPUS.subject_season, 2026);
    assert.equal(SAMPLE_CORPUS.seasons.length, 26);
    assert.equal(SAMPLE_CORPUS.subjects.length, 12);
    assert.deepEqual(
      SAMPLE_CORPUS.seasons.filter((s) => s.history.length === 1).map((s) => `${s.name} ${s.season}`),
      ["Ja'Marr Chase 2021", "Puka Nacua 2023", "Saquon Barkley 2018"],
    );
    assert.equal(new Set(SAMPLE_CORPUS.subjects.map((s) => s.player_id)).size, 12);
    // A player on both sides carries one id, which is what the own-season
    // exclusion reads.
    const nacua = SAMPLE_CORPUS.subjects.find((s) => s.name === "Puka Nacua")!;
    assert.ok(SAMPLE_CORPUS.seasons.some((s) => s.player_id === nacua.player_id));
  });

  test("every sample season played the year after — the sample holds no zero outcome", () => {
    // Worth pinning because it is the sample's own limitation and part of why
    // it is not a corpus to reason from: twenty-six hand-picked good seasons,
    // every one of them followed by another.
    assert.ok(SAMPLE_CORPUS.seasons.every((s) => s.next.played));
    assert.deepEqual(SAMPLE_CORPUS.covered_seasons, [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    assert.equal(SAMPLE_CORPUS.max_completed_season, 2025);
  });

  for (const [name, pairs, label] of [
    ["Puka Nacua", defaultPairs(), "the default criteria"],
    ["Bijan Robinson", defaultPairs(), "a running back"],
    ["Rome Odunze", defaultPairs(), "a subject with a rookie row in the pool"],
    ["Puka Nacua", everyWindow(), "every criterion on every window"],
  ] as const) {
    test(`agrees with an independent implementation of the formula: ${label}`, () => {
      const { subject, pool } = poolFor(name);
      const ranking = rankComps(subject, pool, [...pairs]);
      const reference = refRank(subject, pool, pairs);

      assert.ok(ranking.ranked.length > 0);
      assert.deepEqual(
        shape(ranking.ranked.map((r) => ({ ...r.row, distance: r.distance }))),
        shape(reference),
      );
      // Coverage too: every sample row is complete, so every one is 1.
      assert.ok(ranking.ranked.every((r) => r.coverage === 1));
      assert.equal(ranking.excludedLowCoverage, 0);
    });
  }

  test("a running back is ranked against running backs only", () => {
    const { subject, pool } = poolFor("Bijan Robinson");
    const ranking = rankComps(subject, pool, defaultPairs());
    assert.ok(ranking.ranked.every((r) => r.row.position === "RB"));
    assert.ok(ranking.ranked.every((r) => r.row.name !== "Bijan Robinson"));
  });

  test("the scale is the pool's, and an extreme subject does not widen it", () => {
    // The prototype's own bug, checked on real rows. Two subjects, both above
    // every candidate's PPG so the gaps are all measured the same way round:
    // the *scale* the gaps are in must be identical, and it must be the pool's
    // own standard deviation. Under the old rule the subject's value entered
    // that standard deviation, so the 400 run would have read a scale several
    // times wider than the 100 run and every gap on it correspondingly
    // smaller — the criterion he was most unusual on, quietly turned down.
    const { subject, pool } = poolFor("Puka Nacua");
    const pairs: CompPair[] = [{ criterion: "ppg", window: "last", weight: 1 }];

    const withPpg = (ppg: number): CompRow => ({
      ...subject,
      history: [{ ...subject.history[0], ppg }, ...subject.history.slice(1)],
    });

    /** The scale recovered from two candidates: their PPG apart per z apart. */
    const recoveredSd = (subjectPpg: number): number => {
      const ranked = rankComps(withPpg(subjectPpg), pool, pairs).ranked;
      const gapOf = new Map(
        ranked.map((r) => [`${r.row.name}:${r.row.season}`, r.pairs[pairKey("ppg", "last")].gap!]),
      );
      const [a, b] = [ranked[0].row, ranked[ranked.length - 1].row];
      const ppgApart = Math.abs(a.history[0].ppg - b.history[0].ppg);
      const zApart = Math.abs(gapOf.get(`${a.name}:${a.season}`)! - gapOf.get(`${b.name}:${b.season}`)!);
      return ppgApart / zApart;
    };

    const poolPpg = pool.map((p) => p.history[0].ppg);
    const mean = poolPpg.reduce((x, y) => x + y, 0) / poolPpg.length;
    const poolSd = Math.sqrt(
      poolPpg.reduce((sum, v) => sum + (v - mean) ** 2, 0) / poolPpg.length,
    );

    assert.ok(Math.abs(recoveredSd(100) - poolSd) < 1e-9);
    assert.ok(Math.abs(recoveredSd(400) - poolSd) < 1e-9);
  });
});
