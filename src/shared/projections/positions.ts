/**
 * The fantasy-position vocabulary: which positions a lineup can be narrowed to,
 * in the order a reader scans them.
 *
 * **Derived from {@link SLOT_POSITIONS} rather than listed**, which is the same
 * argument `DEFENSIVE_SLOTS` and `IDP_SLOTS` beside it are built on: the
 * solver's table is what decides whether a position exists in this app at all,
 * so a position offered here that no slot admits would be a narrowing that can
 * never seat anybody, and one the solver knows and this file does not would be
 * a column a reader cannot ask for. The day the solver learns Sleeper's `OP`,
 * or a new IDP slot, the axis learns it too.
 *
 * The *order* is the table's own declaration order, and that is worth saying
 * out loud because it looks like a coincidence: `SLOT_POSITIONS` opens with its
 * nine single-position slots — QB, RB, WR, TE, K, DEF, DL, LB, DB — before the
 * flexes that recombine them, so walking its values and keeping first
 * appearances gives offence-by-depth then the two defensive families, which is
 * exactly how the keys are laid out on screen. A flex contributes nothing new
 * by construction; if one ever does, its positions land after the nine, which
 * is the right place for something the solver has only just learned.
 *
 * Zero runtime imports beyond its sibling, for `slots.ts`'s own reason: the
 * columns store, the picker and the ranking all read this, and two of the three
 * are client code that must not pull the projections barrel — and therefore
 * `pg` — into the bundle.
 */

import { SLOT_POSITIONS } from "./slots.ts";

/**
 * Every position some starting slot admits, first appearance first.
 *
 * `string[]` rather than the contract's `LineupPosition[]`, deliberately: this
 * is the derivation and the union is the claim about it, so the two are tied by
 * {@link isLineupPosition} and by `positions.test.ts`, which pins that they
 * name the same nine. Deriving *into* the union would be a cast asserting the
 * very thing the test exists to check.
 */
export const FANTASY_POSITIONS: readonly string[] = [
  ...new Set(Object.values(SLOT_POSITIONS).flat()),
];

/** True where a string is a position some slot admits. */
export function isFantasyPosition(value: string): boolean {
  return FANTASY_POSITIONS.includes(value);
}

/**
 * Whether a player belongs to one of the positions asked for.
 *
 * **Sleeper lists more than one position for the players this matters most
 * for**, so the test is an intersection rather than an equality on the first
 * entry — a tight end Sleeper also files at wide receiver is in a `TE`
 * narrowing and a `WR` one alike, which is the honest answer on a page that
 * seats him at either. An empty `positions` list on the player belongs to no
 * narrowing at all: the feed does not know what he is, and guessing is how a
 * roster's total quietly gains a player nobody asked for. An empty *set* is not
 * a narrowing and never reaches here — see `narrowsPositions`.
 */
export function playsPosition(
  playerPositions: readonly string[],
  positions: readonly string[],
): boolean {
  return playerPositions.some((one) => positions.includes(one));
}
