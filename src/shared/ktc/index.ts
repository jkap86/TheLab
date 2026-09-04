// KeepTradeCut: the board-choice predicates, the sync that scrapes both of
// KTC's markets into Postgres (see `db/migrations/*_create_ktc_values.sql`),
// and the reads that price a roster off what it stored.
//
// **Server-only**, since the sync and the reads drag `@/shared/db` in — the
// projections barrel's situation exactly. A client module needing
// `isSuperflexLineup`, `ktcBoardValue` or the pick vocabulary imports
// `./roster` / `./picks` relatively instead, the mechanism `projections/slots.ts`
// documents; `parse`, `validate` and `client` are the sync's own building
// blocks and have no caller outside this folder.

export {
  isSuperflexLineup,
  ktcBoardValue,
  QB_ELIGIBLE_STARTING_SLOTS,
  resolveKtcLineup,
} from "./roster";
export { getKtcBoards } from "./board-read";
export type { KtcBoards } from "./board-read";
export { getKtcBoard, getKtcPickBoard } from "./queries";
export type { KtcPickBoard } from "./queries";
export { normalizeName, resolveSleeperIds } from "./match";
export { KTC_PICK_TIERS, ktcPickKey, ktcPickPrice, parseKtcPickName, pickTier } from "./picks";
export type { KtcPickMatch, KtcPickName, KtcPickPrice, KtcPickTier } from "./picks";
export { foldKtcValues } from "./values";
export type { KtcValue, KtcValueRow, KtcValueSet } from "./values";
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
