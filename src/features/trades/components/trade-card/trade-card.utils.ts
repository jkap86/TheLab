import { MONTH_ABBREVIATIONS } from "../../../shared/date-range.ts";
import type { TradeBundle } from "../../exchange.ts";
import { bundleAssets } from "../../trade-metrics.ts";
import type {
  TradeAsset,
  TradeAssetCell,
  TradeMetric,
  TradeSideContext,
} from "../../trade-metrics.ts";
import type { TradeManager, TradePickAsset } from "../../types";
import type {
  TradeCardLookups,
  TradeCardPricing,
} from "./trade-card.types.ts";

/**
 * A trade card's arithmetic and wording — everything it decides that has no
 * markup in it.
 *
 * It is not where the trades vocabulary lives: what a pick is *called* stays in
 * `../../pick-display`, what a haul is *worth* in `../../trade-metrics`, and who
 * gave what in `../../exchange`, each with its own tests. What is here is the
 * part that only ever existed inline in the card's markup, where nothing could
 * reach it — the two date spellings, the line key, and the rule that decides
 * whether a track prints per-line values at all.
 *
 * Pure, and its runtime imports arrive relatively with an explicit `.ts`
 * extension, the mechanism the tests use.
 */

/**
 * The completed date, e.g. `Jul 15, 2026`. Spelled out through the shared month
 * table rather than `toLocaleDateString` so it reads the same wherever the page
 * is opened — the same rule the ADP range labels follow. An undated trade (one
 * Sleeper filed without a timestamp) says so rather than showing an epoch.
 */
export function formatTradeDate(at: number | null): string {
  if (at === null) return "date unknown";
  const d = new Date(at);
  return `${MONTH_ABBREVIATIONS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * The time of day the trade went through, e.g. `3:07 PM`, or the empty string
 * where Sleeper filed no timestamp.
 *
 * It holds the slot the scoring week used to. A week is a coarser reading of the
 * same instant the date beside it already gives — "Aug 1, 2026 · Wk 1" says
 * twice when, and says it in a unit that means nothing for most of the calendar,
 * since Sleeper files an offseason trade under no week at all. The clock time is
 * what the date was missing: trades come in flurries, and which of this
 * afternoon's five deals landed first is a question the card couldn't answer.
 *
 * Read in the **reader's own zone**, unlike the season-shaped dates elsewhere in
 * the app: `TODAY_ET` is Eastern because it decides what the NFL has played,
 * where this is a wall-clock reading of a moment for whoever is looking at it.
 * It is still spelled out by hand rather than through `toLocaleTimeString`, so
 * the digits match the date it sits beside in every locale.
 *
 * **It used to carry its own ` · ` separator and does not now**, which is worth
 * knowing before one is added back: the two facts shared a single readout on the
 * card's first interior line, so the separator had to live on the *time* — that
 * being the half that vanishes for an undated trade, and a dangling "date
 * unknown ·" is the failure it prevented. They are two elements on a plate now
 * (see `TradeInstantLedge`), parted by a gap and a change of material, so a
 * punctuation mark between them would be a third thing saying what the layout
 * already does — and the empty string is what draws no element at all.
 *
 * It is a second function rather than a branch inside {@link formatTradeDate}
 * because the two answer differently to a missing timestamp: the date says so in
 * words, and the time simply isn't there to say it twice.
 */
export function formatTradeTime(at: number | null): string {
  if (at === null) return "";
  const d = new Date(at);
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/**
 * Whose pick this originally is, as a person.
 *
 * The owner rides on the pick rather than being looked up among the sides,
 * because the pick worth naming an owner for is usually one that came from a
 * roster that *isn't* in this trade — see `TradePickAsset.user_id`. The roster
 * number stays the fallback for a team whose owner isn't cached.
 */
export function pickOwnerLabel(
  pick: TradePickAsset,
  managers: Record<string, TradeManager>,
): string {
  const name = pick.user_id ? managers[pick.user_id]?.display_name : null;
  return name || `roster ${pick.roster_id}`;
}

/**
 * React's key for one line. The index is in it because a haul can hold the same
 * asset twice — two 2027 firsts from different rosters share a season and a
 * round, and a three-way can move two of them — so nothing about an asset is
 * unique within a side.
 */
export function assetKey(asset: TradeAsset, index: number): string {
  if (asset.kind === "player") return `p${index}-${asset.id}`;
  if (asset.kind === "pick") {
    return `d${index}-${asset.pick.season}-${asset.pick.round}-${asset.pick.roster_id}`;
  }
  return `f${index}`;
}

/**
 * What a metric reads one side's haul off: the haul itself, plus the league
 * facts that decide which board prices it and where a pick falls.
 *
 * Assembled in one place so the card's parts can be handed the two bundles they
 * thread anyway rather than the seven fields underneath them, and so a field
 * added to the context is added to the card once.
 */
export function sideContext(
  pricing: TradeCardPricing,
  lookups: TradeCardLookups,
  leagueId: string,
  received: TradeBundle,
): TradeSideContext {
  return {
    received,
    ktc: pricing.ktc,
    pickKtc: pricing.pickKtc,
    superflex: pricing.superflex,
    leagueId,
    pickSlots: lookups.pickSlots,
    teams: pricing.teams,
    adp: pricing.adp,
    adpBoard: pricing.adpBoard,
    adpLadder: pricing.adpLadder,
    adpPool: pricing.adpPool,
    steepness: pricing.steepness,
  };
}

/** One line of a track: the asset, its React key, and the metric's reading of it. */
export type TradeLine = {
  asset: TradeAsset;
  key: string;
  /** Null where the metric doesn't cover this line, or where the track has one. */
  cell: TradeAssetCell | null;
};

/**
 * A haul as the lines a track draws for it.
 *
 * **Per-asset values are drawn only where there is more than one line to break
 * down**, and each track answers that question for itself. A side that took a
 * single player would otherwise print that player's price against his name and
 * the identical number as the side total a line above — the same figure twice,
 * on the most common trade there is. A breakdown of one *is* the total, so the
 * column appears exactly when it says something the total doesn't. Counted over
 * the lines the metric actually **covers** rather than over the assets, since a
 * player-and-a-pick haul is one priced line as far as KTC is concerned and a
 * FAAB line is not a line KTC has an opinion on at all.
 *
 * The metric reads this track's own haul, so a give line is priced against the
 * bundle it belongs to rather than against the side's take — which is what
 * `context` is re-based on before a single cell is read.
 */
export function trackLines(
  metric: TradeMetric,
  context: TradeSideContext,
  bundle: TradeBundle,
): TradeLine[] {
  const assets = bundleAssets(bundle);
  const read = metric.asset;
  const trackContext: TradeSideContext = { ...context, received: bundle };
  const cells = read ? assets.map((asset) => read(trackContext, asset)) : [];
  const show = cells.filter((cell) => cell !== null).length > 1;

  return assets.map((asset, i) => ({
    asset,
    key: assetKey(asset, i),
    cell: show ? (cells[i] ?? null) : null,
  }));
}
