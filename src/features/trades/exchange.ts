import type { Trade, TradePickAsset } from "@/shared/trades";

/**
 * Reading a trade as a give-and-take rather than as a list of sides.
 *
 * A stored side holds only what a roster *received* — what it gave up is what
 * the other sides received, and storing both halves is one edit away from them
 * disagreeing (see `shared/trades/assemble`). That is still the rule; this is
 * the read side of it, deriving the giving half where it can be derived at all.
 *
 * **It can only be derived in a two-sided trade.** With two participants, what
 * one gave is exactly what the other took, so the attribution is arithmetic.
 * With three, it is not knowable from what Sleeper stores: `adds` names the
 * roster that received a player and nothing names the one that sent them, so a
 * player moving in a three-way could have come from either of the other two.
 * Guessing would print a false claim about who dealt whom, so `given` is null
 * there and the card falls back to naming what each side received — the framing
 * that is honest at any number of participants.
 */

/** What moved to (or from) one roster in a trade. */
export type TradeBundle = {
  players: string[];
  picks: TradePickAsset[];
  faab: number;
};

export type SideExchange = {
  roster_id: number;
  user_id: string | null;
  received: TradeBundle;
  /** Null where the trade has anything but two sides — see the module note. */
  given: TradeBundle | null;
};

export function tradeExchange(trade: Trade): SideExchange[] {
  const paired = trade.sides.length === 2;
  return trade.sides.map((side, index) => ({
    roster_id: side.roster_id,
    user_id: side.user_id,
    received: { players: side.players, picks: side.picks, faab: side.faab },
    given: paired ? bundle(trade.sides[index === 0 ? 1 : 0]) : null,
  }));
}

/** Whether a side came away with (or parted with) nothing at all. */
export function isEmptyBundle(b: TradeBundle): boolean {
  return b.players.length === 0 && b.picks.length === 0 && b.faab === 0;
}

/** True where every side's giving half is known, so both columns can be drawn. */
export function isPairedExchange(exchange: SideExchange[]): boolean {
  return exchange.every((e) => e.given !== null);
}

function bundle(side: Trade["sides"][number]): TradeBundle {
  return { players: side.players, picks: side.picks, faab: side.faab };
}
