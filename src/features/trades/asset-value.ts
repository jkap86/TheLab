import type { KtcFormat, TradePickAsset } from "@/shared/contract";
// Relative with an explicit extension, not through `@/shared/trades` — that
// barrel reaches Postgres, and this module is read by Node's test runner, which
// resolves neither the alias nor a barrel. The key is pure and spelled once, on
// the side of the seam the route can also see.
import { assetKey } from "../../shared/trades/asset-keys.ts";

import type { TradeBundle } from "./exchange";

/**
 * What a trade's assets are worth, and how the two markets behind that number
 * are read.
 *
 * The console-card redesign put a value beside every asset on a trade card and
 * a total at the head of each side, and for a while **nothing in this database
 * could price one**: `ktc_values.sleeper_id` was nullable and never written, so
 * there was no join from a `player_id` on a trade to a KTC row, and the pick
 * rows KTC publishes were unreachable for the same reason. The Sleeper↔KTC name
 * matcher (`shared/ktc/match`) and the pick board (`shared/ktc/picks`) closed
 * both, and this module is what the route fills.
 *
 * **Three rules survive from the empty version, and all three are the kind that
 * are silent when wrong:**
 *
 * - **A side with nothing priced totals `—`, never `0`.** A zero there is a
 *   claim — that the side received nothing of value — in exactly the sense a
 *   `DEFAULT now()` is a claim about when a row was last refreshed. What is
 *   summed is what could be priced; what could not is absent from the sum and
 *   absent from the column, and a side that could price none of its haul has no
 *   total to state.
 * - **FAAB has no market value and never will.** It is a league's own currency,
 *   not an asset anybody prices, so it is not in the sum and is not a reason to
 *   answer null: a side that received a priced player and 42 FAAB has a real
 *   total and states what it knows.
 * - **An asset off the board is absent rather than zero**, and it can be off one
 *   market while being on the other — a kicker is priced for redraft and is
 *   nowhere near the dynasty board.
 *
 * The **format** is the reader's `auto`/`dynasty`/`redraft` choice resolved
 * against each league's own type (`@/shared/ktc/board-choice`), and it is
 * applied here rather than on the server: the payload carries both markets so a
 * flip costs a render instead of a page-one refetch. See `TradesPagePayload`
 * for that argument in full.
 */

/**
 * Value per asset key on both markets. An asset KTC cannot price at all is
 * absent; one it prices on a single market carries a null on the other side.
 */
export type AssetValues = Readonly<
  Record<string, { dynasty: number | null; redraft: number | null }>
>;

/**
 * The empty board: what a page renders before its first response lands, and
 * what a failed KTC read degrades to.
 *
 * A module constant rather than a literal per call site, so the "nothing is
 * priced" state is one reference and reads the same everywhere.
 */
export const NO_ASSET_VALUES: AssetValues = {};

// Re-exported so a caller of this module has one import for "what is an asset
// worth" — the key it is stored under included. It is *declared* in
// `shared/trades/asset-keys`, because the route writes these keys and `shared/`
// cannot import from `features/`.
export { assetKey };

/** One asset's value on the given market, or null where nothing prices it. */
export function assetValue(
  leagueId: string,
  asset: string | TradePickAsset,
  values: AssetValues,
  format: KtcFormat,
): number | null {
  return values[assetKey(leagueId, asset)]?.[format] ?? null;
}

/**
 * What a side's haul is worth on the given market: the sum of what could be
 * priced, or null where none of it could. See the module note for why a null
 * rather than a zero, and why FAAB is neither.
 */
export function bundleValue(
  leagueId: string,
  bundle: TradeBundle,
  values: AssetValues,
  format: KtcFormat,
): number | null {
  let total = 0;
  let priced = false;

  for (const id of bundle.players) {
    const value = assetValue(leagueId, id, values, format);
    if (value !== null) {
      total += value;
      priced = true;
    }
  }
  for (const pick of bundle.picks) {
    const value = assetValue(leagueId, pick, values, format);
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
