/**
 * The starting-slot vocabulary: which seats a column can be narrowed to, in the
 * order a reader scans them.
 *
 * The sibling of `./positions`, and it exists for that file's reason one axis
 * over: the columns store, the picker and the ranking all read this, and two of
 * the three are client code that must not pull the projections barrel — and
 * therefore `pg` — into the bundle. Zero runtime imports beyond `./slots`.
 *
 * **Exhaustive over {@link SLOT_POSITIONS} rather than derived from it**, which
 * is where this parts company with `FANTASY_POSITIONS` beside it, and the
 * difference is the *order*. That file's note says at length that the table's
 * declaration order "looks like a coincidence" and happens to give the reading
 * order it wants; here it does not — the table opens with its nine
 * single-position slots before the flexes that recombine them, so a derivation
 * would put `K` and `DEF` between `TE` and `FLEX` and the track would read as
 * three unrelated runs. So the order is written down and the *membership* is
 * pinned by `starting-slots.test.ts`, which asserts this is a permutation of
 * the table's own keys: a slot the solver learns breaks a test rather than
 * being silently unofferable, and one named here that the solver cannot fill
 * breaks it the other way.
 *
 * The three groups are how a league is actually built, which is what the two
 * milled cuts in the picker's track fall between (see `LINEUP_SLOT_GROUPS`):
 *
 * - the four bare skill seats a lineup is built from;
 * - the flexes, which recombine them — `SUPER_FLEX` last, after the three it is
 *   the widest of;
 * - the special units and the individual defenders, with `IDP_FLEX` closing
 *   them for the same reason `SUPER_FLEX` closes the group above.
 */

import { NON_STARTING_SLOTS } from "./slots.ts";

/**
 * Every startable slot, in reading order.
 *
 * `string[]` rather than the contract's `LineupSlot[]`, deliberately and on
 * `FANTASY_POSITIONS`' exact terms: this is the list and the union is the claim
 * about it, so the two are tied by {@link isStartingSlot} and by the test.
 * Typing it *as* the union would be an assertion of the very thing the test
 * exists to check.
 */
export const STARTING_SLOTS: readonly string[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "WRRB_FLEX",
  "REC_FLEX",
  "SUPER_FLEX",
  "K",
  "DEF",
  "DL",
  "LB",
  "DB",
  "IDP_FLEX",
];

/** True where a string names a slot the solver can seat somebody in. */
export function isStartingSlot(value: string): boolean {
  return STARTING_SLOTS.includes(value);
}

/**
 * The startable slots a set of leagues actually runs, in reading order.
 *
 * **The vocabulary is the leagues in hand rather than the whole table**, which
 * is the rule the position axis already lives by: a key for a seat no league
 * starts is a narrowing that could never seat anybody, so a slot absent from
 * every league is *absent* rather than greyed. A reader with no IDP league is
 * not offered `DL`.
 *
 * One walk of `roster_positions`, which is where both exclusions come from and
 * why neither is spelled twice. {@link NON_STARTING_SLOTS} — `BN`, `IR`, `TAXI`
 * — hold players without starting them; a slot the solver has no entry for
 * seats nobody (`recognisedSlots` drops the same ones into `unknown_slots`);
 * and Sleeper's own `""`/`"0"` padding is neither. Membership in
 * {@link STARTING_SLOTS} answers all three at once, since the table's keys are
 * exactly the seats that can be filled.
 *
 * A league whose lineup has never been synced contributes nothing rather than
 * an empty seat — `roster_positions` is nullable for exactly that row.
 */
export function startingSlotsOf(
  rosterPositions: readonly (readonly string[] | null)[],
): string[] {
  const seen = new Set<string>();
  for (const slots of rosterPositions) {
    for (const slot of slots ?? []) {
      if (NON_STARTING_SLOTS.has(slot)) continue;
      if (isStartingSlot(slot)) seen.add(slot);
    }
  }
  return STARTING_SLOTS.filter((slot) => seen.has(slot));
}
