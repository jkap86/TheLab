// The trades board's server half: the population SQL, the reads over it, and
// the sync hook that keeps `trade_participants` in step.
//
// **Server-only** — it reaches Postgres. A client module wants the payload
// types from `@/shared/contract`, and the two pure modules it genuinely shares
// with this folder are deep-imported the way `@/shared/ktc/roster` is:
// `@/shared/trades/pick-slots` for the slot keys a page is read by.

export { assetKey } from "./asset-keys";
export { assembleTrade } from "./assemble";
export type { TradeRow } from "./assemble";
export { BoundedCache, cachedLookup } from "./cache";
export { clearTradeCircleCache, resolveTradeCircle } from "./circle";
export type { TradeCircleScope } from "./circle";
export { decodeTradeCursor, encodeTradeCursor } from "./cursor";
export type { TradeCursor } from "./cursor";
export {
  clearTradeEnrichmentCaches,
  lookupKtcMarkets,
  lookupLeagueMarkets,
  lookupPlayers,
} from "./enrich";
export { collectEnrichmentIds } from "./enrich-ids";
export { readTradeFacets } from "./facets";
export {
  DEFAULT_TRADE_PAGE_SIZE,
  MAX_TRADE_PAGE_SIZE,
  MAX_TRADE_SIDES,
  facetsQuery,
  hasTradeNarrowing,
  isUnnarrowed,
  leagueScopeQuery,
  parseTradeQuery,
} from "./params";
export type {
  TradeCircle,
  TradeMatchMode,
  TradeQuery,
  TradeSideQuery,
} from "./params";
export { rebuildTradeParticipants } from "./participants";
export { draftOrderKey, pickSlotKey } from "./pick-slots";
export {
  countTradeTotals,
  getDraftSlots,
  getRosterOwners,
  getSeasonTradeLeagues,
  getTradeFacets,
  getTradeLeagueMarkets,
  getTradeManagers,
  listTrades,
} from "./queries";
export type { TradeLeagueMarket } from "./queries";
export type {
  TradeFacet,
  TradeFacets,
  TradeManagerRow,
  TradeTotals,
  TradesPage,
} from "./queries";
export { MAX_TRADE_BODY_BYTES, readTradeParams } from "./transport";
export type { TradeParams } from "./transport";
