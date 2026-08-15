export { apiFetch, fetchJson, isAbortError } from "./api";
export { useStoredAccount, storeAccount } from "./account";
export { takeLines } from "./ndjson";
export { useReturnFocus } from "./use-return-focus";
export { GC_TIME, createQueryClient } from "./query-client";
export { useUserLeagues } from "./use-user-leagues";
export type { UserLeaguesState } from "./use-user-leagues";
export {
  FIRST_SLEEPER_SEASON,
  seasonParam,
  stepSeason,
} from "./manager-season";
export {
  BEST_BALL_OPTIONS,
  COMMON_SCORING_KEYS,
  COMPARE_OPS,
  DEFAULT_LEAGUE_FILTERS,
  SLOT_GROUPS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  activeFilterCount,
  activeFilters,
  clearFilter,
  compare,
  deriveScoring,
  filterSummary,
  formatRuleValue,
  leagueBreakdown,
  leagueType,
  matchesFilters,
  matchesScoringRule,
  matchesSlotRule,
  scoringKeyLabel,
  scoringKeyOptions,
  scoringValue,
  slotCount,
  slotGroupLabel,
} from "./league-filters/index";
export type {
  ActiveFilter,
  CompareOp,
  FilterRule,
  LeagueBreakdownRow,
  LeagueFilters,
  SlotGroup,
} from "./league-filters/index";
export {
  MONTH_ABBREVIATIONS,
  formatRangeDate,
  formatRangeMonth,
  msUntilNextLocalMidnight,
  shiftDays,
  shiftMonths,
  todayIso,
} from "./date-range";
export { useTodayIso } from "./use-today-iso";
export { ordinal } from "./format";
export { firstKickoff, nflMarkers, nflMarkersIn } from "./nfl-calendar";
export type { NflMarker, NflMarkerKind } from "./nfl-calendar";
export {
  ADP_PEAK,
  DEFAULT_ADP_ROUNDS,
  DEFAULT_ADP_STEEPNESS,
  DEFAULT_STEEPNESS,
  STEEPNESS_RANGE,
  adpNarrowingCount,
  adpBoardRead,
  adpValueRead,
  boardLabel,
  defaultAdpControls,
  isUnboundedRange,
  previewAdpPool,
  previewAdpValue,
  rangeBounds,
  rangeLabel,
  rangeSummary,
  rookieOrderingBoard,
  seasonOptions,
  seedFromLeague,
  startupPricingBoard,
  steepnessSummary,
} from "./adp-controls";
export type {
  AdpControls,
  AdpRange,
  AdpRangeBounds,
  AdpRangePreset,
  AdpRead,
} from "./adp-controls";
export { ALL_LEAGUES, resolveLeagueScope } from "./league-scope";
export type { LeagueScope } from "./league-scope";
export { useAdpLeagues } from "./use-adp-leagues";
export { AdpControlsProvider, useAdpControls } from "./adp-controls-context";
export { useAdp } from "./use-adp";
export type { AdpState } from "./use-adp";
export { useAdpDensity } from "./use-adp-density";
export type { AdpDensityState } from "./use-adp-density";
// The trigger only. `AdpDrawer` is deliberately absent: it is loaded through
// `dynamic()` at its call sites, and a barrel re-export would pull it back into
// the static graph of every page that imports anything from here.
export { AdpTrigger } from "./ui/adp-trigger";
export { PositionBadge } from "./ui/position-badge";
export {
  TOOL_GROUPS,
  isToolActive,
  toolHref,
  tools,
  toolsInGroup,
} from "./tools";
export type { Tool, ToolGroup, ToolIconName } from "./tools";
export { AmbientBackdrop } from "./ui/ambient-backdrop";
export { PageHeading } from "./ui/page-heading";
export { PageShell } from "./ui/page-shell";
export { LIST_ROW_HOVER, LIST_ROW_SURFACE, RowSheen } from "./ui/list-row";
export { NAMEPLATE_BUTTON, Nameplate } from "./ui/nameplate";
export { ListLedge } from "./ui/list-ledge";
export { COLUMN_BOX, COLUMN_ROW, COLUMN_WIDTH } from "./ui/stat-columns";
export { HeaderSlot } from "./ui/header-slot";
export { SiteHeader } from "./ui/site-header";
export { ToolsMenu } from "./ui/tools-menu";
export { ToolIcon } from "./ui/tool-icon";
export { Avatar } from "./ui/avatar";
export { FlaskLoader } from "./ui/flask-loader";
// The placeholder only, for the same reason `AdpDrawer` is absent above:
// `LeagueFiltersModal` is loaded through `dynamic()` at both its call sites, and
// re-exporting it here put it in the static graph of every page importing
// anything from this barrel — `/tools`, `/picktracker` and `/lineupchecker` were
// each shipping a filters dialog they have no trigger for, and the `dynamic()`
// on the trades page bought nothing because the bytes arrived anyway. The
// placeholder holds the key's box while that chunk loads and knows nothing about
// the dialog.
export { LeagueFiltersPlaceholder } from "./ui/league-filters-seat";
export type { SeatName } from "./ui/league-filters-seat";
export type { FlaskVariant, FlaskTone } from "./ui/flask-loader";
