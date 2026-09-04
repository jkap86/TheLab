/**
 * Which of a market's two boards a league reads, and which of its two numbers.
 *
 * The superflex predicate came first, for the concerns that already split on it
 * — ADP boards and lineup pricing both do, and two spellings of "starts more
 * than one quarterback" drifting apart is the bug this file exists to prevent.
 * {@link ktcBoardValue} joined it with the KTC columns, and is the same idea one
 * step on: having decided which board a league reads, every surface must read
 * the *number* off it the same way.
 *
 * **TheLabX's `rosterKtcValue` is deliberately not here.** It walks a roster
 * asking whether each player starts — never the lineup — because a lineup
 * naming an unheld player would otherwise push `starters` past `total` and hand
 * back a negative bench. That guard has nothing to guard against in this repo:
 * `solveLeagueLineup` builds the seats and the bench as a partition of the one
 * deduplicated roster it was given, so `lineupMetricTotals` sums a split that is
 * exact by construction. It arrives if a lineup ever reaches the totals from
 * somewhere other than the solve that produced them.
 *
 * Pure and free of runtime imports beyond the slot vocabulary. The vocabulary
 * comes in relatively with a `.ts` extension, the same mechanism
 * `projections/optimal` uses to reach the same file: Node's test runner strips
 * types but doesn't know the `@/*` aliases.
 */

import type { KtcLineupChoice } from "@/shared/contract";

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

/**
 * The price a league reads for one player: the superflex or the 1QB number, per
 * {@link isSuperflexLineup}. Null where KTC prices neither board — or where the
 * player is off the board entirely, which is what passing `undefined` through
 * means — and callers must keep that distinct from zero: being unpriced is a
 * different claim from being worth nothing, the same three-way grammar the rest
 * of the app writes its numbers in.
 *
 * One function rather than a `superflex ? sf : oneqb` per surface, so the two
 * boards are never read differently by two readers of the same row. The
 * argument is structural rather than `KtcValue` imported from `./values`,
 * which keeps this file free of runtime *and* type edges — it is deep-imported
 * by client modules that must not reach a `pg`-backed sibling.
 */
export function ktcBoardValue(
  superflex: boolean,
  value: { sf: number | null; oneqb: number | null } | undefined,
): number | null {
  if (!value) return null;
  return superflex ? value.sf : value.oneqb;
}

/**
 * Which of the two QB boards a *column* reads: the league's own answer under
 * `auto`, and the reader's where they have forced one.
 *
 * Beside {@link isSuperflexLineup} rather than beside `parseKtcLineupChoice`,
 * on `resolveKtcFormat`'s own line: parsing a choice is the reader's half and
 * lives with the control's vocabulary, while turning one into a board is the
 * league's half and belongs with the predicate it defers to. A forcing state
 * that resolved anywhere else would be a second spelling of "starts more than
 * one quarterback" — the exact drift this file exists to prevent.
 *
 * The card resolves this client-side to label a tile and the route resolves it
 * to price one, which is the reason it is pure and free of runtime imports
 * beyond the slot vocabulary: a tile reading `Dyn·SF` over a number priced at
 * 1QB is a wrong label, not a stale one.
 */
export function resolveKtcLineup(
  choice: KtcLineupChoice,
  rosterPositions: readonly string[] | null,
): boolean {
  if (choice !== "auto") return choice === "sf";
  return isSuperflexLineup(rosterPositions);
}
