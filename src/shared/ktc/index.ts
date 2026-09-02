// KeepTradeCut: the superflex predicate, and the sync that scrapes both of
// KTC's markets into Postgres (see `db/migrations/*_create_ktc_values.sql`).
//
// **Server-only**, since the sync half drags `@/shared/db` in — the projections
// barrel's situation exactly. A client module needing `isSuperflexLineup`
// imports `./roster` relatively instead, the mechanism `projections/slots.ts`
// documents; `parse`, `validate` and `client` are the sync's own building
// blocks and have no caller outside this folder.

export { isSuperflexLineup, QB_ELIGIBLE_STARTING_SLOTS } from "./roster";
export { startKtcScheduler, KTC_SYNC_VAR } from "./scheduler";
export { syncKtcValues, KTC_TTL_MS, KTC_FORMATS } from "./sync";
export type { KtcSyncSummary, KtcBoardSyncSummary } from "./sync";
export { syncKtcHistory } from "./history";
export type { KtcHistorySummary } from "./history";
export type {
  KtcFormat,
  KtcPlayer,
  KtcValueBlock,
  KtcSeriesPoint,
  KtcHistoryPoint,
} from "./types";
