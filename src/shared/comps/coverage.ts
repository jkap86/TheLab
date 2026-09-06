/**
 * Weighted comparison coverage: how much of what the reader asked for a
 * candidate could actually be compared on.
 *
 * **This is the rule that stops a sparse row looking like a perfect comp.**
 * The distance drops an unreadable pair from both its numerator and its weight
 * sum, which is right — a null is not a zero, and scoring one would push a row
 * away for a reason the data does not support. But dropped from both, a row
 * with target share and nothing else can match the subject's target share
 * exactly and come back at distance 0, ranked above a row that answered every
 * criterion and matched most of them well. On a hand-written sample where
 * every column is filled that never happened; on a real corpus with uneven
 * advanced-stat coverage it is the ordinary case, and it is invisible: the row
 * renders perfectly, with em dashes on the chips nobody reads once the
 * headline says 100%.
 *
 * So a row also reports the share of the weight it was *comparable* on, and a
 * row below {@link MIN_WEIGHTED_COVERAGE} does not rank at all.
 *
 * **The denominator is the weight the subject can be read on, not the weight
 * the reader requested**, and the difference matters more than it sounds. A
 * criterion the corpus holds for nobody — yards per route, which no source
 * this app has publishes — is unreadable on the subject too, so measured
 * against the full request every candidate in the corpus would fail the
 * threshold and the board would come back empty with nothing saying why. A
 * pair the subject cannot answer is a question that cannot be asked of anyone;
 * it is reported separately (`subject_coverage` on the payload) rather than
 * charged to the candidates. What a candidate is charged for is the pair the
 * subject *can* answer and it cannot.
 *
 * Pure, and the constants live here rather than being spelled at each of the
 * three call sites that read them — the route's payload, the ranking's gate
 * and the card's badge are one threshold or they are three.
 */

/**
 * The share of comparable weight a candidate must carry to rank.
 *
 * Three quarters: enough that a row answering one criterion of four cannot
 * reach the board, and loose enough that a row missing a single supporting
 * criterion still can. It is a judgement rather than a measurement — the
 * distribution it would be fitted against is a real corpus's, and this repo
 * has not loaded one yet — which is why it is one named constant with this
 * paragraph attached rather than a literal in a filter.
 */
export const MIN_WEIGHTED_COVERAGE = 0.75;

/**
 * The slack the threshold is compared with.
 *
 * A coverage of exactly the minimum must pass, and weights are floats written
 * to one decimal: `0.6 + 0.6 + 0.6` over `2.4` is `0.7499999999999999`, which
 * is the boundary case failing on a representation nobody can see. The epsilon
 * is what makes "at or above" mean what it says.
 */
export const COVERAGE_EPSILON = 1e-9;

/**
 * `available / comparable`, clamped to 0–1.
 *
 * A comparable weight of zero means the subject could not be read on a single
 * requested pair, so there is no comparison to have a coverage of; the answer
 * is 0 and the caller ranks nothing.
 */
export function weightedCoverage(available: number, comparable: number): number {
  if (!(comparable > 0) || !Number.isFinite(comparable)) return 0;
  if (!Number.isFinite(available) || available <= 0) return 0;
  return Math.min(1, available / comparable);
}

/** Whether a coverage clears the minimum, boundary included. */
export function meetsMinimumCoverage(
  coverage: number,
  minimum: number = MIN_WEIGHTED_COVERAGE,
): boolean {
  return coverage + COVERAGE_EPSILON >= minimum;
}
