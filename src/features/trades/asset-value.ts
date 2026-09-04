import type {
  KtcFormat,
  MetricRank,
  TradeAssetPrice,
  TradeAssetValue,
  TradePickAsset,
  TradeValueBasis,
} from "@/shared/contract";
// Relative with an explicit extension, not through `@/shared/trades` — that
// barrel reaches Postgres, and this module is read by Node's test runner, which
// resolves neither the alias nor a barrel. The key is pure and spelled once, on
// the side of the seam the route can also see.
import { assetKey } from "../../shared/trades/asset-keys.ts";

import type { TradeBundle } from "./exchange";

/**
 * What a trade's assets are worth, on whichever basis the reader has the board
 * on, and where each one stands in its own league.
 *
 * The console-card redesign put a value beside every asset on a trade card and
 * a total at the head of each side, and for a while **nothing in this database
 * could price one**: `ktc_values.sleeper_id` was nullable and never written, so
 * there was no join from a `player_id` on a trade to a KTC row, and the pick
 * rows KTC publishes were unreachable for the same reason. The Sleeper↔KTC name
 * matcher (`shared/ktc/match`) and the pick board (`shared/ktc/picks`) closed
 * both. **The value basis is what followed**: KeepTradeCut is one answer to
 * "what is this worth" and the app already holds two others — the ADP curve and
 * a rest-of-season projection — so the board offers all three and a reader picks.
 *
 * **Four rules survive from the empty version, and all four are the kind that
 * are silent when wrong:**
 *
 * - **A side with nothing priced totals `—`, never `0`.** A zero there is a
 *   claim — that the side received nothing of value — in exactly the sense a
 *   `DEFAULT now()` is a claim about when a row was last refreshed. What is
 *   summed is what could be priced; what could not is absent from the sum and
 *   absent from the column, and a side that could price none of its haul has no
 *   total to state.
 * - **FAAB has no market value on any basis and never will.** It is a league's
 *   own currency, not an asset anybody prices, so it is not in the sum and is
 *   not a reason to answer null: a side that received a priced player and 42
 *   FAAB has a real total and states what it knows.
 * - **An asset off a basis is absent rather than zero**, and it can be off one
 *   and on another — a kicker is priced for redraft and is nowhere near the
 *   dynasty board, and a draft pick has no rest-of-season projection at all
 *   because it is not a player yet.
 * - **No total is ever ranked or coloured.** A rank here says where one asset
 *   stands among its league's; a coloured total would say who won the trade,
 *   which `trade-card.tsx` rules out by name.
 *
 * The **basis** is the reader's own, board-wide and persisted
 * (`features/shared/trade-value-basis`). The **format** — which of KTC's two
 * markets — is their `auto`/`dynasty`/`redraft` choice resolved against each
 * league's own type (`@/shared/ktc/board-choice`), and both are applied here
 * rather than on the server: the payload carries every basis and both markets,
 * so a flip costs a render instead of a page-one refetch. See
 * `TradesPagePayload.assetValues` for that argument in full.
 */

/**
 * Which basis the reader has the board on, and — where that basis is
 * KeepTradeCut — which of its two markets each league resolves to.
 *
 * One argument rather than two, because every read on a card asks the same
 * pair: the basis is board-wide and the format is per league, and a call site
 * holding one without the other is a figure with no unit.
 */
export type ValueLens = { basis: TradeValueBasis; format: KtcFormat };

/**
 * Value per asset key, on every basis the board offers. An asset nothing prices
 * at all is absent; one priced on some bases and not others carries a null on
 * each it is off.
 */
export type AssetValues = Readonly<Record<string, TradeAssetValue>>;

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

/**
 * One asset's whole entry — every basis at once — or nothing where the page has
 * no price for it on any of them.
 */
export function assetEntry(
  leagueId: string,
  asset: string | TradePickAsset,
  values: AssetValues,
): TradeAssetValue | undefined {
  return values[assetKey(leagueId, asset)];
}

/**
 * One asset's figure and standing on the lens the reader is on, or null where
 * that basis does not price it.
 *
 * The KeepTradeCut arm is the only one that reads the format, because it is the
 * only basis with two markets — see {@link ValueLens}.
 */
export function assetPrice(
  leagueId: string,
  asset: string | TradePickAsset,
  values: AssetValues,
  lens: ValueLens,
): TradeAssetPrice | null {
  return basisPrice(assetEntry(leagueId, asset, values), lens);
}

/** The same reading, off an entry already in hand. */
export function basisPrice(
  entry: TradeAssetValue | undefined,
  lens: ValueLens,
): TradeAssetPrice | null {
  if (!entry) return null;
  if (lens.basis === "ktc") return entry.ktc[lens.format];
  return lens.basis === "capital" ? entry.capital : entry.ros;
}

/** One asset's figure on the lens, or null where nothing prices it. */
export function assetValue(
  leagueId: string,
  asset: string | TradePickAsset,
  values: AssetValues,
  lens: ValueLens,
): number | null {
  return assetPrice(leagueId, asset, values, lens)?.value ?? null;
}

/**
 * Where one asset stands among the priced assets of its own league, or null
 * where there is nothing to place it against.
 *
 * The rank crosses the wire and the *percentile* is taken from it here, through
 * `rankPercentile` — the same function the manager card's tiles colour by, so a
 * bar and a hue drawn from one rank on two pages cannot disagree. See
 * {@link TradeAssetPrice} for why the server ships the rank rather than the
 * percentile.
 */
export function assetRank(
  leagueId: string,
  asset: string | TradePickAsset,
  values: AssetValues,
  lens: ValueLens,
): MetricRank | null {
  return assetPrice(leagueId, asset, values, lens)?.rank ?? null;
}

/**
 * What a side's haul is worth on the given lens: the sum of what could be
 * priced, or null where none of it could. See the module note for why a null
 * rather than a zero, and why FAAB is neither.
 *
 * **A total carries no rank and is never coloured.** The colour on this board
 * is a statement about one asset's standing; a coloured total would be a
 * statement about who won the trade, which the card rules out by name.
 */
export function bundleValue(
  leagueId: string,
  bundle: TradeBundle,
  values: AssetValues,
  lens: ValueLens,
): number | null {
  let total = 0;
  let priced = false;

  for (const id of bundle.players) {
    const value = assetValue(leagueId, id, values, lens);
    if (value !== null) {
      total += value;
      priced = true;
    }
  }
  for (const pick of bundle.picks) {
    const value = assetValue(leagueId, pick, values, lens);
    if (value !== null) {
      total += value;
      priced = true;
    }
  }

  return priced ? total : null;
}

/**
 * The short name each basis prints beside a figure.
 *
 * Three figures on three scales never share a column without one — the rule the
 * manager card's lens keys already live by, and the reason the side header
 * gained a unit label when the basis did: a total that changed because the
 * reader flipped the panel would otherwise be indistinguishable from one that
 * moved because the data did.
 */
export const TRADE_BASIS_UNITS: Record<TradeValueBasis, string> = {
  capital: "CAP",
  ktc: "KTC",
  ros: "PTS",
};

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
