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
  getManagerDraftAdp,
  getManagerLeagues,
  getManagerLineupRows,
  getManagerSyncState,
} from "./queries";
export { solveLeagueLineup } from "./ros-lineups";
export type { RosLineupLeague } from "./ros-lineups";
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
  STEEPNESS_RANGE,
  TYPICAL_STARTING_SLOTS,
  adpValue,
  leagueAdpPool,
  parseSteepness,
  rosterAdpValue,
  startingSlotCount,
} from "./adp-value";
export type { AdpRosterValue } from "./adp-value";
