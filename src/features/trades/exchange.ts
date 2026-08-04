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
 * **The giving half is derived again, and it is bounded by the same limit.**
 * {@link givenBundle} answers only where {@link counterpartyRoster} does — with
 * two participants, where a side's give *is* the other side's take and the two
 * can't disagree because only one of them is stored. At three it declines, for
 * exactly the reason the pick origin declines: an asset that moved in a
 * three-way could have come from either of the other rosters, and a column of
 * confident `−` lines that were guessed is worse than a column that isn't there.
 *
 * That it says everything twice on a two-sided card is the point rather than an
 * oversight — the redundancy is what lets one manager's half be read on its own,
 * which is how a card in a windowed list of forty thousand is actually read. It
 * is paid for by drawing the give lines as the dimmer half of the pair, so the
 * card still reads take-first.
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

/**
 * What `side` handed over, or null where that isn't knowable — see the module
 * note.
 *
 * It is the counterparty's *received* bundle rather than a bundle assembled from
 * anything of its own, which is what keeps the two halves of a card from ever
 * disagreeing: there is one stored fact here, read from two directions.
 */
export function givenBundle(
  trade: Trade,
  side: TradeSide,
): TradeBundle | null {
  const roster = counterpartyRoster(trade, side);
  if (roster === null) return null;
  const other = trade.sides.find((s) => s.roster_id === roster);
  return other ? receivedBundle(other) : null;
}
