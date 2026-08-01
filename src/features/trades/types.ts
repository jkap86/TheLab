import type { LeaguematePayload, TradesPayload } from "@/shared/contract";
import type { PlayerSummary } from "@/shared/players";
import type { Trade, TradePickAsset, TradeSide } from "@/shared/trades";

/**
 * The shapes this feature renders — aliases of the wire contract and the domain
 * types behind it, never a parallel declaration, so a route that changes what it
 * sends is a type error here rather than a runtime surprise.
 */
export type TradesResult = TradesPayload;

/** A manager as a trade names them: id, display name, resolved avatar. */
export type TradeManager = LeaguematePayload;

export type { PlayerSummary, Trade, TradePickAsset, TradeSide };
