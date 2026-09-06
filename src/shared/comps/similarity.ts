/**
 * Turning a distance into the similarity percentage the card prints.
 *
 * **The old constant was fitted to twenty-six invented rows.** `sim% = 100 ×
 * exp(−0.62 · d)` was chosen so that a good comp *in the sample corpus* landed
 * in the sixties and seventies rather than pinning at 99, and its own comment
 * said to retune it when a real corpus changed the distance distribution. A
 * hand-tuned decay carried onto a corpus with different spread is a readout
 * that drifts into always-90s or never-past-40, and either is what a comp tool
 * looks like just before nobody trusts it.
 *
 * So the decay is **derived from the distances actually in front of the
 * reader**: the eligible pool's own median distance is anchored to
 * {@link SIMILARITY_ANCHOR_PERCENT}, and the curve follows from there. Half the
 * pool is nearer than the median by construction, so a comp that reads 50 is a
 * comp no better than the middle of the field it was drawn from, and one that
 * reads 85 is genuinely near the front of it. The scale re-derives whenever
 * the pool changes, which is correct rather than unstable: a similarity is a
 * statement about a candidate *relative to the field being searched*, and
 * narrowing the field is a change to that statement.
 *
 * The shape stays exponential rather than becoming a bare percentile, and that
 * is the one thing this deliberately does not do. A percentile would make the
 * nearest comp read ~100 whether or not it is any good, which destroys the
 * only absolute information the number carries — an exact match is 100 and a
 * distant one is low, whatever else is in the pool.
 *
 * Pure, and centralised: the ranking calibrates once per pool and stamps each
 * match, so the browser never needs the distribution and cannot spell the
 * transform a second way.
 */

/**
 * The decay used when the pool is too small or too degenerate to calibrate.
 *
 * This is the old constant, kept **only** as the fallback and named for what
 * it is. It is the right answer for a handful of rows precisely because it was
 * fitted to a handful of rows.
 */
export const SIMILARITY_FALLBACK_DECAY = 0.62;

/**
 * How many usable distances a calibration needs.
 *
 * Below this a median is one or two rows' opinion of the whole distribution,
 * and a scale derived from it would lurch as the reader nudges a season bound.
 * Eight is small enough that any real corpus clears it on the first press and
 * large enough that a median means something.
 */
export const SIMILARITY_MIN_SAMPLE = 8;

/** The quantile of the pool's distances the anchor is taken at. */
export const SIMILARITY_ANCHOR_QUANTILE = 0.5;

/** What a candidate at the anchor quantile reads. */
export const SIMILARITY_ANCHOR_PERCENT = 50;

/**
 * The decay is clamped, because the anchor is data and data has degenerate
 * days. A pool whose median distance is a millionth would otherwise produce a
 * decay large enough to read every comp but the first as 0, and one whose
 * median is enormous a decay that reads everything as 100. The bounds are wide
 * enough never to bind on a plausible distribution and narrow enough that an
 * implausible one still prints a scale somebody can read.
 */
export const SIMILARITY_DECAY_MIN = 0.05;
export const SIMILARITY_DECAY_MAX = 20;

/** A calibrated distance → percentage transform, plus what it was fitted on. */
export type SimilarityScale = {
  /** The λ in `100 · exp(−λd)`. Always finite and positive. */
  decay: number;
  /** False when the fallback decay is in use. */
  calibrated: boolean;
  /** How many usable distances the calibration saw. */
  sample: number;
  /** The anchor distance, or null when uncalibrated. */
  anchor: number | null;
  /** The readout, 0–100 and monotonically non-increasing in `distance`. */
  percent: (distance: number) => number;
};

/**
 * A scale fitted to `distances`, or the documented fallback where they cannot
 * fit one.
 *
 * Three ways to be uncalibratable, and each falls back rather than throwing:
 * fewer than {@link SIMILARITY_MIN_SAMPLE} usable values; a median of zero,
 * which is a pool more than half of whose rows are exact matches and therefore
 * has no spread to anchor to; and a non-finite median, which nothing should
 * produce and which must not reach a payload if something does.
 */
export function calibrateSimilarity(
  distances: readonly number[],
): SimilarityScale {
  const usable = distances
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);

  if (usable.length < SIMILARITY_MIN_SAMPLE) {
    return scaleOf(SIMILARITY_FALLBACK_DECAY, false, usable.length, null);
  }

  const anchor = quantile(usable, SIMILARITY_ANCHOR_QUANTILE);
  if (!Number.isFinite(anchor) || anchor <= 0) {
    return scaleOf(SIMILARITY_FALLBACK_DECAY, false, usable.length, null);
  }

  // `100 · exp(−λ · anchor) = ANCHOR_PERCENT` solved for λ.
  const raw = Math.log(100 / SIMILARITY_ANCHOR_PERCENT) / anchor;
  const decay = Math.min(SIMILARITY_DECAY_MAX, Math.max(SIMILARITY_DECAY_MIN, raw));
  return scaleOf(decay, true, usable.length, anchor);
}

function scaleOf(
  decay: number,
  calibrated: boolean,
  sample: number,
  anchor: number | null,
): SimilarityScale {
  return {
    decay,
    calibrated,
    sample,
    anchor,
    percent: (distance) => similarityPercent(distance, decay),
  };
}

/**
 * `100 · exp(−decay · d)`, rounded and bounded.
 *
 * A negative or non-finite distance cannot arise from the ranking and is
 * answered defensively rather than propagated: `NaN` in a payload is a card
 * printing `NaN%`, which is the one outcome worse than a wrong number.
 */
export function similarityPercent(
  distance: number,
  decay: number = SIMILARITY_FALLBACK_DECAY,
): number {
  if (!Number.isFinite(distance)) return 0;
  const d = Math.max(0, distance);
  const percent = Math.round(100 * Math.exp(-decay * d));
  return Math.min(100, Math.max(0, percent));
}

/**
 * The linear-interpolated quantile of an **already ascending** list.
 *
 * Interpolated rather than nearest-rank so the anchor moves smoothly as the
 * pool grows by one; a stepped median would make the whole board's percentages
 * jump on a filter press that added a single row.
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
