import { ktcPickDiscount, pickTier } from "../../shared/ktc/picks.ts";
import type { KtcPickPrice, KtcPickTier } from "../../shared/ktc/picks.ts";
import { adpValue } from "../../shared/manager/adp-value.ts";
import { ordinal } from "./format.ts";
// Straight from the contract and the domain rather than through a feature's
// `types.ts` alias, which is what the move out of `features/trades` cost — and
// what it was for. Both are erased, so nothing runtime crosses.
import type { AdpPlayerPayload } from "@/shared/contract";
import type { AdpBoardStats, AdpBoardType } from "@/shared/manager";

/**
 * Pricing a rookie draft pick off ADP.
 *
 * **In `features/shared` because a second tool reads it.** It was written for
 * the trades board's value column and lived in `features/trades`; the ADP
 * drawer's own board now lists picks beside the players, built off this same
 * ladder, so it moved under the mover's rule and `features/trades/pick-value`
 * re-exports it for the callers that already name that path. What crossed with
 * it is only the ladder and the pick maths — nothing here has ever known what a
 * *trade* is, which is exactly why it ports.
 *
 * **The board of player prices has no row for a pick, and it doesn't need one:
 * a rookie pick is a *place in a queue*, and the queue is on the board
 * already.** Rank the rookies and the first of them is what the 1.01 returns,
 * the second what the 1.02 returns, and so on — so a pick is priced by the
 * player it buys, on the same curve, in the same units, out of the same
 * population the rest of the card is read from. That is what makes a pick and a
 * player summable here where summing an ADP value and a KTC price would not be:
 * there is only one scale.
 *
 * **But ranking and pricing are two questions, and they are asked of two
 * different boards.** That is the correction this module was rebuilt around, and
 * it is worth stating plainly because the shortcut is so nearly right:
 *
 * - *Which rookie does this pick take?* is a fact about **rookie drafts**. Their
 *   ADP is an ordering of one class against itself — "the third rookie off the
 *   board" — and nothing else.
 * - *What is that rookie worth?* is a fact about **startup drafts**, where the
 *   class is priced against the whole dynasty player pool.
 *
 * A rookie-draft ADP of 1.0 and a startup ADP of 1.0 are not the same number in
 * different clothes: the first says "first rookie taken", the second says "first
 * asset in the game". Feeding a rookie-draft ADP into the value curve therefore
 * prices the 1.01 as the most valuable asset in dynasty football, which it very
 * nearly never is. The old ladder did exactly that whenever the ADP panel was
 * switched to rookie drafts, because it read whichever board was on screen. So
 * the two boards are fetched explicitly (see `startupPricingBoard` and
 * `rookieOrderingBoard` in `features/shared/adp-controls`) and this module takes
 * both: `ordering` decides the rungs, `pricing` decides what a rung is worth.
 *
 * Three things the ladder cannot answer on its own, and each is handled rather
 * than smoothed over:
 *
 * - **Which rung a pick lands on** needs the league's draft order, which exists
 *   for a minority of the picks on this board. An unplaced pick takes the middle
 *   of its round and says so.
 * - **What a rookie the startup market hasn't priced is worth.** He keeps his
 *   rung either way — deleting him would shift every pick below him by one, the
 *   one error here that propagates — and his price is interpolated between the
 *   rookies around him. See {@link RookieLadderRung.startupSource}.
 * - **What waiting costs.** The ladder prices a pick as if it were being spent
 *   now; a 2029 first will spend a class nobody can name. KTC publishes exactly
 *   that opinion, so the *ratio* between two of its rows carries it over — see
 *   {@link ktcPickDiscount}, and note that a ratio is dimensionless, which is
 *   why this one crossing between the two boards is sound.
 *
 * Each of those is an assumption, and each is reported as its own flag rather
 * than folded into one "estimated" boolean — see {@link PickAdpMatch}.
 *
 * Pure and tested: every runtime import is relative with an explicit `.ts`
 * extension, and the payload shapes arrive as erased `import type`s.
 */

/** How a rung's startup price was arrived at — see {@link RookieLadderRung}. */
export type StartupAdpSource =
  /** The startup board averaged this rookie itself. */
  | "observed"
  /** Estimated between the nearest rookies above and below him on the ladder. */
  | "interpolated"
  /** Estimated from the one neighbouring rookie there is — he is at an end. */
  | "nearest"
  /** No rookie on this ladder has a startup price; there is nothing to stand on. */
  | "none";

/** One rung: the rookie at that place in the queue, and what he is worth. */
export type RookieLadderRung = {
  player_id: string;
  /** His name, so a pick's hover can say whose price it is standing on. */
  name: string;
  /**
   * His average in the **rookie** drafts — what put him on this rung, and not a
   * value. It is an ordering within one class, so it is never fed to the curve.
   */
  rookieAdp: number;
  /** How many of those drafts took him — the sample the ordering rests on. */
  rookiePicks: number;
  /**
   * His average in the **startup** drafts — the number the value curve reads,
   * because it prices him against the whole player pool rather than against his
   * own class. Null only where nothing on the ladder could be found to estimate
   * from, which is a board with no startup prices at all.
   */
  startupAdp: number | null;
  /** Where {@link startupAdp} came from; anything but `observed` is a guess. */
  startupSource: StartupAdpSource;
  /**
   * Drafts behind an *observed* startup average, null where it was estimated.
   *
   * Carried because the ladder is the part of this board most sensitive to the
   * sample gate (`min_picks`): a rookie two drafts short of an average is a hole
   * to be interpolated across rather than a player to be dropped. The number is
   * how a caller can tell a thinly-sampled price from a well-supported one
   * without the gate being lowered for everyone — see the note on
   * {@link rookieLadder}.
   */
  startupPicks: number | null;
};

/**
 * The rookie class in the order the rookie drafts took them — which is the
 * rookie draft's own order, and therefore the pick ladder — each rung carrying
 * what the startup market pays for that player.
 *
 * `ordering` is the short-draft board (rookie drafts) and `pricing` is the
 * long-draft board (startups). They are different fetches of `/api/adp` with the
 * same season, window, format and size, differing only in the round bounds, so
 * the two describe the same market read two ways.
 *
 * Built per league-type market, because a rookie goes in the first round or two
 * of a dynasty startup and somewhere in the middle of a redraft: the ladders are
 * two different queues, and a league reads the one it plays in. A redraft
 * league's rookie picks come out cheap as a result, which is correct rather than
 * a shortfall — a rookie pick in a league that resets every year is worth little.
 *
 * **A rookie the *ordering* board never averaged is not a rung**, because the
 * ladder is an ordering and inventing a place for a player those drafts never
 * took would shift every pick below him by one. **A rookie the *pricing* board
 * never averaged keeps his rung**, for exactly the same reason read the other
 * way: dropping him renumbers everyone below, so the 1.03 would quietly become
 * the fourth-best rookie. That asymmetry is the whole point of splitting the two
 * boards, and it is why the sample gate is left where it is rather than lowered
 * to fill the ladder — a missing startup price is a hole to interpolate across,
 * not a reason to accept a one-draft average as consensus.
 */
export function rookieLadder(
  ordering: readonly AdpPlayerPayload[],
  pricing: readonly AdpPlayerPayload[],
  board: AdpBoardType,
): RookieLadderRung[] {
  const startup = new Map<string, AdpBoardStats>();
  for (const player of pricing) {
    const stats = player[board];
    // A non-finite average is a broken row, not a price: it would reach the
    // curve as NaN and take the whole haul's total with it.
    if (stats && Number.isFinite(stats.adp)) startup.set(player.player_id, stats);
  }

  const ranked: {
    player_id: string;
    name: string;
    rookieAdp: number;
    rookiePicks: number;
  }[] = [];
  for (const player of ordering) {
    if (!player.rookie) continue;
    const stats = player[board];
    if (!stats || !Number.isFinite(stats.adp)) continue;
    ranked.push({
      player_id: player.player_id,
      name: player.name,
      rookieAdp: stats.adp,
      rookiePicks: stats.picks,
    });
  }

  // Ascending — earlier average, earlier rung. The name and then the id break a
  // tie so the ladder is a *total* order: two renders of one board can't
  // disagree about which of two equally-drafted rookies is the 1.04, which is
  // what "deterministic" means for a column read down a list of 40,000 cards.
  ranked.sort(
    (a, b) =>
      a.rookieAdp - b.rookieAdp ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.player_id < b.player_id ? -1 : a.player_id > b.player_id ? 1 : 0),
  );

  // A board answers a player once, but this is two joined payloads and the cost
  // of a repeat is a rung nobody can see, so it is dropped here rather than
  // trusted upstream. Sorted first, so the surviving copy is the better average.
  const seen = new Set<string>();
  const rungs = ranked.filter((rung) => {
    if (seen.has(rung.player_id)) return false;
    seen.add(rung.player_id);
    return true;
  });

  return withStartupAdp(rungs, startup);
}

/** The startup average for each rung, estimated where the board has none. */
function withStartupAdp(
  rungs: readonly {
    player_id: string;
    name: string;
    rookieAdp: number;
    rookiePicks: number;
  }[],
  startup: ReadonlyMap<string, AdpBoardStats>,
): RookieLadderRung[] {
  const observed = rungs.map((rung) => startup.get(rung.player_id) ?? null);

  // The nearest priced rung on each side, by *rank* rather than by ADP: the
  // ladder is a queue, so "between the rookies either side of him" is a
  // statement about places in it. Two sweeps rather than a search per hole, so a
  // ladder of a few hundred rookies stays linear — and they carry the value
  // beside the index, so nothing below has to assert that a lookup found one.
  type Neighbour = { index: number; adp: number };
  const before: (Neighbour | null)[] = [];
  let last: Neighbour | null = null;
  for (let i = 0; i < rungs.length; i++) {
    before.push(last);
    const own = observed[i];
    if (own) last = { index: i, adp: own.adp };
  }
  const after: (Neighbour | null)[] = new Array(rungs.length).fill(null);
  let next: Neighbour | null = null;
  for (let i = rungs.length - 1; i >= 0; i--) {
    after[i] = next;
    const own = observed[i];
    if (own) next = { index: i, adp: own.adp };
  }

  return rungs.map((rung, i): RookieLadderRung => {
    const own = observed[i];
    if (own) {
      return {
        ...rung,
        startupAdp: own.adp,
        startupSource: "observed",
        startupPicks: own.picks,
      };
    }

    const lower = before[i];
    const upper = after[i];
    if (lower && upper) {
      // Linear between the two neighbours, in rank space. Interpolating the
      // *ADP* and then converting is deliberate: the curve is exponential, so
      // averaging two values off it would land somewhere the board never
      // suggested, where averaging two draft positions is a statement about
      // where this rookie goes.
      const share = (i - lower.index) / (upper.index - lower.index);
      return {
        ...rung,
        startupAdp:
          Math.round((lower.adp + (upper.adp - lower.adp) * share) * 100) / 100,
        startupSource: "interpolated",
        startupPicks: null,
      };
    }

    const only = lower ?? upper;
    if (only) {
      // One side only — a rookie above the first priced one or below the last.
      // The neighbour's own average, unadjusted: nudging it would be inventing
      // a gap the board never measured, and the flag says it is a stand-in.
      return {
        ...rung,
        startupAdp: only.adp,
        startupSource: "nearest",
        startupPicks: null,
      };
    }

    return { ...rung, startupAdp: null, startupSource: "none", startupPicks: null };
  });
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

/**
 * What to call this pick: `2026 1.05` where its draft slot is known, `2026 1st`
 * where it isn't.
 *
 * The slot is zero-padded to two digits so a column of picks lines up and so
 * `1.05` reads as a slot rather than as a decimal — the spelling every fantasy
 * league uses. A league of more than 99 teams would overflow it, and would have
 * bigger problems.
 *
 * It arrived here with the trades board's `pick-display`, whose other rule —
 * whether a pick's origin is worth printing — is genuinely about a *trade* and
 * stayed there. This half is not: the ADP board enumerates picks that belong to
 * no trade and no roster, and it has to call them what the cards call them.
 */
export function pickLabel(
  pick: { season: string; round: number },
  slot: number | null,
): string {
  if (slot === null) return `${pick.season} ${ordinal(pick.round)}`;
  return `${pick.season} ${pick.round}.${String(slot).padStart(2, "0")}`;
}

/** Which rung of the rookie ladder a pick is, 1-based. */
export function rookiePickNumber(
  round: number,
  slot: number,
  teams: number,
): number {
  return (round - 1) * teams + slot;
}

/**
 * Where a pick stands **before** the curve: the rung it reads and what waiting
 * costs, with no `pool` or `steepness` anywhere in it.
 *
 * The split exists because the two readers want the curve applied at different
 * moments. A trade card is handed one pool and one steepness and wants a number,
 * so {@link pickAdpValue} finishes the job. The ADP drawer lists picks beside the
 * players on a board the reader is *dragging the curve of*: the ADP a pick sorts
 * on must not move with the slider — steepness reorders nothing, which is the
 * whole reason `adpListIdentity` leaves it out — while the value beside it must
 * move on every notch. So that caller keeps the stand and prices it in the cell,
 * exactly as a player row does with its own average.
 *
 * One composition either way. Two spellings of "which rung, and what discount"
 * is precisely the drift that put the ordering and the pricing on the same board
 * once already.
 */
export type PickAdpStand = {
  /** The rookie whose price it stands on. */
  player: string;
  player_id: string;
  /** Which rung that is — the pick's overall number in a rookie draft. */
  overall: number;
  /** Where the rookie drafts took him: the ordering that picked this rung. */
  rookieAdp: number;
  /**
   * The startup average the curve actually read — never {@link rookieAdp}.
   *
   * The two names are the ladder's two boards, and a caller that hands one board
   * to both slots gets one number twice. That is not a degenerate case: the ADP
   * drawer does exactly that on purpose, because there the display *is* the
   * question being asked (see `features/shared/adp-picks`). The distinction the
   * names draw still holds for the caller that keeps them apart, which is the
   * one it was written for.
   */
  startupAdp: number;
  /** How that average was arrived at; anything but `observed` is a guess. */
  startupSource: StartupAdpSource;
  /** What the future-season discount multiplied it by; 1 where none applied. */
  discount: number;
  /** The season that discount was measured against, or null where none was. */
  base: string | null;
  /** Which KTC row both ends of that ratio read; null for the untiered one. */
  discountTier: KtcPickTier | null;
  /**
   * Three assumptions, three flags — never one boolean.
   *
   * They were one, and the single flag was read out to the reader as "(draft
   * order not set)", so a pick whose slot was known perfectly well but whose
   * KTC row had to fall back was reported as an unplaced pick. They are
   * unrelated facts about unrelated parts of the calculation, and only the
   * reader can judge which of them matters: the first is fixed by the league
   * setting its draft order, the second by widening the ADP board, and the
   * third by nothing at all.
   */
  /** The league's draft order isn't set, so the middle of the round stood in. */
  slotEstimated: boolean;
  /** The startup board had no average for this rookie — see `startupSource`. */
  startupAdpEstimated: boolean;
  /** KTC priced the pair on a broader row than this pick's own third. */
  discountEstimated: boolean;
  reason?: undefined;
};

/** A pick's ADP value, and everything its hover has to be able to say. */
export type PickAdpMatch = PickAdpStand & {
  /** Draft capital, on the same curve and scale as a player's. */
  value: number;
};

/**
 * Why a pick has no number — five genuinely different answers, which is why this
 * is a reason rather than a bare null.
 *
 * A hover that says "not priced" for all of them tells a reader nothing they can
 * act on, and three of these are things they *can* act on: `no-ladder`,
 * `past-ladder` and `no-startup` are facts about the boards the panel above
 * describes, and widening them fixes them, where `no-discount` is a fact about
 * how far out the pick is and no filter will move it.
 */
export type PickAdpMiss =
  /** The rookie-draft board averaged no rookies at all — no ladder to read. */
  | "no-ladder"
  /** Deeper than the rookie class that board priced. */
  | "past-ladder"
  /** The startup board priced no rookie on the ladder, so no rung has a value. */
  | "no-startup"
  /** KTC carries no like-for-like pair to discount a pick that far out by. */
  | "no-discount"
  /** The pick itself doesn't describe a draft slot — see {@link pickAdpValue}. */
  | "bad-pick";

export type PickAdpResult = PickAdpMatch | { value: null; reason: PickAdpMiss };

/** {@link pickAdpStand}'s answer: a stand, or why there isn't one. */
export type PickAdpStandResult =
  | PickAdpStand
  | { player?: undefined; reason: PickAdpMiss };

/**
 * Which rung a pick reads and what waiting costs it, or which of the five ways
 * the answer ran out — everything {@link pickAdpValue} does except the curve.
 *
 * Each of those is an honest refusal rather than a gap to be papered over. The
 * rookie board averaged no rookies (a historical board, whose class the players
 * cache can no longer name — see `getRookiePlayerIds` — or one narrowed past
 * them). The pick is deeper than the class it priced — a 5th-rounder against a
 * board carrying forty rookies has no rung, and inventing one would be pricing a
 * pick against a player nobody drafted. The startup board priced nobody, so
 * there is no scale to read the rung on. Or KTC has nothing like-for-like to say
 * about how far out the pick is, in which case it is left blank rather than
 * quoted at the nearest draft's price: a 2032 4th is not worth what next year's
 * 4th is, and that is the one wrong answer here that would look like a working
 * one.
 *
 * Everything it is handed is treated as data that may be junk — a league with no
 * teams, a round of zero, a slot past the field — because all of it comes off
 * Sleeper's loosely-typed blobs. A malformed pick returns `bad-pick` rather than
 * a number computed from nonsense; nothing here can hand back NaN, Infinity or a
 * negative.
 */
export function pickAdpStand({
  ladder,
  pick,
  slot,
  teams,
  ktcPicks,
  superflex,
  ladderSeason = null,
}: {
  ladder: readonly RookieLadderRung[];
  /**
   * Which pick, structurally — a season and a round. It used to be
   * `Pick<TradePickAsset, …>`, which was the same two fields wearing a name from
   * the one feature that happened to read this first; spelled out, the ADP
   * drawer's own enumerated picks satisfy it without inventing a trade.
   */
  pick: { season: string; round: number };
  /** The pick's place in its league's draft order, or null where unset. */
  slot: number | null;
  /** How many teams draft in that league, or null where unknown. */
  teams: number | null;
  /** KTC's pick board, for the future-season discount and nothing else. */
  ktcPicks: Readonly<Record<string, KtcPickPrice>>;
  /** Which of KTC's two boards that ratio is read on — the league's own. */
  superflex: boolean;
  /**
   * The season the ladder's own class is drafted in, where the caller knows it.
   *
   * A pick at or before it is being spent **now** — the ladder *is* that class —
   * so there is nothing to discount it by and KTC is not asked. Normally that is
   * also what {@link ktcPickDiscount} answers, since its anchor is the nearest
   * season KTC still prices; the case this covers is the one where it cannot,
   * an empty or unparseable board, where every pick would otherwise refuse as
   * `no-discount`. A current-year pick needs nothing from KTC and must not
   * disappear with it.
   *
   * Omitted where the caller has no such claim to make — the trades board reads
   * picks from leagues rather than enumerating a class — and then every pick
   * goes through the board as before.
   */
  ladderSeason?: string | null;
}): PickAdpStandResult {
  if (ladder.length === 0) return { reason: "no-ladder" };
  // A round is a small positive integer or it is not a pick. Sleeper has never
  // sent otherwise; the guard is here because `(round − 1) × teams` turns a zero
  // into a rung *before* the first one, which would silently read as "past the
  // ladder" — a different and misleading answer.
  if (!Number.isInteger(pick.round) || pick.round < 1) {
    return { reason: "bad-pick" };
  }

  const field =
    teams !== null && Number.isInteger(teams) && teams > 0
      ? teams
      : TYPICAL_DRAFT_TEAMS;
  // The slot rather than a flag, so nothing below has to re-assert what this
  // line already checked — a placed pick *is* a slot, and an unplaced one is
  // null whether the order was unset or the value was junk.
  const placed =
    slot !== null && Number.isInteger(slot) && slot >= 1 && slot <= field
      ? slot
      : null;
  const overall = rookiePickNumber(
    pick.round,
    placed ?? middleSlot(field),
    field,
  );

  const rung = overall >= 1 ? ladder[overall - 1] : undefined;
  if (!rung) return { reason: "past-ladder" };
  // A rung with no startup price at all only happens when *nothing* on the
  // ladder has one — a single priced rookie is enough for every other rung to
  // stand on. So this is a board-wide gap, not a player-shaped one.
  if (rung.startupAdp === null) return { reason: "no-startup" };

  // Null where the order isn't set, which is what makes the discount prefer the
  // untiered row — the same preference the KTC column states for the same pick,
  // so the two never read different rows for one asset.
  const tier = placed === null ? null : pickTier(placed, field);
  // Seasons are four-digit years, so a string compare is the numeric one.
  const discount =
    ladderSeason !== null && pick.season <= ladderSeason
      ? { factor: 1, base: ladderSeason, tier, exact: true }
      : ktcPickDiscount(ktcPicks, pick, tier, superflex);
  if (!discount) return { reason: "no-discount" };

  return {
    player: rung.name,
    player_id: rung.player_id,
    overall,
    rookieAdp: rung.rookieAdp,
    startupAdp: rung.startupAdp,
    startupSource: rung.startupSource,
    discount: discount.factor,
    // Stated only where it changed the number, so a current-year pick's hover
    // doesn't carry a season it wasn't discounted against.
    base: discount.factor === 1 ? null : discount.base,
    discountTier: discount.tier,
    slotEstimated: placed === null,
    startupAdpEstimated: rung.startupSource !== "observed",
    discountEstimated: !discount.exact,
  };
}

/**
 * What a traded pick is worth on the ADP scale: {@link pickAdpStand} put through
 * the value curve, or the same five refusals.
 *
 * The curve is the only thing this adds, and it is applied to the **startup**
 * average rather than the rookie-draft one — the line the whole module exists to
 * draw, and one character from being wrong.
 */
export function pickAdpValue({
  pool,
  steepness,
  ...stand
}: Parameters<typeof pickAdpStand>[0] & {
  /** The league's startable pool — what the value curve is anchored to. */
  pool: number;
  /** Halvings across that pool: the ADP panel's own slider. */
  steepness: number;
}): PickAdpResult {
  const read = pickAdpStand(stand);
  if (read.player === undefined) return { value: null, reason: read.reason };
  return {
    ...read,
    value: Math.round(adpValue(read.startupAdp, pool, steepness) * read.discount),
  };
}

/** Whether any part of a priced pick rests on a stand-in rather than its own. */
export function pickEstimated(match: PickAdpMatch): boolean {
  return (
    match.slotEstimated || match.startupAdpEstimated || match.discountEstimated
  );
}
