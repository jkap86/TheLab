import type { TradePickAsset } from "./types";

/**
 * How a traded draft pick reads on a card — the two questions Sleeper answers
 * about one and this page used to answer neither of.
 *
 * **What it is called.** A pick is stored as a season, a round and the roster it
 * originally belongs to. Once the league has set that draft's order, the pick
 * has a *place* — 1.05 rather than "a 1st" — and that is what everyone in the
 * league calls it, because it is the difference between the pick that takes the
 * best rookie on the board and the pick that takes the fifth. Where the order
 * isn't set (most picks on this board are two or three seasons out, and the
 * draft doesn't exist yet) the round is all there is, and the ordinal is what a
 * reader says out loud. **That half lives in `features/shared/pick-value` now**
 * — the ADP board enumerates picks belonging to no trade and no roster, and has
 * to call them what these cards call them — and is re-exported below so this
 * feature's own callers keep one import.
 *
 * **Whose it is.** A pick is only worth naming an owner for when that owner is a
 * surprise. In the ordinary trade — a manager handing over their own first — the
 * origin is the person on the other side of the card, and printing "from
 * DarksideEmperors" beside a pick DarksideEmperors just gave away is a line of
 * noise on most cards that carry a pick at all. It is worth every character when
 * the pick came from somewhere else, since a third party's 1st is a different
 * asset from the dealer's own. So the origin is drawn exactly when the pick did
 * *not* originate with the roster handing it over, which is the rule Sleeper's
 * own trade view follows. That one is genuinely about a *trade*, which is why it
 * stayed.
 *
 * Pure, and its one runtime import is by relative path with an explicit
 * extension — the mechanism the tests use.
 */

export { pickLabel } from "../shared/pick-value.ts";

/**
 * The roster whose pick this originally is, or null where saying so would only
 * repeat the card.
 *
 * `giver` is the roster handing the pick over — knowable in a two-sided trade,
 * where it is simply the other side, and *not* knowable in a three-way, since
 * nothing Sleeper stores says which participant a pick came through. A null
 * `giver` therefore keeps the origin: with no one to compare against, naming the
 * original owner is the only honest thing the line can say.
 */
export function pickOriginRoster(
  pick: TradePickAsset,
  giver: number | null,
): number | null {
  return giver !== null && pick.roster_id === giver ? null : pick.roster_id;
}
