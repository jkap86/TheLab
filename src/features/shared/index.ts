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
  CONSOLE_BILLET,
  CONSOLE_CARD,
  CONSOLE_CARD_SHELL,
  CONSOLE_CHIP,
  CONSOLE_CHIP_TRAY,
  CONSOLE_GLASS,
  CONSOLE_HOUSING,
  CONSOLE_HOUSING_INSET,
  CONSOLE_KEY,
  CONSOLE_KEY_BLOCK,
  CONSOLE_KEY_PILL,
  CONSOLE_KEY_PILL_SHELL,
  CONSOLE_METAL,
  CONSOLE_MILLED_WELL,
  CONSOLE_PLATE,
  CONSOLE_READOUT,
  CONSOLE_TRACK,
  CONSOLE_TRACK_SM,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
  CONSOLE_WINDOW_KEY,
  CONSOLE_WINDOW_LEDGE,
  PLATE_KEY,
  PLATE_KEY_CHROME,
} from "./console-chrome";
export { errorMessage } from "./error-message";
export { storeKtcBoard, useKtcBoard } from "./ktc-board";
export {
  DEFAULT_TRADE_VALUE_BASIS,
  TRADE_VALUE_BASES,
  parseTradeValueBasis,
  storeTradeValueBasis,
  useTradeValueBasis,
} from "./trade-value-basis";
// What a browser must stop trusting once a sync has landed on this device —
// see the module for why the two trade routes' cache headers stay as they are.
export {
  NO_TRADE_STAMP,
  markTradeDataSynced,
  parseTradeDataStamp,
  useTradeDataStamp,
} from "./trade-freshness";
export type { TradeDataStamp } from "./trade-freshness";
export { KtcBoardKeys } from "./ui/ktc-board-keys";
export { formatInstantDate, formatInstantTime, ordinal, ordinalParts } from "./format";
// The rank ramp and its two readings. The trades board joined the manager
// card as a reader when its asset values gained a place in their own league:
// a bar and a hue drawn from one rank on two pages must come off one module.
export { placeAmong, rankColor, rankFill, rankPercentile } from "./rank-ramp";
export * from "./league-filters";
// The dialog those rules are built in. It moved here from `features/manager`
// when the trades board became a second reader — the line `CONSOLE_KEY` and
// `ManagerPlate` moved on. Only the dialog is exported: the rails, bays and
// rows are its own parts, on the folder rule the header above states.
export { LeagueFiltersDialog } from "./league-filters-dialog/league-filters-dialog";
export {
  column,
  DEFAULT_LINEUP_COLUMNS,
  ktcBoardLabel,
  ktcChoiceLabel,
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
export type { SharesColumnId } from "./shares-columns";
// The second narrowing a league grid takes, and the two components that drive
// it. All three came here from `features/manager` when the lineup checker grew
// drawers of its own — the line `CONSOLE_KEY` and `ManagerPlate` moved on.
export {
  NO_SUBJECTS,
  leaguematePlayerId,
  matchesSubjects,
  parseLeaguematePlayerId,
  pickedSubject,
  removeSubject,
  setSubjectMode,
  subjectCount,
  subjectKey,
  subjectSlot,
  toggleSubject,
} from "./league-subjects";
export type {
  LeagueSubjects,
  Subject,
  SubjectKind,
  SubjectMatch,
  SubjectMode,
  SubjectRolls,
} from "./league-subjects";
export { CollapseTray } from "./ui/collapse-tray";
export { SharesDrawer } from "./ui/shares-drawer";
export type {
  SharesDrawerDisclosure,
  SharesDrawerRow,
} from "./ui/shares-drawer";
export { SubjectTokens } from "./ui/subject-tokens";
export {
  RackControlsProvider,
  usePublishRackControls,
  useRackControls,
} from "./ui/rack-controls";
export type { RackControls, RackDrawerKey } from "./ui/rack-controls";
export { THEME_BOOT_SCRIPT } from "./theme";
export { useManagerLeagues } from "./use-manager-leagues";
export type { ManagerLeaguesState } from "./use-manager-leagues";
export { ThemeToggle } from "./theme-toggle";
export { ManagerPlate } from "./ui/manager-plate";
// The console card's header, shared by all four league cards — see the module.
// `CardLedge` and the bays under it are the manager card's own arrangement of
// the same header, and live beside the plates for the same reason the plates
// live together: the day a second card takes the ledge it takes this one.
export {
  BilletFinish,
  CardLedge,
  CardPlateRow,
  CardRule,
  LeaguePlate,
  LedgeBay,
  LedgeFigure,
  LedgeName,
  LedgeWell,
  MilledHairline,
  PlateDivider,
  PlateField,
  ReadingPlate,
  Scanlines,
} from "./ui/card-plate";
export { ConsoleGround } from "./ui/console-ground";
// A roster's future picks, grouped by season, and the league table it sits
// under. Both came here from `features/manager` when the history rail became a
// second reader — it draws the same table over a rewound roster set.
export { DraftPicks } from "./ui/draft-picks";
export { LeagueTeams } from "./ui/league-teams";
// What game a league is playing, as one lit window — read by the manager card
// and the trade card, which is what brought it here from `features/manager`.
export { LeagueChipRail, LeagueConfigWindow } from "./ui/league-config-window";
export { PageShell } from "./ui/page-shell";
