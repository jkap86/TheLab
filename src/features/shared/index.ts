// The cross-feature client layer. Import from here, not from the files inside —
// `local-store.ts` is deliberately absent, because only this folder's own
// modules build on it.
//
// `league-filters` is re-exported wholesale rather than named through, because
// it is a folder with a barrel of its own: that barrel is already the curated
// list, and restating its thirty-odd entries here would be a second place for
// one of them to be forgotten.

export { storeAccount, useStoredAccount } from "./account";
export { apiFetch, isAbortError } from "./api";
export { Avatar } from "./avatar";
export {
  CONSOLE_CARD,
  CONSOLE_HOUSING,
  CONSOLE_KEY,
  CONSOLE_KEY_BLOCK,
  CONSOLE_KEY_PILL,
  CONSOLE_PLATE,
  CONSOLE_READOUT,
  CONSOLE_TRACK,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
} from "./console-chrome";
export { errorMessage } from "./error-message";
export { storeKtcBoard, useKtcBoard } from "./ktc-board";
export { KtcBoardKeys } from "./ui/ktc-board-keys";
export { ordinal } from "./format";
export { rankColor } from "./rank-ramp";
export * from "./league-filters";
// The dialog those rules are built in. It moved here from `features/manager`
// when the trades board became a second reader — the line `CONSOLE_KEY` and
// `ManagerPlate` moved on. Only the dialog is exported: the rails, bays and
// rows are its own parts, on the folder rule the header above states.
export { LeagueFiltersDialog } from "./league-filters-dialog/league-filters-dialog";
export {
  DEFAULT_LINEUP_COLUMNS,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  MAX_LINEUP_COLUMNS,
  storeLineupColumns,
  useLineupColumns,
} from "./lineup-columns";
// The picker those columns are chosen in. It moved here from `features/manager`
// when the app rack became a second reader — the same line the filters dialog
// moved on, and the same folder rule: only the dialog is exported.
export { LineupColumnsDialog } from "./ui/lineup-columns-dialog";
export {
  DEFAULT_SHARES_COLUMNS,
  MAX_SHARES_COLUMNS,
  SHARES_COLUMN_IDS,
  SHARES_COLUMN_WIDTHS,
  SHARES_COLUMNS_BY_KIND,
  mergeSharesColumns,
  sharesColumnLabel,
  sharesColumns,
  storeSharesColumns,
  useSharesColumns,
} from "./shares-columns";
export type { SharesColumnId, SharesPanelKind } from "./shares-columns";
export {
  RackControlsProvider,
  usePublishRackControls,
  useRackControls,
} from "./ui/rack-controls";
export type { RackControls } from "./ui/rack-controls";
export { THEME_BOOT_SCRIPT } from "./theme";
export { useManagerLeagues } from "./use-manager-leagues";
export type { ManagerLeaguesState } from "./use-manager-leagues";
export { ThemeToggle } from "./theme-toggle";
export { ManagerPlate } from "./ui/manager-plate";
// The console card's header, shared by all three league cards — see the module.
export {
  CardPlateRow,
  CardRule,
  LeaguePlate,
  PlateDivider,
  PlateField,
  ReadingPlate,
  Scanlines,
} from "./ui/card-plate";
export { ConsoleGround } from "./ui/console-ground";
// What game a league is playing, as one lit window — read by the manager card
// and the trade card, which is what brought it here from `features/manager`.
export { LeagueConfigWindow } from "./ui/league-config-window";
export { PageShell } from "./ui/page-shell";
