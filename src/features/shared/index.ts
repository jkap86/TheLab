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
  CONSOLE_CHIP_RAISED,
  CONSOLE_CHIP_TRAY,
  CONSOLE_FIGURE_WELL,
  CONSOLE_GLASS,
  CONSOLE_HOUSING,
  CONSOLE_HOUSING_INSET,
  CONSOLE_HOUSING_INSET_SHELL,
  CONSOLE_KEY,
  CONSOLE_KEY_BLOCK,
  CONSOLE_KEY_PILL,
  CONSOLE_KEY_PILL_SHELL,
  CONSOLE_METAL,
  CONSOLE_METAL_TRACK_SM,
  CONSOLE_MILLED_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_PLATE,
  CONSOLE_READOUT,
  CONSOLE_ROW_WELL,
  CONSOLE_TRACK,
  CONSOLE_TRACK_SM,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
  CONSOLE_WINDOW_KEY,
  CONSOLE_WINDOW_LEDGE,
  BILLET_KEY_CHROME,
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
export {
  placeAmong,
  rampDepth,
  rampFace,
  rankColor,
  rankFill,
  rankPercentile,
  // A margin is a share of what it was measured against rather than a rank —
  // see the function. The lineup checker's projected margins joined the
  // standings table as a reader, one page over.
  sharePercentile,
} from "./rank-ramp";
export * from "./league-filters";
// The dialog those rules are built in. It moved here from `features/manager`
// when the trades board became a second reader — the line `CONSOLE_KEY` and
// `ManagerPlate` moved on. Only the dialog is exported: the rails, bays and
// rows are its own parts, on the folder rule the header above states.
export { LeagueFiltersDialog } from "./league-filters-dialog/league-filters-dialog";
export {
  adpBoardLabel,
  column,
  DEFAULT_LINEUP_COLUMNS,
  ktcBoardLabel,
  ktcChoiceLabel,
  LINEUP_METRIC_IDS,
  LINEUP_METRIC_LABELS,
  MAX_LINEUP_COLUMNS,
  positionsLabel,
  qbBoardWord,
  slotsInHand,
  slotsLabel,
  storeLineupColumns,
  storeTeamsColumn,
  useLineupColumns,
  useTeamsColumn,
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
// One league's rosters solved, for a card with no batched answer to draw on —
// the trades board's, whose leagues belong to no one account. See the module for
// why it takes the timeline's own subject.
export { leagueLineupKey, useLeagueLineup } from "./use-league-lineup";
export type { LeagueLineupState } from "./use-league-lineup";
export {
  invalidateLeagueLineups,
  MAX_ENTRIES as MAX_LEAGUE_LINEUP_ENTRIES,
} from "./league-lineup-cache";
export { createRequestGuard, useRequestGuard } from "./request-guard";
export type { RequestGuard, RequestTicket } from "./request-guard";
export { useManagerLeagues } from "./use-manager-leagues";
export type { ManagerLeaguesState } from "./use-manager-leagues";
export { ThemeToggle } from "./theme-toggle";
// Two identity headers, one content: the billet both `/manager` and the
// lineup checker draw now, and the plate that has no caller since the checker
// took the billet. Siblings rather than a variant — see the module.
export { ManagerBillet, ManagerPlate } from "./ui/manager-plate";
// One count stamped into a billet. It came out of `season-summary.tsx` when the
// lineup checker's header took the billet — a second reader of the same well.
export { StampedCount } from "./ui/stamped-count";
// The console card's header, shared by all four league cards — see the module.
// `CardLedge` and the bays under it are the manager card's own arrangement of
// the same header, and live beside the plates for the same reason the plates
// live together: the day a second card takes the ledge it takes this one.
export {
  BilletFinish,
  CardLedge,
  CardBilletRow,
  CardPlateRow,
  CardRule,
  GameChip,
  LeagueBillet,
  LeaguePlate,
  LedgeBay,
  LedgeFigure,
  LedgeName,
  LedgeWell,
  MilledHairline,
  PlateBay,
  PlateDivider,
  PlateField,
  RampFigure,
  ReadingPlate,
  Scanlines,
  StandingBay,
  StandingStrip,
} from "./ui/card-plate";
export { ConsoleGround } from "./ui/console-ground";
// The parts an expanded card's browser is built from — a billet carrying a
// ledge and a sheet of glass, the channel a row is cut in it, and the drawer a
// bench rises out of. They were the manager card's alone and reached through a
// sibling's relative import; the lineup checker's week view is the second
// reader, and a sibling feature may not import from `features/manager` or reach
// past this barrel into `features/shared`'s own internals.
export {
  DrawerBar,
  DrawerRow,
  DRAWER_BAR,
  DRAWER_BAR_HEIGHT,
  DRAWER_BARS,
  Pane,
  PaneDrawer,
  PaneGlass,
  PaneHead,
  PaneLedge,
} from "./ui/pane";
export type { DrawerTray } from "./ui/pane";
// The capped inner housing an open card's expanded half is drawn in. It came
// here from `features/manager` when the trade card became a second reader — the
// line `LeagueTeams` and `LeagueConfigWindow` moved on, and the same folder
// rule, since `features/trades` may not import from `features/manager`.
export { ExpandedPanel } from "./ui/expanded-panel";
// Exported beside it, though all three cards mount `ExpandedPanel` since the
// lineup checker's expanded half converged on it: the hook is still the seam a
// half with a different inset would take, which is what it was split off for.
export { usePanelCap } from "./use-panel-cap";
// The park is the *list*'s, not the card's — see `useActiveCard`, which is
// what three pages mount to make an open card the screen and a link.
export {
  readQueryParam,
  useActiveCard,
  useUrlParam,
  writeQueryParam,
  type ActiveCard,
} from "./use-active-card";
// The league table an expanded card draws. It came here from
// `features/manager` when the history rail became a second reader — it draws
// the same table over a rewound roster set.
//
// `draft-picks.ts` is deliberately *not* re-exported beside it any more: the
// portfolio is a drawer of the roster pane rather than a block under the two
// panes, so its only reader is `lineup-breakdown.tsx`, a sibling of the
// barrel's own. That is `local-store.ts`'s rule — a module the barrel's
// siblings build on and nothing outside does stays out of it.
export { LeagueTeams } from "./ui/league-teams";
// What game a league is playing, as one lit window — read by the manager card
// and the trade card, which is what brought it here from `features/manager`.
export { LeagueChipRail, LeagueConfigWindow } from "./ui/league-config-window";
export { PageShell } from "./ui/page-shell";
