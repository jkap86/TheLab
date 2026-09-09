// The gametime tool's server half: the week's three live feeds read together,
// the payload built from them, and the shared poller that pushes it to every
// reader of a week. Server-only on `shared/picktracker`'s terms — `feeds` and
// `live` reach Sleeper and Postgres. `live-rules.ts` is pure and its test reads
// it relatively.
export { readWeekFeeds } from "./feeds";
export type { WeekFeeds } from "./feeds";
export { buildGametimePayload } from "./payload";
export { joinGametime, gametimeRoomStats, toRoomFrame } from "./live";
export type { JoinResult, RoomFrame, RoomListener } from "./live";
export {
  diffLeagues,
  feedSignature,
  LEAGUES_TTL_MS,
  LIVE_INTERVAL_MS,
  pollIntervalMs,
  WAITING_INTERVAL_MS,
} from "./live-rules";
