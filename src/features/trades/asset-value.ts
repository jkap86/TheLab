import type { TradePickAsset } from "@/shared/contract";

import type { TradeBundle } from "./exchange";

/**
 * What a trade's assets are worth, and the seam that will one day fill it in.
 *
 * The console-card redesign puts a value beside every asset on a trade card and
 * a total at the head of each side. **Nothing in this database can price one
 * yet**, and that is a known, named gap rather than an oversight:
 *
 * - `shared/ktc` scrapes and stores both markets, but `ktc_values.sleeper_id`
 *   is nullable and **never written** — the Sleeper↔KTC name matcher
 *   (TheLabX's `match.ts`/`values.ts`) is one of the deliberately unported
 *   pieces, so there is no join from a `player_id` on a trade to a KTC row.
 * - Picks need the rookie-pick board beside it (`ktc/picks.ts`, also unported).
 * - **FAAB has no KTC value and never will.** It is a league's own currency,
 *   not an asset a market prices.
 *
 * So the column renders `—` today, everywhere, and that is part of the design
 * rather than a placeholder to hide. What this module owns is the *rule* that
 * outlives the gap, and it is the one that is silent when wrong:
 *
 * **A side with nothing priced totals `—`, never `0`.** A zero there is a
 * claim — that the side received nothing of value — in exactly the sense a
 * `DEFAULT now()` is a claim about when a row was last refreshed. What is
 * summed is what could be priced; what could not is absent from the sum and
 * absent from the column, and a side that could price none of its haul has no
 * total to state.
 *
 * When the matcher lands, the map below is what the payload fills and every
 * caller above is already written against it.
 */

/** Value per asset key, in KTC's own units. See {@link assetKey}. */
export type AssetValues = Readonly<Record<string, number>>;

/**
 * The empty board: what this app can price today.
 *
 * A module constant rather than a prop threaded down through the card, because
 * threading a value that is always the same is how a seam turns into plumbing.
 * The card names it once; when the payload starts carrying real values, that
 * one reference becomes the field and nothing else moves.
 */
export const NO_ASSET_VALUES: AssetValues = {};

/**
 * The key an asset is priced under.
 *
 * A player is his Sleeper id. A pick is the identity Sleeper gives it — season,
 * round, and the roster it *originally* belongs to — because a 2026 1st is a
 * different asset depending on whose it is, and because that triple is what a
 * pick board would be keyed by.
 */
export function assetKey(asset: string | TradePickAsset): string {
  return typeof asset === "string"
    ? `p:${asset}`
    : `k:${asset.season}:${asset.round}:${asset.roster_id}`;
}

/** One asset's value, or null where nothing can price it. */
export function assetValue(
  asset: string | TradePickAsset,
  values: AssetValues,
): number | null {
  return values[assetKey(asset)] ?? null;
}

/**
 * What a side's haul is worth: the sum of what could be priced, or null where
 * none of it could.
 *
 * FAAB is not in the sum at all — see the module note. Nor is it a reason to
 * answer null: a side that received a priced player and 42 FAAB has a real
 * total, and it states what it knows.
 */
export function bundleValue(
  bundle: TradeBundle,
  values: AssetValues,
): number | null {
  let total = 0;
  let priced = false;

  for (const id of bundle.players) {
    const value = assetValue(id, values);
    if (value !== null) {
      total += value;
      priced = true;
    }
  }
  for (const pick of bundle.picks) {
    const value = assetValue(pick, values);
    if (value !== null) {
      total += value;
      priced = true;
    }
  }

  return priced ? total : null;
}

/**
 * A value as the card prints it: grouped thousands, or an em dash.
 *
 * The dash is the whole three-way grammar the rest of the app is written in,
 * applied here — a number is an answer, a dash is no answer, and the two must
 * never render the same.
 */
export function formatAssetValue(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString();
}
