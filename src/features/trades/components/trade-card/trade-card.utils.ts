import { MONTH_ABBREVIATIONS } from "../../../shared/date-range.ts";
import {
  SIDE_SEAM_COLUMN,
  SIDE_SEAM_ROW,
} from "./trade-card.constants.ts";
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
 * Which way a side is cut off the one before it.
 *
 * The first side is cut off nothing; a side in the trailing column takes the
 * seam on its leading edge, and one that starts a row takes it along its top —
 * which is what puts a horizontal seam above the odd side of a three-way, since
 * that one spans both columns rather than sitting beside either.
 *
 * **A function rather than a ternary at the call site, because there are two call
 * sites now.** The sides grid draws it and the pre-trade rosters below draw the
 * same grid underneath, so the two have to agree about where a cut falls or the
 * card shows a seam in one row and not the other directly under it.
 */
export function sideSeam(index: number): string {
  if (index === 0) return "";
  return index % 2 === 1 ? SIDE_SEAM_COLUMN : SIDE_SEAM_ROW;
}

/**
 * Whether a side takes the whole row rather than half of it.
 *
 * True only for the odd side of an odd-sided trade — the three-way case. An
 * empty cell beside it would read as a participant who came away with nothing,
 * which is a real state the card draws in words. Paired with {@link sideSeam}
 * for the reason that one is shared.
 */
export function sideSpansRow(index: number, count: number): boolean {
  return count % 2 === 1 && index === count - 1;
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
 * A haul as the lines a track draws for it, in the order it draws them.
 *
 * **The ordering is two halves and only one of them is decided here.** Which
 * blocks a haul falls into — players, then picks, then FAAB — is
 * {@link bundleAssets}, and this reads that answer off the list it returns
 * rather than restating it. What is decided here is the order *within* a block:
 * descending by what the column beside the names says each line is worth. The
 * stored order carries no meaning to rank on — Sleeper's `adds` is a map from
 * player to roster, so what arrives is whatever it iterated — which left a
 * first-round pick sitting under two throw-ins and the best of three players
 * listed last, on a card a reader is scanning rather than reading. Ranked, the
 * top line of each block is the answer to what this side actually got.
 *
 * **An unpriced line sinks to the bottom of its own block and never out of it.**
 * A kicker the board has no number for is still a player this side received, so
 * filing him under the picks would be answering a different question; and equal
 * values keep the order they arrived in, which is `Array.prototype.sort` being
 * stable — worth stating rather than relying on silently.
 *
 * **Per-asset values are drawn only where there is more than one line to break
 * down**, and each track answers that question for itself. A side that took a
 * single player would otherwise print that player's price against his name and
 * the identical number as the side total a line above — the same figure twice,
 * on the most common trade there is. A breakdown of one *is* the total, so the
 * column appears exactly when it says something the total doesn't. Counted over
 * the lines the metric actually **covers** rather than over the assets, since a
 * player-and-a-pick haul is one priced line as far as KTC is concerned and a
 * FAAB line is not a line KTC has an opinion on at all. That rule is about the
 * *column* and not about the order, which is why the ranking runs with the cells
 * still attached and they are blanked afterwards.
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

  const ordered = rankTrack(
    assets.map((asset, i) => ({
      asset,
      // Keyed on where the asset arrived rather than on where it lands, so a
      // key stays with its own line when the reader changes the column and the
      // ranking moves underneath it.
      key: assetKey(asset, i),
      cell: cells[i] ?? null,
    })),
  );
  return show ? ordered : ordered.map((line) => ({ ...line, cell: null }));
}

/**
 * One track's lines with each block ranked by value — see {@link trackLines} for
 * why the blocks themselves are not this function's to choose.
 */
function rankTrack(lines: TradeLine[]): TradeLine[] {
  const blocks = new Map<TradeAsset["kind"], TradeLine[]>();
  for (const line of lines) {
    const block = blocks.get(line.asset.kind);
    if (block) block.push(line);
    else blocks.set(line.asset.kind, [line]);
  }
  // A `Map` iterates in insertion order, so the blocks come back out in the
  // order `bundleAssets` laid them down. That is what keeps players-before-picks
  // one decision in one place rather than a rank table here agreeing with a
  // construction order there.
  return [...blocks.values()].flatMap((block) => block.sort(byValueDesc));
}

/**
 * Descending by value, with every unpriced line below every priced one.
 *
 * Written out rather than as `b - a` because an absent value is not a number:
 * arithmetic on it would have to stand in a zero, which is a claim about the
 * line ("worth nothing") where the honest one is that this board has no opinion.
 * So the nulls are ordered against the *presence* of a value, and two of them
 * tie — which the stable sort turns back into the order they arrived in.
 */
function byValueDesc(a: TradeLine, b: TradeLine): number {
  const left = a.cell?.value ?? null;
  const right = b.cell?.value ?? null;
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}
