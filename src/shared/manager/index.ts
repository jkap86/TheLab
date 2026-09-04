// Syncing a manager's league graph from Sleeper into Postgres, and reading it
// back. Import from here, not from the files inside.

export {
  syncManagerLeagues,
  syncLeagueGraphs,
  getSyncClock,
  managerSyncGate,
  refreshedLeagues,
  SYNC_TTL_MS,
  SYNC_ATTEMPT_TTL_MS,
} from "./sync";
export type {
  ManagerSyncState,
  SyncGate,
  SyncGateReason,
  SyncSummary,
  SyncProgress,
  SyncOptions,
  LeagueCounts,
  LeagueSyncResult,
} from "./sync";
export {
  MANDATORY_GRAPH_COLLECTIONS,
  missingGraphCollections,
} from "./persist";
export type {
  MandatoryGraphCollection,
  PersistLeagueGraphResult,
} from "./persist";
export {
  SETTLED_SYNC_TTL_MS,
  seasonSyncTier,
  syncTtlMsFor,
} from "./sync-freshness";
export type { SeasonSyncTier } from "./sync-freshness";
export {
  LAST_REGULAR_WEEK,
  collectionWeeks,
  graphWeekCeiling,
  isFinishedSeason,
  leagueGraphWeeks,
} from "./graph-weeks";
export type { SyncClock } from "./graph-weeks";
export {
  LEAGUE_COLUMNS_SQL,
  // Exported for `shared/timeline`, which resolves a league's pick horizon the
  // same way this file does and must not spell the guard a second time — a
  // league reading as dynasty here and as redraft there is a pick grid that
  // disagrees with the one the card beside it draws.
  LEAGUE_TYPE_SQL,
  getLeagueLineupRow,
  getLeaguemateIds,
  getManagerDraftAdp,
  getManagerLeaguemates,
  getManagerLeagueIds,
  getManagerLeagues,
  getManagerLeagueRosters,
  getManagerRosters,
  getManagerSyncState,
  toManagerLeague,
} from "./queries";
export type { LeagueRow, LeaguemateRow, ManagerLeagueRow } from "./queries";
export { solveLeagueLineup } from "./ros-lineups";
export type { RosLineupLeague } from "./ros-lineups";
export { lineupMetricTotals, rankLeagueLineups } from "./league-ranks";
export type { LeagueRosterRow, RankLeague, RankedRoster } from "./league-ranks";
export { leagueTeamName, pickValue, solveLeagueEntry } from "./league-teams";
export type { KtcPricing, LineupLeagueRow } from "./league-teams";
export {
  DYNASTY_LEAGUE_TYPE,
  DYNASTY_PICK_SEASONS,
  dynastyPickGrid,
  leaguePickBoard,
  leagueRosterPicks,
  ownedDraftPicks,
  pickCellKey,
} from "./draft-picks";
export type {
  DraftPickAsset,
  DraftPickGrid,
  LeaguePickBoard,
  PickCell,
  LeagueDraft,
  LeagueDraftRow,
  LeagueUserName,
  PickLeague,
  PickRoster,
  TradedPick,
} from "./draft-picks";
export {
  managerSyncAdmission,
  createManagerSyncAdmission,
  managerSyncConcurrency,
  managerSyncLimit,
  MANAGER_SYNC_LIMIT_VAR,
} from "./sync-admission";
export type {
  ManagerSyncAdmission,
  ManagerSyncLimit,
  ManagerSyncRefusal,
  ManagerSyncReservation,
} from "./sync-admission";
export {
  ADP_PEAK,
  DEFAULT_STEEPNESS,
  ROOKIE_PICK_STRIDE,
  ROOKIE_TOP_OVERALL_PICK,
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  adpEntryValue,
  adpValue,
  leagueAdpPool,
  parseSteepness,
  rookieOverallPick,
  rosterAdpValue,
  startingSlotCount,
} from "./adp-value";
export type { AdpBoard, AdpEntry, AdpRosterValue } from "./adp-value";
export { getManagerWeekLineups } from "./queries";
export type { ManagerWeekLineupRow } from "./queries";
export { solveWeekLineup } from "./week-lineups";
export type { WeekLineupLeague } from "./week-lineups";

// The lineup checker's per-league refresh press. Only the entry point leaves the
// folder: the gate, the admission bound and the lock key are how it is built,
// and nothing outside `manager/` decides when a league may be re-read.
export { refreshLeague } from "./league-refresh";
export type { LeagueRefreshResult } from "./league-refresh";
export { LEAGUE_REFRESH_LIMIT_VAR } from "./league-refresh-admission";

// The background crawl, on the KTC and players barrels' terms: the starter and
// its switch, and nothing else. The tick, the queue, the tiers and the
// discovery selection stay folder-internal — nothing outside `manager/` decides
// what to crawl next. `markLeaguesAccessed` has two callers now — the manager
// sync and the refresh press — and both are *observed* demand, which is the
// rule that column keeps; the crawler still never stamps what it refreshes.
export { LEAGUE_CRAWLER_VAR, startLeagueCrawler } from "./scheduler";
