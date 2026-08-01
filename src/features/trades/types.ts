import type {
  LeaguematePayload,
  TradesChunkMessage,
  TradesMetaMessage,
  TradesNamesMessage,
} from "@/shared/contract";
import type { KtcValue } from "@/shared/ktc";
import type { PlayerSummary } from "@/shared/players";
import type { Trade, TradePickAsset, TradeSide } from "@/shared/trades";

/**
 * The shapes this feature renders — aliases of the wire contract and the domain
 * types behind it, never a parallel declaration, so a route that changes what it
 * sends is a type error here rather than a runtime surprise.
 */

/**
 * Everything the trades stream has delivered so far, which is what the page
 * renders: the season off the opening `meta` message, the trades accumulated
 * across every `chunk`, the four id maps merged across every `names`, and the
 * total whenever its own query answered.
 *
 * Built by subtraction from the message types rather than written out, so it
 * stays the rule above rather than an exception to it — a field added to a chunk
 * arrives here on its own, and one renamed is a type error at the merge in
 * `../stream` instead of a map that quietly stops being filled.
 *
 * **`total` is nullable and the other fields are not**, which is the protocol
 * showing through in the one place it should. The trades and their names arrive
 * as the walk produces them; the total is a separate query that lands when it
 * lands, and possibly never — it is a denominator for a progress line, so a
 * reader whose count query failed sees a season loading without a percentage
 * rather than a page that could not be drawn.
 */
export type TradesResult = Omit<TradesMetaMessage, "type"> &
  Omit<TradesChunkMessage, "type"> &
  Omit<TradesNamesMessage, "type"> & { total: number | null };

/** A manager as a trade names them: id, display name, resolved avatar. */
export type TradeManager = LeaguematePayload;

export type { KtcValue, PlayerSummary, Trade, TradePickAsset, TradeSide };
