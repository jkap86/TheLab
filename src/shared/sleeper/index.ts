// Everything this app knows about Sleeper. Import from here, not from the files
// inside — `limiter.ts` and `missing.ts` are the client's own building blocks
// and have no caller outside this folder.

export {
  getSleeperUser,
  sleeperAvatarUrl,
  sleeperDataUrl,
  sleeperGet,
  sleeperGetOptional,
  sleeperLimiter,
  sleeperUrl,
  SLEEPER_API_BASE,
  SLEEPER_CDN_BASE,
  SLEEPER_DATA_BASE,
} from "./client";
export {
  getUserLeagues,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueTradedPicks,
  getLeagueDrafts,
  getDraftPicks,
  getLeagueTransactions,
  getLeagueMatchups,
} from "./leagues";
export {
  createLimiter,
  sleeperConcurrency,
  isAdmissionRefusal,
  isAdmissionAbort,
  AdmissionAbortedError,
  AdmissionTimeoutError,
  DEFAULT_SLEEPER_CONCURRENCY,
} from "./limiter";
export type { Limiter, LimiterStats, LimiterWaitOptions } from "./limiter";
export { isMissingResource } from "./missing";
export { getNflWeekScores } from "./scores";
export { getNflState, DEFAULT_SEASON } from "./state";
export type {
  SleeperUser,
  SleeperLeague,
  SleeperRoster,
  SleeperLeagueUser,
  SleeperTradedPick,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTransaction,
  SleeperMatchup,
  SleeperNflState,
  SleeperPlayer,
  SleeperPlayerMap,
  SleeperProjection,
  SleeperScoreGame,
} from "./types/sleeper.types";
