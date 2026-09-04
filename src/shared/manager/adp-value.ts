/**
 * Turning ADP into a roster's draft-capital value.
 *
 * ADP is an *ordinal* rank — a draft position, where lower is better — so it
 * can't be summed as it stands: a deeper roster would only pile up a larger
 * (worse) number and a stud would *lower* the total. Two moves make it
 * summable. {@link adpValue} inverts it and puts it on a cardinal scale, and
 * {@link rosterAdpValue} adds those up across a roster. The curve is the whole
 * point: the gap between pick 1 and pick 2 is worth far more than the gap
 * between pick 100 and 101, so a plain inversion (`maxPick − adp`) would
 * overvalue bench depth and undervalue the players a season is actually won
 * with.
 *
 * Pure and free of runtime imports beyond the slot vocabulary, so it unit-tests
 * without a fetch. That import reaches `projections/slots` relatively with a
 * `.ts` extension, the mechanism `matchups.ts` and `sync-admission.ts` already
 * use: Node's test runner strips types but doesn't know the `@/*` aliases.
 *
 * **This is the curve half of TheLabX's `manager/adp-value`.** The board half —
 * `adpBoardFor`, `parseAdpBoardChoices`, `boardSignature`, `ADP_VALUE_PARAMS` —
 * chooses *which crawled drafts* a roster is priced against, and it is not here
 * because nothing crawls drafts here yet. It arrives with `/api/adp` and the
 * ADP filters it parses through.
 *
 * One board question is answered here anyway, because it is not a preference:
 * {@link AdpBoard} splits rookie drafts from full ones, and
 * {@link adpEntryValue} maps the first onto the second. That is not a lens a
 * reader chooses — a rookie draft's `pick_no` and a startup's are different
 * units, so a total that pools them is wrong rather than differently weighted.
 */

import { NON_STARTING_SLOTS, SLOT_POSITIONS } from "../projections/slots.ts";

/**
 * A pick-1 player is worth this; every later pick is worth a fraction of it.
 * The scale is arbitrary — these are relative "draft capital" points, not
 * fantasy points — but ten thousand keeps the numbers legible next to the KTC
 * board they sit beside in the card's picker.
 */
export const ADP_PEAK = 10_000;

/**
 * The steepness of the value curve: the number of times value halves across a
 * league's whole *startable pool* (see {@link adpValue}). A smaller number keeps
 * depth worth more, a larger one concentrates value at the very top. It is the
 * only knob on the curve, and it is expressed in halvings-per-pool rather than
 * picks so it means the same thing in a shallow league and a deep one.
 *
 * **It is a continuous number, not a set of presets.** It was three named
 * strings (`flat`/`balanced`/`steep`) that the client re-typed into its own
 * controls with no compiler link — and this is a single scalar with an obvious
 * ordering, so a client drives it with a slider and sends the number itself.
 * The bounds live here because the *curve* owns what a sane halving count is;
 * a client reads them rather than spelling its own.
 *
 * {@link parseSteepness} still tolerates junk by clamping to the range and
 * falling back to the default — a query string is never trusted.
 */
export const STEEPNESS_RANGE = { min: 2, max: 8, step: 0.25 } as const;

/**
 * **Measured against the trade market rather than guessed.** It was 4 — a
 * reasonable-sounding number of halvings and nothing more — and TheLabX's
 * `scripts/fit-adp-curve.ts` is what replaced it with a number: every completed
 * trade is a revealed near-indifference between two hauls, so the curve that
 * makes the fewest of them look lopsided is the curve the market is using.
 * Over 14,082 two-sided player-for-player trades of the 2026 season, scored on a
 * time-held-out fifth, the median `|log(ΣA / ΣB)|` bottoms out at **2.70** —
 * rounded here to the slider's own quarter-notch, since an off-grid default is
 * one the slider snaps away from the moment it is touched.
 *
 * Three things make it a reading rather than a number off a chart:
 *
 * - **It comes from the count-asymmetric trades, which are the only ones that
 *   carry the answer.** A 1-for-1 balances under *every* curve, so the even
 *   subset simply prefers the flattest one on offer and its argmin runs to
 *   whatever floor the search has (0.25, at the widest we looked). The
 *   asymmetric subset has a genuine interior minimum with the loss rising on
 *   both sides of it — 0.344 at the old default of 4, 0.269 at 2.5, 0.265 at
 *   2.70, 0.271 at 3, 0.290 at 3.5.
 * - **It replicates.** The fit lands at 2.70 pricing players at their mean and
 *   2.65 pricing them as an expectation over their pick distribution, which are
 *   two quite different valuations of the same hauls.
 * - **The one bias we know about points the other way**, so this is a ceiling
 *   rather than a midpoint. A 3-for-1 favours the consolidating side, because
 *   roster spots are scarce and nothing in this curve prices one; to balance
 *   fewer-but-better against many-lesser you need the top of the board worth
 *   *more*, so an uncorrected fit reads some of the price of a roster spot as
 *   steepness. The true figure is at most this.
 *
 * The knob stays a knob — it is a modeling choice and a reader may want a
 * steeper board — but its default is a measurement, and re-running that script
 * is how to challenge it.
 */
export const DEFAULT_STEEPNESS = 2.75;

/**
 * Read a `steepness` query value: a number of halvings, clamped to
 * {@link STEEPNESS_RANGE}, with anything unparseable falling back to the
 * default. Clamping rather than rejecting is deliberate — an out-of-range curve
 * is a caller asking for more of something real, and the nearest curve on the
 * scale is a better answer than silently pricing every roster on the default.
 */
export function parseSteepness(value: string | null | undefined): number {
  // An empty parameter is an absent one, not zero — `Number("")` is 0, which
  // would clamp to the flattest curve on the scale rather than the default.
  const parsed = value == null || value.trim() === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STEEPNESS;
  return Math.min(STEEPNESS_RANGE.max, Math.max(STEEPNESS_RANGE.min, parsed));
}

/**
 * A league's startable pool: how many players get *started* across it — the
 * count of starting slots per team times the number of teams. Value should be
 * near zero by the edge of this pool, because everything past it is replacement
 * level, so it is what the curve is anchored to rather than raw pick count.
 *
 * {@link startingSlotCount} reuses the slot vocabulary so a new flex counts the
 * moment the solver learns it.
 */
export function startingSlotCount(
  rosterPositions: readonly string[] | null,
): number {
  if (!rosterPositions) return 0;
  return rosterPositions.filter(
    (slot) => !NON_STARTING_SLOTS.has(slot) && SLOT_POSITIONS[slot] !== undefined,
  ).length;
}

/**
 * Starting slots assumed for a league with no lineup on file — a typical
 * 1QB/2RB/2WR/TE/2FLEX/K/DEF-ish depth. Only the fallback inside
 * {@link leagueAdpPool}; named so the number isn't retyped per caller.
 */
export const TYPICAL_STARTING_SLOTS = 9;

/**
 * The startable pool a league's value curve is anchored to: teams × starting
 * slots, falling back to a typical lineup depth so a league with no slots on
 * file can't collapse the curve to a pool of zero.
 *
 * This is the one place that composition lives, so that every lens pricing a
 * roster off ADP anchors it the same way — a fallback changed in one caller and
 * not another would make two views of the same league quietly disagree.
 */
export function leagueAdpPool(
  teams: number,
  rosterPositions: readonly string[] | null,
): number {
  return teams * (startingSlotCount(rosterPositions) || TYPICAL_STARTING_SLOTS);
}

/**
 * One player's value from their average draft position, anchored to a league's
 * startable pool rather than to a fixed pick count.
 *
 * `pool` is the league-wide count of starting slots (teams × starters per team);
 * `halvings` is how many times value halves across it. So `(adp − 1) / pool` is
 * how deep into the startable pool the pick sits, and the curve is
 * `PEAK · 2^(−halvings · that)`. Anchoring to the pool is what makes a late
 * first-rounder worth the same in a 10-team and a 14-team league, and a
 * deeper-starting league (superflex, extra flex, IDP) extend value further down
 * the board — because it starts more players. Rounded whole, and monotonically
 * decreasing in ADP.
 */
export function adpValue(adp: number, pool: number, halvings: number): number {
  // ADP is an average of 1-based pick numbers, so it is always ≥ 1 in practice;
  // the guard is only so a junk value can't hand back NaN or something above the
  // peak. `pool` is floored at 1 so a league with no slots on file can't divide
  // by zero — the caller supplies a fallback pool for that case.
  if (!Number.isFinite(adp) || adp <= 1) return ADP_PEAK;
  const p = pool > 0 ? pool : 1;
  return Math.round(ADP_PEAK * 2 ** ((-halvings * (adp - 1)) / p));
}

/**
 * Which board a player's average pick was measured on.
 *
 * **A rookie draft and a full draft are two different markets, and their pick
 * numbers are not the same unit.** A rookie draft runs three to five rounds and
 * every player in it is a rookie, so its 1.01 is `pick_no` 1 — the same number a
 * startup gives the best player in the game. Pooling the two into one average
 * (which is what the board read did until they were split) priced a 1.01 at the
 * full {@link ADP_PEAK} and put an entire third round of rookies above the 60th
 * player off a startup board. So the board a number came from has to travel
 * with the number.
 *
 * Only two boards, and the split is by *what was drafted* rather than by league
 * format: a keeper league's draft is a full draft with some picks pre-spent, and
 * an inaugural dynasty's startup is a full draft too. `rookie` is exactly a
 * dynasty league's non-startup draft.
 */
export type AdpBoard = "full" | "rookie";

/** One player's average draft position, and which board measured it. */
export type AdpEntry = {
  board: AdpBoard;
  /**
   * The average `pick_no` on that board — an overall pick on `full`, a rookie
   * pick on `rookie`. {@link adpEntryValue} is the only thing that should read
   * it, because the two are not comparable until it has mapped them.
   */
  adp: number;
};

/**
 * Where a rookie draft's 1.01 sits on the overall board.
 *
 * This and {@link ROOKIE_PICK_STRIDE} are the affine map that makes a rookie
 * pick summable beside a startup pick — `overall = ANCHOR + (k − 1) · STRIDE`.
 * A map is needed at all because {@link rosterAdpValue} totals both: a dynasty
 * roster is veterans priced off full drafts and rookies priced off rookie
 * drafts, and a sum across two scales is not a number.
 *
 * **Both are chosen rather than measured** — the state
 * {@link DEFAULT_STEEPNESS} was in before `scripts/fit-adp-curve.ts` replaced
 * it with a reading, and they are spelled out here so the same thing can happen
 * to them. The anchor says a 1.01 is worth about the twelfth player off an
 * overall board, which is roughly where the dynasty market has it in 1QB and a
 * little conservative in superflex; the stride stretches a ~48-pick rookie
 * board across the ~170 overall picks that carry any value at all, so a
 * fourth-round rookie pick lands where a late flier does rather than beside a
 * startable starter.
 *
 * **The measurement is available in this data, and is what should replace
 * them.** A first-year rookie appears on *both* boards in the same season — the
 * rookie drafts of the dynasty leagues and the full drafts of the redraft ones —
 * so the players in that overlap are a two-column fit of exactly this line. It
 * wants an account holding both formats and a corpus rather than one manager's
 * leagues, which is why it is not done inline: it is `/api/adp`'s work, beside
 * the board machinery this module's head already names as missing.
 */
export const ROOKIE_TOP_OVERALL_PICK = 12;

/**
 * How many overall picks of separation one rookie pick is worth. The second
 * half of the map; see {@link ROOKIE_TOP_OVERALL_PICK} for both.
 */
export const ROOKIE_PICK_STRIDE = 3.5;

/**
 * A rookie-board pick read as an overall-board pick, so one curve prices both.
 *
 * Guarded rather than trusted, the way {@link adpValue} guards its own input: an
 * average below 1 is not a pick, and the anchor is the floor a 1.01 sits at.
 */
export function rookieOverallPick(pick: number): number {
  if (!Number.isFinite(pick) || pick <= 1) return ROOKIE_TOP_OVERALL_PICK;
  return ROOKIE_TOP_OVERALL_PICK + (pick - 1) * ROOKIE_PICK_STRIDE;
}

/**
 * One entry's draft capital, whichever board measured it.
 *
 * A rookie entry is mapped onto the overall board first and then priced by the
 * same {@link adpValue}, which is what keeps one curve — and one `pool`
 * anchoring — behind every number a roster sums.
 *
 * Note what the map is *not*: it does not scale with league size. A rookie's
 * pick number on a rookie board is his rank in the incoming class rather than a
 * depth into a board, and a class rank means the same thing in a 10- and a
 * 14-team league. League size enters exactly where it does for every other
 * player, through `pool`.
 */
export function adpEntryValue(
  entry: AdpEntry,
  pool: number,
  halvings: number,
): number {
  const pick = entry.board === "rookie" ? rookieOverallPick(entry.adp) : entry.adp;
  return adpValue(pick, pool, halvings);
}

/** One roster's ADP-derived value, whole and split across its lineup. */
export type AdpRosterValue = {
  /** Every rostered player with an ADP value, summed. */
  total: number;
  /**
   * How many of `rostered` carried an ADP value. A player taken in too few of
   * the crawled drafts to have an average, or off the board entirely, has none —
   * so a shortfall here is normal, and it is the difference between a total that
   * covers a roster and one that covers half of it.
   */
  priced: number;
  /** Distinct players held, valued or not. */
  rostered: number;
  /**
   * `total` divided into what the best lineup starts and what it doesn't. Null
   * when there is no lineup to divide it by — a league with nothing left to
   * project. The total survives that; only the split needs a lineup.
   */
  split: { starters: number; bench: number } | null;
};

/**
 * A roster's ADP value, and how much of it is in the starting lineup.
 *
 * Three rules, each load-bearing: dedup the roster (Sleeper pads unfilled slots
 * with `""` or `"0"`), skip an id with no value rather than count it as zero,
 * and take `bench` as `total − starters` so the three numbers reconcile and a
 * lineup naming someone the roster doesn't hold can't overdraw the bench.
 *
 * TheLabX's `rosterKtcValue` is deliberately the same shape under the same
 * rules; the two are parallel rather than shared because the split rules belong
 * to each lens (an ADP value is not a KTC number).
 */
export function rosterAdpValue({
  players,
  starters,
  values,
}: {
  /** Every rostered player id, reserve and taxi included. */
  players: readonly string[];
  /** The ids the best lineup starts, or null when there is no lineup to split by. */
  starters: readonly string[] | null;
  /** Player id → ADP value; ids with no value absent. */
  values: ReadonlyMap<string, number>;
}): AdpRosterValue {
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
