import type { AdpPlayerPayload, LeaguematePayload } from "@/shared/contract";
import type { KtcValue } from "@/shared/ktc";
import type { AdpBoardStats, AdpBoardType } from "@/shared/manager";
import type { PlayerSummary } from "@/shared/players";
import type { Trade, TradePickAsset, TradeSide } from "@/shared/trades";

/**
 * The shapes this feature renders — aliases of the wire contract and the domain
 * types behind it, never a parallel declaration, so a route that changes what it
 * sends is a type error here rather than a runtime surprise.
 *
 * There is no accumulated-season type here any more. The board used to fold a
 * stream into one growing object, which had to be described somewhere; it is now
 * an infinite query, so what the page holds is React Query's own page array and
 * the fold of it lives in `hooks/use-trades` beside the query that produces it.
 */

/** A manager as a trade names them: id, display name, resolved avatar. */
export type TradeManager = LeaguematePayload;

export type {
  AdpBoardStats,
  AdpBoardType,
  AdpPlayerPayload,
  KtcValue,
  PlayerSummary,
  Trade,
  TradePickAsset,
  TradeSide,
};
