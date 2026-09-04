// The pick tracker: a decoder for the kicker-placeholder convention, and the
// shared poller that follows a draft while it happens.
//
// Server-only, on the `shared/ktc` barrel's terms — `track`/`live` reach
// Sleeper. `picks.ts` is pure and a client module that ever needs it should
// import `./picks` relatively rather than widening this.
export {
  findPlaceholderDraft,
  draftTeamCount,
  pickLabel,
  placeholderPicks,
  nextPickLabel,
} from "./picks";
export type { PlaceholderManager, PlaceholderPick } from "./picks";
export { trackPlaceholderDraft, retrackPlaceholderDraft } from "./track";
export type { PicktrackerContext, PicktrackerResult } from "./track";
export { toPicktrackerPayload } from "./payload";
export { joinRoom, roomStats } from "./live";
export type { JoinResult, RoomListener } from "./live";
