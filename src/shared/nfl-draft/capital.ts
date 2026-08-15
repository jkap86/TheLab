import type { NflDraftPick } from "./types.ts";

/**
 * Turning an NFL draft position into draft *capital* — a cardinal number a
 * comparison can measure distance in.
 *
 * This is `adp-value.ts`'s argument applied to the other draft. A pick number
 * is an *ordinal* rank, so the raw number is the wrong thing to put in a
 * distance: euclidean distance on it says pick 1 and pick 20 are as far apart
 * as pick 200 and pick 219, which is false in the only sense a reader means.
 * The first pair is a generational prospect against a late first-rounder; the
 * second is two Day 3 fliers nobody could tell apart. So the pick is put on a
 * decaying scale first, and the scale is what the KNN weighs.
 *
 * Pure and free of runtime imports beyond its own types, so it unit-tests under
 * Node's runner and the client can read it for display — the bar `adp-value`,
 * `rank` and `shares` hold.
 */

/**
 * A first-overall pick is worth this; every later pick is a fraction of it.
 *
 * The scale is arbitrary and deliberately the same shape as {@link ADP_PEAK} in
 * `adp-value.ts` — these are relative capital points, not fantasy points, and
 * ten thousand keeps them legible. It is **not** comparable to an ADP value or
 * a KTC price: those price a player *now*, this prices where he was taken. Two
 * lenses, never one blended number, which is the rule the trade card's two
 * value columns already keep.
 */
export const DRAFT_CAPITAL_PEAK = 10_000;

/**
 * How many picks it takes for capital to halve: one round.
 *
 * A player taken 32 picks after another is worth half as much — so pick 33 is
 * half of pick 1, pick 65 a quarter, and the back of the draft rounds to
 * near-nothing. One round is the unit because it is the one a reader already
 * thinks in, which makes every number this produces explicable without a chart.
 *
 * **Unlike `DEFAULT_STEEPNESS` next door, this is a chosen shape and not a
 * measured one, and the difference is worth keeping in view.** That constant
 * became 2.75 because `scripts/fit-adp-curve.ts` could score candidate curves
 * against 14,082 completed trades — every trade is a revealed near-indifference,
 * so the market itself picks the curve. There is no equivalent ledger here: no
 * one trades NFL draft slots for each other in a currency this app stores, so
 * there is nothing to fit against and a fitted-looking number would be false
 * precision. What can be said for one round is that it sits between the two
 * published extremes — the Jimmy Johnson trade chart is far steeper (~2.35
 * halvings across round one, because it prices *moving up*) and a plain linear
 * inversion is far flatter — and that it is a knob, so a reader who disagrees
 * moves it here rather than arguing with a number baked into a column.
 */
export const DRAFT_CAPITAL_HALF_LIFE = 32;

/**
 * The last pick of a modern seven-round draft, and the notch undrafted players
 * stand on.
 *
 * 262 is the largest a draft has run since it settled at seven rounds
 * (compensatory picks move the exact total a little every year), so 263 is
 * "after everybody". Every undrafted player takes that one slot, which is the
 * point: they are not spread out, they *cluster*, and clustering is what makes
 * "compare this undrafted breakout to other undrafted breakouts" a question the
 * tool can answer at all.
 *
 * The alternative — leaving them null — was considered and rejected: it would
 * make Austin Ekeler and Adam Thielen incomparable on the one dimension that
 * most obviously unites them. What it costs is that the last pick of the draft
 * and an undrafted free agent are nearly the same number, which is true.
 */
export const NFL_DRAFT_LAST_PICK = 262;
export const UNDRAFTED_SLOT = NFL_DRAFT_LAST_PICK + 1;

/**
 * The capital of a given overall pick.
 *
 * `PEAK · 2^(−(overall − 1) / halfLife)`, so pick 1 is the peak exactly and
 * every `halfLife` picks after it halves. Monotonically decreasing, rounded
 * whole. A pick at or before the first is clamped to the peak rather than
 * allowed above it — the guard is for junk, since a real overall is ≥ 1.
 */
export function pickCapital(
  overall: number,
  halfLife: number = DRAFT_CAPITAL_HALF_LIFE,
): number {
  if (!Number.isFinite(overall) || overall <= 1) return DRAFT_CAPITAL_PEAK;
  const life = halfLife > 0 ? halfLife : DRAFT_CAPITAL_HALF_LIFE;
  return Math.round(DRAFT_CAPITAL_PEAK * 2 ** (-(overall - 1) / life));
}

/**
 * A player's draft capital, or null where there is no answer.
 *
 * The three cases this exists to keep apart, and which every caller inherits:
 *
 * - **Drafted** — the capital of the pick he was taken at.
 * - **Undrafted** (`overall === null` on a stored pick) — the capital of
 *   {@link UNDRAFTED_SLOT}. A real, comparable answer, and the same one for
 *   everybody it applies to.
 * - **Unknown** (no stored pick at all) — null, which excludes the player from
 *   any comparison weighting this field rather than filing him at the bottom of
 *   the board. That is the market family's own rule: absent is unknown, never
 *   zero, and never a quiet default that would sweep every player the
 *   crosswalk has never heard of into the undrafted cluster.
 */
export function draftCapital(
  pick: NflDraftPick | null | undefined,
  halfLife: number = DRAFT_CAPITAL_HALF_LIFE,
): number | null {
  if (!pick) return null;
  return pickCapital(pick.overall ?? UNDRAFTED_SLOT, halfLife);
}

/**
 * How a pick reads on screen — `1.05`, `7.33`, or `UDFA`.
 *
 * Round-and-slot rather than the overall number, because that is how the pick
 * is spoken about everywhere else (the fantasy pick labels one module over do
 * the same for the same reason). A drafted pick with no in-round slot on file
 * falls back to naming the round alone, which is honest about what is known
 * rather than inventing a slot to complete the format.
 */
export function draftPickLabel(pick: NflDraftPick | null | undefined): string | null {
  if (!pick) return null;
  if (pick.overall === null) return "UDFA";
  if (pick.round === null) return `#${pick.overall}`;
  if (pick.slot === null) return `Rd ${pick.round}`;
  return `${pick.round}.${String(pick.slot).padStart(2, "0")}`;
}
