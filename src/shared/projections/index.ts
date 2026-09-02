// Projections and the lineup solve. Import from here, not from the files
// inside — with one exception: `slots.ts` is the zero-runtime-import slot
// vocabulary, and modules that must stay resolvable under Node's test runner
// (or client code, one day) read it relatively on purpose, the way TheLabX
// does. This barrel reaches the network via `ros-read`, so it is server-only.

export { getRosProjections, ROS_PROJECTIONS_TTL_MS } from "./ros-read";
export { assembleRosProjections } from "./ros";
export type { RosPlayerProjection, RosProjections, RosWeek } from "./ros";
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
