import type {
  CompPair,
  CompPairReading,
  CompWindowId,
} from "@/shared/contract";

import { MIN_WEIGHTED_COVERAGE, meetsMinimumCoverage, weightedCoverage } from "./coverage.ts";
import { criterionById, pairKey } from "./criteria.ts";
import type { CompField } from "./criteria.ts";
import { calibrateSimilarity } from "./similarity.ts";
import type { SimilarityScale } from "./similarity.ts";
import { windowReading } from "./windows.ts";
import type { CompRow } from "./windows.ts";

/**
 * Weighted k-nearest-neighbours over z-scored features. This is the spec, and
 * the arithmetic is the reason the module is pure and tested apart from the
 * route: a gap on the wrong scale, a null read as a zero, a weight applied to
 * the criterion instead of the pair, or a sparse row that drops its way to a
 * distance of nought all rank perfectly and rank wrongly.
 *
 * For every `(field, window)` pair any requested criterion needs, the field is
 * read over that window for **every pool row** — and the mean and population
 * standard deviation over *that* set are what a z-score divides by. Then, per
 * row, one term per **(criterion, window) pair**:
 *
 * ```
 * pairGap = mean over the criterion's fields of |z(row) − z(subject)|
 * acc    += weight × pairGap²
 * d       = sqrt(acc / Σ available weight)
 * ```
 *
 * Five properties this keeps, each of which is the reason for a line below:
 *
 * - **The scale comes from the candidate population, not from the population
 *   plus the subject.** The subject is transformed *by* the scale and never
 *   contributes to it, which is a correction rather than a refinement: an
 *   extreme subject dropped into the standard deviation widens it, and a
 *   widened scale shrinks every gap on that criterion — so the more unusual
 *   the player being comped, the less the criterion he is unusual on counted.
 *   Exactly backwards.
 * - **The weight lives on the pair, not the criterion.** PPG-last-year at 1.6
 *   and PPG-career-best at 0.8 are two dimensions with two influences.
 * - **A multi-field criterion averages its fields**, so "Rec yd / rec" does
 *   not outweigh a single-column criterion by reading two columns.
 * - **Dividing by the available weight sum** keeps `d` comparable as criteria
 *   and windows are switched on and off, so the similarity readout does not
 *   lurch when one is toggled.
 * - **A row that could not be read on enough of the question does not rank.**
 *   See `./coverage` — dropping a pair from numerator and denominator alike is
 *   the right treatment of a null and the wrong treatment of a row that is
 *   nearly all nulls, and the gate is what separates the two.
 *
 * **A null is not a zero, and it costs the pair rather than the row.** Where a
 * field is null on the row or on the subject for the window asked, that pair
 * is absent from the row's distance *and from its weight sum*, and its reading
 * ships as null so the chip can say so. The statistics behind a z-score are
 * likewise taken over the values that exist.
 *
 * **A pair the subject cannot be read on is nobody's fault and nobody's
 * coverage.** It is excluded from the comparable weight entirely, so a stat
 * absent from the whole corpus narrows the comparison rather than emptying the
 * board — reported once, on the ranking, rather than charged to every row in
 * it.
 */

/** One pool row with the identity the ranking hands back beside its distance. */
export type RankedComp<T extends CompRow> = {
  row: T;
  distance: number;
  /** The share of comparable weight this row was read on, 0–1. */
  coverage: number;
  /** The calibrated readout — see `./similarity`. */
  similarity: number;
  /** Keyed by {@link pairKey}, one entry per pair requested. */
  pairs: Record<string, CompPairReading>;
};

/**
 * A ranking, and enough about the pool behind it to say why it is the size it
 * is. A thin board is either a narrow filter or a corpus that cannot answer
 * the criteria asked of it, and only these counts tell the two apart.
 */
export type CompRanking<T extends CompRow> = {
  /** Nearest first. Not truncated — `k` is the caller's. */
  ranked: RankedComp<T>[];
  /** Rows the caller handed in. */
  eligible: number;
  /** Rows dropped for failing {@link MIN_WEIGHTED_COVERAGE}. */
  excludedLowCoverage: number;
  /** Σ weight of every requested pair. */
  requestedWeight: number;
  /** Σ weight of the pairs the subject himself can be read on. */
  comparableWeight: number;
  /** `comparableWeight / requestedWeight`, 0–1. */
  subjectCoverage: number;
  /** The minimum coverage applied. */
  minCoverage: number;
  /** How the distances were turned into percentages. */
  similarity: SimilarityScale;
};

type Stats = { mean: number; sd: number };

/** An unreadable pair, spelled once. */
const unread = (of: number): CompPairReading => ({
  gap: null,
  read: null,
  used: null,
  of,
});

/**
 * Every pool row that could be compared on enough of the question, nearest
 * first, under the pairs given.
 *
 * An empty `pairs` ranks nothing: with no dimension there is no distance. So
 * does a subject none of the pairs can be read on, which is the same statement
 * one step in.
 */
export function rankComps<T extends CompRow>(
  subject: CompRow,
  pool: readonly T[],
  pairs: readonly CompPair[],
  options: { minCoverage?: number } = {},
): CompRanking<T> {
  const minCoverage = options.minCoverage ?? MIN_WEIGHTED_COVERAGE;
  const requestedWeight = pairs.reduce((sum, p) => sum + p.weight, 0);

  if (pairs.length === 0 || pool.length === 0) {
    return empty(pool.length, requestedWeight, minCoverage);
  }

  // The scale is the pool's. Computed lazily and cached per (field, window),
  // since a field read over two windows is two different scales.
  const stats = new Map<string, Stats>();
  const statsFor = (field: CompField, window: CompWindowId): Stats => {
    const key = `${field}:${window}`;
    const cached = stats.get(key);
    if (cached) return cached;
    const values: number[] = [];
    for (const row of pool) {
      const value = windowReading(row, field, window).value;
      if (value !== null) values.push(value);
    }
    const computed = zStats(values);
    stats.set(key, computed);
    return computed;
  };

  // Which pairs the subject can answer at all, read once rather than per row.
  const subjectPairs = pairs.map((pair) => {
    const criterion = criterionById(pair.criterion);
    const readings = criterion.fields.map((field) =>
      windowReading(subject, field, pair.window),
    );
    return {
      pair,
      criterion,
      key: pairKey(pair.criterion, pair.window),
      readable: readings.every((r) => r.value !== null),
      values: readings.map((r) => r.value),
    };
  });

  const comparableWeight = subjectPairs
    .filter((p) => p.readable)
    .reduce((sum, p) => sum + p.pair.weight, 0);

  if (comparableWeight <= 0) {
    return empty(pool.length, requestedWeight, minCoverage);
  }

  const scored: RankedComp<T>[] = [];
  let excludedLowCoverage = 0;

  for (const row of pool) {
    let acc = 0;
    let availableWeight = 0;
    const readings: Record<string, CompPairReading> = {};

    for (const spec of subjectPairs) {
      const { pair, criterion, key } = spec;

      // The row's own reading comes first, so a pair the subject cannot answer
      // still reports how much of its window this row had — the chip draws an
      // em dash either way, and the count is what the diagnostics read.
      const rowReadings = criterion.fields.map((field) =>
        windowReading(row, field, pair.window),
      );
      // The criterion's own span: the weakest of its fields, since a pair is
      // only as well founded as the thinnest column behind it.
      const of = Math.min(...rowReadings.map((r) => r.of));
      const used = Math.min(...rowReadings.map((r) => r.used));

      if (!spec.readable || rowReadings.some((r) => r.value === null)) {
        readings[key] = unread(of);
        continue;
      }

      let gapSum = 0;
      for (let i = 0; i < criterion.fields.length; i++) {
        const a = rowReadings[i].value as number;
        const b = spec.values[i] as number;
        const { mean, sd } = statsFor(criterion.fields[i], pair.window);
        gapSum += Math.abs((a - mean) / sd - (b - mean) / sd);
      }

      const gap = gapSum / criterion.fields.length;
      readings[key] = {
        gap,
        // The chip prints the criterion's *first* field: "Rec yd / rec" shows
        // the yards, which is the half its label names.
        read: rowReadings[0].value,
        used,
        of,
      };
      acc += pair.weight * gap * gap;
      availableWeight += pair.weight;
    }

    const coverage = weightedCoverage(availableWeight, comparableWeight);
    if (!meetsMinimumCoverage(coverage, minCoverage)) {
      excludedLowCoverage++;
      continue;
    }

    const distance = Math.sqrt(acc / availableWeight);
    // Nothing in the arithmetic above can produce a non-finite distance —
    // `sd` is never zero and `availableWeight` is positive here — but a
    // payload is the wrong place to find out, so the guard stays.
    if (!Number.isFinite(distance)) {
      excludedLowCoverage++;
      continue;
    }
    scored.push({ row, distance, coverage, similarity: 0, pairs: readings });
  }

  // Calibrated on the rows that actually ranked, which is the population the
  // reader is being shown a position within.
  const similarity = calibrateSimilarity(scored.map((s) => s.distance));
  for (const entry of scored) entry.similarity = similarity.percent(entry.distance);

  // Nearer first; on a tie the row compared on more of the question, which is
  // the better-founded of two equal readings rather than a nicer-looking one.
  scored.sort((a, b) => a.distance - b.distance || b.coverage - a.coverage);

  return {
    ranked: scored,
    eligible: pool.length,
    excludedLowCoverage,
    requestedWeight,
    comparableWeight,
    subjectCoverage: weightedCoverage(comparableWeight, requestedWeight),
    minCoverage,
    similarity,
  };
}

function empty<T extends CompRow>(
  eligible: number,
  requestedWeight: number,
  minCoverage: number,
): CompRanking<T> {
  return {
    ranked: [],
    eligible,
    excludedLowCoverage: 0,
    requestedWeight,
    comparableWeight: 0,
    subjectCoverage: 0,
    minCoverage,
    similarity: calibrateSimilarity([]),
  };
}

/**
 * Mean and *population* standard deviation over the candidate pool.
 *
 * A zero spread — one value, or every value equal — becomes 1. That is the
 * safe answer rather than the meaningful one, and the difference is worth
 * knowing: with no spread in the pool there is no scale, so the gap degrades
 * to the raw difference, which is the same for every row and therefore orders
 * nothing. It inflates the absolute distance and leaves the ranking untouched,
 * where a division by zero would put `Infinity` on a card.
 */
export function zStats(values: readonly number[]): Stats {
  if (values.length === 0) return { mean: 0, sd: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return { mean, sd: Number.isFinite(sd) && sd > 0 ? sd : 1 };
}

/**
 * How near one pair read, as the chip's bar count: three bars under 0.3 z,
 * two under 0.7, one otherwise. Null — an unreadable pair — lights none.
 */
export function closenessBars(gap: number | null): 0 | 1 | 2 | 3 {
  if (gap === null) return 0;
  return gap < 0.3 ? 3 : gap < 0.7 ? 2 : 1;
}

/** What the pool filter reads off a season, and what it narrows by. */
export type PoolSeason = { player_id: string; position: string; season: number };

export type PoolBounds = {
  /** Only the subject's position, where there is a subject. */
  posLock: boolean;
  /** Never the subject's own seasons, where there is a subject. */
  excludeOwn: boolean;
  from: number;
  to: number;
};

/**
 * Whether a season is in the pool. Without a subject the position lock and
 * the own-season exclusion have nothing to read and are no-ops, so the count
 * the pool strip shows before a player is picked is the season range alone.
 */
export function isEligible(
  season: PoolSeason,
  subject: Pick<PoolSeason, "player_id" | "position"> | null,
  bounds: PoolBounds,
): boolean {
  if (season.season < bounds.from || season.season > bounds.to) return false;
  if (!subject) return true;
  if (bounds.posLock && season.position !== subject.position) return false;
  if (bounds.excludeOwn && season.player_id === subject.player_id) return false;
  return true;
}
