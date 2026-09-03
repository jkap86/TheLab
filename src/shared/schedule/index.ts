// The NFL schedule, as far as Sleeper publishes one. Import from here, not from
// the files inside — with the usual exception: `parse.ts` is pure and free of
// runtime imports, so its test (and any client code, one day) reads it
// relatively. This barrel reaches the network via `kickoff.ts`, so it is
// server-only on the projections barrel's exact terms.
//
// Known drift: `openingKickoff` came with `parse.ts` — ported whole with its
// tests, the cheaper half of a port — and has no reader here. Its caller in
// TheLabX is a `getFirstKickoff` backing a season-countdown header, which this
// app does not have; that wired half is deliberately absent, and arrives with
// the header that wants it.

export { getWeekGames, getWeekKickoffs } from "./kickoff";
export { openingKickoff, weekGames, weekKickoffs } from "./parse";
export type { TeamGame } from "./parse";
