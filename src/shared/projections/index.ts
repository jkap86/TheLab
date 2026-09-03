// Projections and the lineup solve. Import from here, not from the files
// inside — with one exception: `slots.ts` is the zero-runtime-import slot
// vocabulary, and modules that must stay resolvable under Node's test runner
// (or client code, one day) read it relatively on purpose, the way TheLabX
// does. This barrel reaches the network via `ros-read`, so it is server-only.

export { getRosProjections, ROS_PROJECTIONS_TTL_MS } from "./ros-read";
export { assembleRosProjections } from "./ros";
export type { RosPlayerProjection, RosProjections, RosWeek } from "./ros";
export { getWeekProjections, WEEK_PROJECTIONS_TTL_MS } from "./week-read";
export { assembleWeekProjections, dayLockedPlayers } from "./week";
export type { WeekPlayerProjection, WeekProjections } from "./week";
export { isRealProjection, readPlayerIdentity } from "./identity";
export type { PlayerIdentity } from "./identity";
export {
  clampWeek,
  isPlausibleWeek,
  LAST_REGULAR_WEEK,
  parseRequestedWeek,
} from "./weeks";
export type { RequestedWeek } from "./weeks";
export {
  KICKOFF_BUFFER_MS,
  kickoffMoves,
  kickoffRanks,
  orderLineupByKickoff,
} from "./kickoff-order";
export type { KickoffMove, KickoffPlayer, KickoffSeat } from "./kickoff-order";
export { lockedPlayers } from "./locks";
export type { LockInputs } from "./locks";
export {
  compareLineup,
  eligible,
  optimalLineup,
  recognisedSlots,
  startingSlots,
} from "./optimal";
export type {
  LineupComparison,
  LineupSlot,
  RosterPlayer,
} from "./optimal";
export { scoreStatLine, unprojectedScoring } from "./score";
export { aggregateWeeklyStats } from "./aggregate";
export type { AggregatedProjection, PlayerWeekStats } from "./aggregate";
