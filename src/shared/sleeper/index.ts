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
  getUserLeaguesEnumeration,
  getLeague,
  getLeagueRosters,
  getLeagueUsers,
  getLeagueTradedPicks,
  getLeagueDrafts,
  getDraftPicks,
  getLeagueTransactions,
  getLeagueMatchups,
} from "./leagues";
// The cache-busting token, for the one path a reader drives — see `./fresh`.
// Only the mint escapes: `freshUrl` and `CACHE_BUST_PARAM` are how the getters
// in this folder spend it, which is the barrel's own rule about siblings.
export { cacheBustToken } from "./fresh";
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
// What a Sleeper read is *for*, and therefore how long it may take. The two
// scope helpers are the surface everything outside this folder uses:
// `withInteractiveSleeper` at a route handler, `withBackgroundSleeper` inside
// the durable work a route starts. See `./request-policy`.
export {
  withInteractiveSleeper,
  withBackgroundSleeper,
  withSleeperRequests,
  currentSleeperPolicy,
  resolveSleeperPolicy,
  isInteractive,
  BACKGROUND_SLEEPER_POLICY,
  INTERACTIVE_SLEEPER_POLICY,
} from "./request-policy";
export type {
  SleeperRequestClass,
  SleeperRequestOptions,
  SleeperRequestPolicy,
} from "./request-policy";
export { classifyUserLeagues } from "./enumeration";
export type { UserLeaguesEnumeration } from "./enumeration";
export { isMissingResource } from "./missing";
export { getAllPlayers } from "./players";
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
