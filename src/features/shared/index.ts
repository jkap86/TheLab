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
export { CONSOLE_HOUSING, CONSOLE_KEY } from "./console-chrome";
export { errorMessage } from "./error-message";
export * from "./league-filters";
export {
  DEFAULT_LINEUP_COLUMNS,
  LINEUP_METRIC_IDS,
  MAX_LINEUP_COLUMNS,
  storeLineupColumns,
  useLineupColumns,
} from "./lineup-columns";
export { THEME_BOOT_SCRIPT } from "./theme";
export { ThemeToggle } from "./theme-toggle";
export { PageShell } from "./ui/page-shell";
