/**
 * Which of a market's two boards a league reads: the superflex question.
 *
 * **This is the superflex half of TheLabX's `ktc/roster`.** The rest of that
 * file prices rosters on KeepTradeCut, and it arrives with the KTC port; what
 * is here is the one predicate other concerns already need — ADP boards and
 * lineup pricing both split on it, and two spellings of "starts more than one
 * quarterback" drifting apart is the bug this file exists to prevent.
 *
 * Pure and free of runtime imports beyond the slot vocabulary. The vocabulary
 * comes in relatively with a `.ts` extension, the same mechanism
 * `projections/optimal` uses to reach the same file: Node's test runner strips
 * types but doesn't know the `@/*` aliases.
 */

import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "../projections/slots.ts";

/**
 * The slots a quarterback can start in, derived from {@link SLOT_POSITIONS} the
 * way `DEFENSIVE_SLOTS` is: a new QB-eligible flex counts the moment the solver
 * learns it. Exported because the superflex question is asked in SQL too —
 * TheLabX's `shared/manager/adp` classifies stored leagues with this same list,
 * so the predicate that groups a draft into a board population can't drift from
 * the one that picks a league's board here.
 */
export const QB_ELIGIBLE_STARTING_SLOTS: readonly string[] = Object.entries(
  SLOT_POSITIONS,
)
  .filter(
    ([slot, positions]) =>
      !NON_STARTING_SLOTS.has(slot) && positions.includes("QB"),
  )
  .map(([slot]) => slot);

/**
 * Whether a league starts more than one quarterback, which is the only question
 * a market's two boards answer differently.
 *
 * The gap between them is not a rounding difference: superflex pricing is the
 * whole reason a quarterback is a first-round asset, so reading a two-QB league
 * off the 1QB board understates every roster in it by roughly the value of its
 * starting quarterbacks. Which board priced a number therefore travels with it.
 *
 * Derived from {@link QB_ELIGIBLE_STARTING_SLOTS} rather than testing for
 * `SUPER_FLEX` by name, for the reason `DEFENSIVE_SLOTS` is derived: a new
 * QB-eligible flex counts here the moment the solver learns it, where a
 * hard-coded name would quietly price those leagues off the wrong board.
 */
export function isSuperflexLineup(
  rosterPositions: readonly string[] | null,
): boolean {
  if (!rosterPositions) return false;

  const qbSlots = rosterPositions.filter((slot) =>
    QB_ELIGIBLE_STARTING_SLOTS.includes(slot),
  );
  return qbSlots.length > 1;
}
