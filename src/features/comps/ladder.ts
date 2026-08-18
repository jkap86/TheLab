// Relative pure→pure imports: this module is tested under Node's runner.
import { COMPS_FIELDS } from "../../shared/comps/fields.ts";

import type { CompsField } from "../../shared/comps/fields.ts";

/**
 * The comparison board as a *ranked ladder* rather than a bank of sliders.
 *
 * The bench asked "how much should targets weigh, 0 to 100" and drew a row for
 * every one of the catalogue's twenty-nine fields to ask it — twenty-two of
 * which, on a tuned board, reported that they were switched off. The question a
 * reader actually arrives with is coarser and comparative: **targets matter
 * most, age matters a bit.** That is a rank and a magnitude, which is what this
 * is.
 *
 * Four decisions, and the first is the one the rest follow from:
 *
 * - **Five notches, and the wire is unchanged.** A tier is `n × 20`, so the
 *   ladder is a *view* of the same 0–100 weights the route has always taken and
 *   nothing about the query string, the cache key or a stored board moves. It
 *   costs nothing to adopt because **every default weight in the catalogue is
 *   already a multiple of 20** (60, 80, 100 — `ladder.test.ts` pins it), so no
 *   position's opening board is approximated by the notches. A hand-tuned 85
 *   from a URL is shown at the notch it rounds to and left alone until pressed.
 * - **Order is derived from weight, never dragged.** The mockup drew a grip,
 *   and dropping it is what makes this cheap *and* more honest: two fields at
 *   the same tier weigh the same in the distance, so any order between them is
 *   a fiction the list would be inventing. Ties fall back to catalogue order,
 *   which is stable. It also costs the ladder nothing a reader can feel —
 *   pressing a notch moves the row to where it belongs, which is the same
 *   gesture with one fewer thing to learn and a keyboard path that exists.
 * - **A press sets a tier; it never steps one.** One press is one decision and
 *   therefore one re-sort — stepping 1→5 would move the row four times under a
 *   finger that is trying to hold still.
 * - **Off the board is off the list.** Weight 0 is not a row at zero, it is a
 *   chip in the bin, so the ladder is only ever as long as the comparison.
 */

/** Notches on a row: the ladder's whole vocabulary of magnitude. */
export const LADDER_TIERS = 5;

/** What one notch is worth on the 0–100 scale the wire and the KNN use. */
export const TIER_WEIGHT = 100 / LADDER_TIERS;

/**
 * The tier a field lands on when a reader adds it from the bin — the middle,
 * which is "also consider this" and is where the catalogue's own defaults
 * mostly sit. Raising it is one press; opening at the top would be the bin
 * deciding something the reader hasn't said.
 */
export const ADDED_TIER = 3;

/** The notch a weight reads as, 0 (off the board) to {@link LADDER_TIERS}. */
export function tierOf(weight: number): number {
  if (!(weight > 0)) return 0;
  return Math.min(LADDER_TIERS, Math.max(1, Math.round(weight / TIER_WEIGHT)));
}

/** The weight a notch writes. */
export function weightForTier(tier: number): number {
  return Math.round(Math.min(LADDER_TIERS, Math.max(0, tier)) * TIER_WEIGHT);
}

export type LadderRow = {
  field: CompsField;
  /** The stored weight, which a hand-tuned board may hold off a notch. */
  weight: number;
  tier: number;
  /**
   * This field's share of the whole comparison — the number the mix strip
   * draws, stated per row because a proportion is what a weight *is* and the
   * strip can only show it as a picture. Read off the true weights, so a board
   * carrying an 85 reconciles with the strip rather than with its own notches.
   */
  share: number;
};

/**
 * The board, heaviest first. Ties keep catalogue order, so the list is a
 * function of the weights alone and two renders of one board cannot differ.
 */
export function ladderRows(weights: Record<string, number>): LadderRow[] {
  const load = boardLoad(weights);
  return COMPS_FIELDS.map((field, index) => ({ field, index }))
    .filter(({ field }) => (weights[field.key] ?? 0) > 0)
    .sort((a, b) => {
      const byWeight = (weights[b.field.key] ?? 0) - (weights[a.field.key] ?? 0);
      return byWeight !== 0 ? byWeight : a.index - b.index;
    })
    .map(({ field }) => {
      const weight = weights[field.key] ?? 0;
      return {
        field,
        weight,
        tier: tierOf(weight),
        share: load > 0 ? weight / load : 0,
      };
    });
}

/** Everything not in the comparison, in catalogue order — the bin's contents. */
export function benchFields(weights: Record<string, number>): CompsField[] {
  return COMPS_FIELDS.filter((field) => !((weights[field.key] ?? 0) > 0));
}

/** The total weight the shares are taken against. */
export function boardLoad(weights: Record<string, number>): number {
  let load = 0;
  for (const field of COMPS_FIELDS) {
    const weight = weights[field.key] ?? 0;
    if (weight > 0) load += weight;
  }
  return load;
}
