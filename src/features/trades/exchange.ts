import type { Trade, TradeSide } from "@/shared/trades";

/**
 * What a trade card can honestly say about who handed over what.
 *
 * A stored side holds only what a roster *received* — what it gave up is what
 * the other sides received, and storing both halves is one edit away from them
 * disagreeing (see `shared/trades/assemble`). The card lists received hauls for
 * that reason, so nothing here derives a giving half to draw.
 *
 * **One question still needs the attribution, and it can only be answered in a
 * two-sided trade.** A draft pick names its original owner, and that is worth
 * printing only when the pick did not come from the roster handing it over — so
 * the card has to know who that roster was. With two participants it is
 * arithmetic: everything one side received came from the other. With three it is
 * not knowable from what Sleeper stores — `adds` names the roster that *received*
 * a player and nothing names the one that sent them, so an asset moving in a
 * three-way could have come from either of the others. Guessing would print a
 * false claim about who dealt what, so {@link counterpartyRoster} answers null
 * there and the pick keeps its origin, which is honest at any number of sides.
 *
 * This module used to derive the whole giving half, for a narrow layout that
 * drew each side's take beside its give. That layout said everything twice — on
 * a two-sided trade every asset appeared once as a `+` and once as a `−` — which
 * is what the card was decluttered by dropping. What survives is the one part of
 * the derivation that was load-bearing rather than decorative.
 */

/** What moved to one roster in a trade. */
export type TradeBundle = {
  players: string[];
  picks: Trade["sides"][number]["picks"];
  faab: number;
};

/** One side's haul, as the metrics and the asset list read it. */
export function receivedBundle(side: TradeSide): TradeBundle {
  return { players: side.players, picks: side.picks, faab: side.faab };
}

/** Whether a side came away with nothing at all — a real case in a three-way. */
export function isEmptyBundle(b: TradeBundle): boolean {
  return b.players.length === 0 && b.picks.length === 0 && b.faab === 0;
}

/**
 * The roster that handed `side` everything it received, or null where that isn't
 * knowable — see the module note for why three sides make it unknowable rather
 * than merely awkward.
 */
export function counterpartyRoster(
  trade: Trade,
  side: TradeSide,
): number | null {
  if (trade.sides.length !== 2) return null;
  const other = trade.sides.find((s) => s.roster_id !== side.roster_id);
  return other ? other.roster_id : null;
}
