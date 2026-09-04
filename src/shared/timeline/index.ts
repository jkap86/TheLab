// Reading a league's rosters at any moment its stored move log can reach.
// Import from here, not from the files inside — with one deliberate exception:
// `./rewind` is pure and a browser is its second reader, so a `"use client"`
// module reaches it directly the way one already reaches `@/shared/ktc/roster`.
// This barrel drags `pg` in and is server-only.

export { getLeagueTimeline } from "./read";
export type { LeagueTimeline, TimelineEvent, TimelinePick } from "./read";
export { resolveTimelinePayload } from "./payload";
export { readTimelinePricing } from "./pricing";
export { rewindRosters } from "./rewind";
export type { RewindTransaction, RosterPick, RosterState } from "./rewind";
