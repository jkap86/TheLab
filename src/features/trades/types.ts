import type {
  LeaguematePayload,
  TradesChunkMessage,
  TradesMetaMessage,
} from "@/shared/contract";
import type { PlayerSummary } from "@/shared/players";
import type { Trade, TradePickAsset, TradeSide } from "@/shared/trades";

/**
 * The shapes this feature renders — aliases of the wire contract and the domain
 * types behind it, never a parallel declaration, so a route that changes what it
 * sends is a type error here rather than a runtime surprise.
 */

/**
 * Everything the trades stream has delivered so far, which is what the page
 * renders: the season and its total off the opening `meta` message, the trades
 * and the three id maps accumulated across every `chunk` since.
 *
 * Built by subtraction from the message types rather than written out, so it
 * stays the rule above rather than an exception to it — a field added to a chunk
 * arrives here on its own, and one renamed is a type error at the merge in
 * `useTrades` instead of a map that quietly stops being filled.
 */
export type TradesResult = Omit<TradesMetaMessage, "type"> &
  Omit<TradesChunkMessage, "type">;

/** A manager as a trade names them: id, display name, resolved avatar. */
export type TradeManager = LeaguematePayload;

export type { PlayerSummary, Trade, TradePickAsset, TradeSide };
