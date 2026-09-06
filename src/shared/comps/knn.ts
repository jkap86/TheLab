import type {
  CompPair,
  CompPairReading,
  CompWindowId,
} from "@/shared/contract";

import { criterionById, pairKey } from "./criteria.ts";
import type { CompField } from "./criteria.ts";
import { windowValue } from "./windows.ts";
import type { CompRow } from "./windows.ts";

/**
 * Weighted k-nearest-neighbours over z-scored features. This is the spec, and
 * the arithmetic is the reason the module is pure and tested apart from the
 * route: a gap on the wrong scale, a null read as a zero, or a weight applied
 * to the criterion instead of the pair all rank perfectly and rank wrongly.
 *
 * For every `(field, window)` pair any requested criterion needs, the field is
 * read over that window for **every pool row plus the subject**, and its mean
 * and population standard deviation over that set are what a z-score divides
 * by. A field read over two windows is two different scales and is cached
 * twice. Then, per row, one term per **(criterion, window) pair**:
 *
 * ```
 * pairGap = mean over the criterion's fields of |z(row) − z(subject)|
 * acc    += weight × pairGap²
 * d       = sqrt(acc / Σ weights)
 * ```
 *
 * Three properties this keeps, each of which is the reason for a line below:
 *
 * - **The weight lives on the pair, not the criterion.** PPG-last-year at 1.6
 *   and PPG-career-best at 0.8 are two dimensions with two influences.
 * - **A multi-field criterion averages its fields**, so "Rec yd / rec" does
 *   not outweigh a single-column criterion by reading two columns.
 * - **Dividing by the weight sum** keeps `d` comparable as criteria and
 *   windows are switched on and off, so the similarity readout does not lurch
 *   when one is toggled.
 *
 * **A null is not a zero, and it costs the pair rather than the row.** Where
 * a field is null on the row or on the subject for the window asked, that
 * pair is absent from the row's distance *and from its weight sum*, and its
 * reading ships as null so the chip can say so. A row on which nothing could
 * be read is not a comp and is left out. The statistics behind a z-score are
 * likewise taken over the values that exist.
 */

/** One pool row with the identity the ranking hands back beside its distance. */
export type RankedComp<T extends CompRow> = {
  row: T;
  distance: number;
  /** Keyed by {@link pairKey}, one entry per pair requested. */
  pairs: Record<string, CompPairReading>;
};

type Stats = { mean: number; sd: number };

/**
 * Every pool row, nearest first, under the pairs given. Not truncated — `k`
 * is the caller's, and slicing after sorting is what lets one ranking answer
 * any `k`.
 *
 * An empty `pairs` ranks nothing: with no dimension there is no distance.
 */
export function rankComps<T extends CompRow>(
  subject: CompRow,
  pool: readonly T[],
  pairs: readonly CompPair[],
): RankedComp<T>[] {
  if (pairs.length === 0 || pool.length === 0) return [];

  const stats = new Map<string, Stats>();
  const statsFor = (field: CompField, window: CompWindowId): Stats => {
    const key = `${field}:${window}`;
    const cached = stats.get(key);
    if (cached) return cached;
    const values = pool
      .map((row) => windowValue(row, field, window))
      .concat([windowValue(subject, field, window)])
      .filter((v): v is number => v !== null);
    const computed = zStats(values);
    stats.set(key, computed);
    return computed;
  };

  const ranked: RankedComp<T>[] = [];
  for (const row of pool) {
    let acc = 0;
    let weightSum = 0;
    const readings: Record<string, CompPairReading> = {};

    for (const pair of pairs) {
      const criterion = criterionById(pair.criterion);
      let gapSum = 0;
      let readable = true;
      let read: number | null = null;

      for (const field of criterion.fields) {
        const a = windowValue(row, field, pair.window);
        const b = windowValue(subject, field, pair.window);
        if (a === null || b === null) {
          readable = false;
          break;
        }
        const { mean, sd } = statsFor(field, pair.window);
        gapSum += Math.abs((a - mean) / sd - (b - mean) / sd);
        // The chip prints the criterion's *first* field: "Rec yd / rec" shows
        // the yards, which is the half its label names.
        if (read === null) read = a;
      }

      const key = pairKey(pair.criterion, pair.window);
      if (!readable) {
        readings[key] = { gap: null, read: null };
        continue;
      }
      const gap = gapSum / criterion.fields.length;
      readings[key] = { gap, read };
      acc += pair.weight * gap * gap;
      weightSum += pair.weight;
    }

    if (weightSum === 0) continue;
    ranked.push({ row, distance: Math.sqrt(acc / weightSum), pairs: readings });
  }

  return ranked.sort((a, b) => a.distance - b.distance);
}

/**
 * Mean and *population* standard deviation. A zero spread — one value, or
 * every value equal — becomes 1, so a constant feature contributes a zero gap
 * rather than a division by zero.
 */
export function zStats(values: readonly number[]): Stats {
  if (values.length === 0) return { mean: 0, sd: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) || 1 };
}

/**
 * The decay the similarity readout runs on.
 *
 * `sim% = round(100 × exp(−SIMILARITY_DECAY × d))` is a presentation
 * transform, not a statistic: it maps an unbounded RMS z-distance onto
 * something a reader can hold, and 0.62 was chosen so a good comp in the
 * sample corpus lands in the 60s–80s rather than pinning at 99. **If the real
 * corpus changes the distance distribution, retune this and say so here** —
 * a readout that drifts into always-90s is what a comp tool looks like right
 * before nobody trusts it.
 */
export const SIMILARITY_DECAY = 0.62;

export function similarityPercent(distance: number): number {
  return Math.round(100 * Math.exp(-SIMILARITY_DECAY * distance));
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
