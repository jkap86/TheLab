import { ktcPickDiscount, pickTier } from "../../shared/ktc/picks.ts";
import type { KtcPickPrice } from "../../shared/ktc/picks.ts";
import { adpValue } from "../../shared/manager/adp-value.ts";
import type { AdpBoardType, AdpPlayerPayload, TradePickAsset } from "./types";

/**
 * Pricing a traded draft pick off ADP.
 *
 * **The board of player prices has no row for a pick, and it doesn't need one:
 * a rookie pick is a *place in a queue*, and the queue is on the board
 * already.** Rank the rookies the selected drafts averaged and the first of
 * them is what the 1.01 returns, the second what the 1.02 returns, and so on —
 * so a pick is priced by the player it buys, on the same curve, in the same
 * units, out of the same population the rest of the card is read from. That is
 * what makes a pick and a player summable here where summing an ADP value and a
 * KTC price would not be: there is only one scale.
 *
 * Two things the ladder cannot answer on its own, and each is handled rather
 * than smoothed over:
 *
 * - **Which rung a pick lands on** needs the league's draft order, which exists
 *   for a minority of the picks on this board. An unplaced pick takes the middle
 *   of its round and says so, the same stand-in the KTC column makes.
 * - **What waiting costs.** The ladder prices a pick as if it were being spent
 *   now; a 2029 first will spend a class nobody can name. KTC publishes exactly
 *   that opinion, so the *ratio* between its rows carries it over — see
 *   {@link ktcPickDiscount}, and note that a ratio is dimensionless, which is
 *   why this one crossing between the two boards is sound.
 *
 * Pure and tested: every runtime import is relative with an explicit `.ts`
 * extension, and the payload shapes arrive as erased `import type`s.
 */

/** One rung: the rookie at that place in the queue, and what the board paid. */
export type RookieLadderRung = {
  /** His average draft position on the market this ladder was built for. */
  adp: number;
  /** His name, so a pick's hover can say whose price it is standing on. */
  name: string;
};

/**
 * The rookie class of the selected drafts, in the order those drafts took them —
 * which is the rookie draft's own order, and therefore the pick ladder.
 *
 * Built per market, because a rookie goes in the first round or two of a dynasty
 * startup and somewhere in the middle of a redraft: the ladders are two
 * different queues, and a league reads the one it plays in. A redraft league's
 * rookie picks come out cheap as a result, which is correct rather than a
 * shortfall — a rookie pick in a league that resets every year is worth little.
 *
 * A rookie the board has no average for is not a rung. That is not a gap to be
 * filled: the ladder is an *ordering*, so inventing a place for a player the
 * selected drafts never took would shift every pick below him by one.
 */
export function rookieLadder(
  players: readonly AdpPlayerPayload[],
  board: AdpBoardType,
): RookieLadderRung[] {
  const rungs: RookieLadderRung[] = [];
  for (const player of players) {
    if (!player.rookie) continue;
    const stats = player[board];
    if (!stats) continue;
    rungs.push({ adp: stats.adp, name: player.name });
  }
  // Ascending — earlier average, earlier rung. The name breaks a tie so the
  // ladder is a total order and two renders of one board can't disagree about
  // which of two equally-drafted rookies is the 1.04.
  return rungs.sort((a, b) =>
    a.adp !== b.adp ? a.adp - b.adp : a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/**
 * The draft this pick's league runs, where the league list hasn't answered.
 *
 * A pick's rung is `(round − 1) × teams + slot`, so the team count decides which
 * rookie a second-rounder lands on and there is no honest way to leave it out.
 * Twelve is the same assumption the value curve's own pool falls back to.
 */
export const TYPICAL_DRAFT_TEAMS = 12;

/**
 * Where in the round an unplaced pick is assumed to fall: the middle.
 *
 * The convention every trade calculator uses for a pick whose draft doesn't
 * exist yet, and the one KTC's own untiered rows already encode — so a pick
 * priced this way lands in the `mid` tier its KTC row would have been read off,
 * and the two halves of this calculation agree about which pick they mean.
 */
export function middleSlot(teams: number): number {
  return Math.ceil(teams / 2);
}

/** Which rung of the rookie ladder a pick is, 1-based. */
export function rookiePickNumber(
  round: number,
  slot: number,
  teams: number,
): number {
  return (round - 1) * teams + slot;
}

/** A pick's ADP value, and everything its hover has to be able to say. */
export type PickAdpMatch = {
  /** Draft capital, on the same curve and scale as a player's. */
  value: number;
  /** The rookie whose price it stands on. */
  player: string;
  /** Which rung that is — the pick's overall number in a rookie draft. */
  overall: number;
  /** What the future-season discount multiplied it by; 1 where none applied. */
  discount: number;
  /** The season that discount was measured against, or null where none was. */
  base: string | null;
  /**
   * False where any part of the answer is a stand-in rather than this pick's
   * own: an unset draft order, or a KTC row for a tier it doesn't publish.
   */
  exact: boolean;
  reason?: undefined;
};

/**
 * Why a pick has no number — three genuinely different answers, which is why
 * this is a reason rather than a bare null.
 *
 * A hover that says "not priced" for all three tells a reader nothing they can
 * act on, and two of these are things they *can* act on: `no-ladder` and
 * `past-ladder` are facts about the board the panel above is showing, and
 * widening it fixes them, where `no-discount` is a fact about how far out the
 * pick is and no filter will move it.
 */
export type PickAdpMiss =
  /** The selected drafts averaged no rookies at all — a board with no ladder. */
  | "no-ladder"
  /** Deeper than the rookie class that board priced. */
  | "past-ladder"
  /** KTC carries no row to discount a pick that far out by. */
  | "no-discount";

export type PickAdpResult = PickAdpMatch | { value: null; reason: PickAdpMiss };

/**
 * What a traded pick is worth on the ADP scale, or which of the three ways the
 * answer ran out.
 *
 * Each of those is an honest refusal rather than a gap to be papered over. The
 * board averaged no rookies (a historical board, or one narrowed past them). The
 * pick is deeper than the class it priced — a 5th-rounder against a board
 * carrying forty rookies has no rung, and inventing one would be pricing a pick
 * against a player nobody drafted. Or KTC has nothing to say about how far out
 * the pick is, in which case it is left blank rather than quoted at the nearest
 * draft's price: a 2032 4th is not worth what next year's 4th is, and that is
 * the one wrong answer here that would look like a working one.
 */
export function pickAdpValue({
  ladder,
  pick,
  slot,
  teams,
  pool,
  steepness,
  ktcPicks,
  superflex,
}: {
  ladder: readonly RookieLadderRung[];
  pick: Pick<TradePickAsset, "season" | "round">;
  /** The pick's place in its league's draft order, or null where unset. */
  slot: number | null;
  /** How many teams draft in that league, or null where unknown. */
  teams: number | null;
  /** The league's startable pool — what the value curve is anchored to. */
  pool: number;
  /** Halvings across that pool: the ADP panel's own slider. */
  steepness: number;
  /** KTC's pick board, for the future-season discount and nothing else. */
  ktcPicks: Readonly<Record<string, KtcPickPrice>>;
  /** Which of KTC's two boards that ratio is read on — the league's own. */
  superflex: boolean;
}): PickAdpResult {
  if (ladder.length === 0) return { value: null, reason: "no-ladder" };

  const field = teams && teams > 0 ? teams : TYPICAL_DRAFT_TEAMS;
  const placed = slot !== null && slot >= 1 && slot <= field;
  const overall = rookiePickNumber(
    pick.round,
    placed ? slot : middleSlot(field),
    field,
  );

  const rung = overall >= 1 ? ladder[overall - 1] : undefined;
  if (!rung) return { value: null, reason: "past-ladder" };

  // Null where the order isn't set, which is what makes `ktcPickPrice` prefer
  // the untiered row — the same preference the KTC column states for the same
  // pick, so the two never read different rows for one asset.
  const tier = placed ? pickTier(slot, field) : null;
  const discount = ktcPickDiscount(ktcPicks, pick, tier, superflex);
  if (!discount) return { value: null, reason: "no-discount" };

  return {
    value: Math.round(adpValue(rung.adp, pool, steepness) * discount.factor),
    player: rung.name,
    overall,
    discount: discount.factor,
    // Stated only where it changed the number, so a current-year pick's hover
    // doesn't carry a season it wasn't discounted against.
    base: discount.factor === 1 ? null : discount.base,
    exact: placed && discount.exact,
  };
}
