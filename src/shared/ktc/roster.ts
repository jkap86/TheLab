/**
 * Pricing a roster on KeepTradeCut: which of KTC's two boards a league reads,
 * and how a roster's total divides between the lineup and everything behind it.
 *
 * Pure and free of runtime imports beyond the slot vocabulary, so it can be unit
 * tested — the caller supplies the roster, the lineup and the values (see
 * `./queries`). The vocabulary comes in relatively with a `.ts` extension, the
 * same mechanism `projections/optimal` uses to reach the same file: Node's test
 * runner strips types but doesn't know the `@/*` aliases.
 */

import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "../projections/slots.ts";

/**
 * Whether a league starts more than one quarterback, which is the only question
 * KTC's two boards answer differently.
 *
 * The gap between them is not a rounding difference: superflex pricing is the
 * whole reason a quarterback is a first-round asset, so reading a two-QB league
 * off the 1QB board understates every roster in it by roughly the value of its
 * starting quarterbacks. Which board priced a number therefore travels with it.
 *
 * Derived from {@link SLOT_POSITIONS} rather than testing for `SUPER_FLEX` by
 * name, for the reason `DEFENSIVE_SLOTS` is derived: a new QB-eligible flex
 * counts here the moment the solver learns it, where a hard-coded name would
 * quietly price those leagues off the wrong board.
 */
export function isSuperflexLineup(
  rosterPositions: readonly string[] | null,
): boolean {
  if (!rosterPositions) return false;

  const qbSlots = rosterPositions.filter(
    (slot) =>
      !NON_STARTING_SLOTS.has(slot) &&
      (SLOT_POSITIONS[slot] ?? []).includes("QB"),
  );
  return qbSlots.length > 1;
}

/** One roster's KeepTradeCut value, whole and split across its lineup. */
export type KtcRosterValue = {
  /** Every rostered player KTC prices, summed on this league's board. */
  total: number;
  /**
   * How many of `rostered` carried a price. KTC's board is ~500 deep and skill
   * players only — no kickers, no defences, no IDP — so a shortfall here is
   * normal rather than a fault, and it is the difference between a total that
   * covers a roster and one that covers half of it.
   */
  priced: number;
  /** Distinct players held, priced or not. */
  rostered: number;
  /**
   * `total` divided into what the best lineup starts and what it doesn't.
   *
   * null when there is no lineup to divide it by — a league with no slots or
   * scoring on file, or a season with nothing left to project. The total survives
   * that, since pricing a roster needs no projection; only the split does.
   */
  split: { starters: number; bench: number } | null;
};

/**
 * A roster's KTC value, and how much of it is in the starting lineup.
 *
 * `bench` is `total` minus `starters` rather than a sum of its own, which is what
 * makes the three numbers reconcile: everything not in the lineup lands there,
 * IR and taxi included. That is the right home for them — a stashed rookie is
 * value this roster holds and cannot start, which is exactly what the bench half
 * means — even though the roster panel lists them under headings of their own.
 *
 * The starting half is summed by walking the *roster* and asking whether each
 * player starts, not by walking the lineup: a lineup naming someone this roster
 * doesn't hold would otherwise push `starters` past `total` and hand back a
 * negative bench, which reads as a bug rather than as the bad input it is.
 */
export function rosterKtcValue({
  players,
  starters,
  values,
}: {
  /** Every rostered player id, reserve and taxi included. */
  players: readonly string[];
  /**
   * The player ids the best lineup starts, or null when the league can't be
   * projected and there is no lineup to split by.
   */
  starters: readonly string[] | null;
  /** Player id → value on the board this league reads; unpriced ids absent. */
  values: ReadonlyMap<string, number>;
}): KtcRosterValue {
  // Sleeper pads an unfilled slot with an empty id or a literal "0", and a
  // deduplicated roster is what keeps `total` from double-counting anyone.
  const rostered = [...new Set(players.filter((id) => id && id !== "0"))];

  let total = 0;
  let priced = 0;
  for (const id of rostered) {
    const value = values.get(id);
    if (value === undefined) continue;
    total += value;
    priced++;
  }

  if (!starters) {
    return { total, priced, rostered: rostered.length, split: null };
  }

  const starting = new Set(starters.filter((id) => id && id !== "0"));
  let startersValue = 0;
  for (const id of rostered) {
    if (!starting.has(id)) continue;
    startersValue += values.get(id) ?? 0;
  }

  return {
    total,
    priced,
    rostered: rostered.length,
    split: { starters: startersValue, bench: total - startersValue },
  };
}
