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
  CONSOLE_HOUSING,
  CONSOLE_KEY,
  CONSOLE_KEY_BLOCK,
  CONSOLE_KEY_PILL,
  CONSOLE_READOUT,
  CONSOLE_TRACK,
  CONSOLE_WELL,
} from "./console-chrome";
export { errorMessage } from "./error-message";
export { ordinal } from "./format";
export * from "./league-filters";
// The dialog those rules are built in. It moved here from `features/manager`
// when the trades board became a second reader — the line `CONSOLE_KEY` and
// `ManagerPlate` moved on. Only the dialog is exported: the rails, bays and
// rows are its own parts, on the folder rule the header above states.
export { LeagueFiltersDialog } from "./league-filters-dialog/league-filters-dialog";
export {
  DEFAULT_LINEUP_COLUMNS,
  LINEUP_METRIC_IDS,
  MAX_LINEUP_COLUMNS,
  storeLineupColumns,
  useLineupColumns,
} from "./lineup-columns";
export {
  RackReadoutProvider,
  usePublishRackReadout,
  useRackReadout,
} from "./ui/rack-readout";
export type { RackReadout } from "./ui/rack-readout";
export { THEME_BOOT_SCRIPT } from "./theme";
export { useManagerLeagues } from "./use-manager-leagues";
export type { ManagerLeaguesState } from "./use-manager-leagues";
export { ThemeToggle } from "./theme-toggle";
export { ManagerPlate } from "./ui/manager-plate";
export { ConsoleGround } from "./ui/console-ground";
export { PageShell } from "./ui/page-shell";
