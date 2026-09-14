/**
 * The gametime rooms of this process — `./live-room` bound to what it
 * actually reaches: the week's feeds, the stored lineups, the solve, the clock
 * and the timers.
 *
 * The room itself lives in `./live-room` and this is the wiring, on
 * `sleeper/request.ts`' terms: that module takes its Sleeper reads and its
 * Postgres reads as arguments so Node's own runner can drive its timer chain,
 * and this file is the one place the real ones are named.
 *
 * Sleeper has no push API, so something polls, and the room is the honest
 * place: a tick is two Sleeper requests (the stats feed and the scoreboard;
 * the projections board is on its own five-minute cache) against the
 * 1000-a-minute document, per week being watched, however many people watch
 * it.
 *
 * **The registry is on `globalThis`**, for the picktracker's reason: under
 * `next dev` a module edit re-evaluates this file, and a fresh `Map` would
 * strand every live room's timer with nothing pointing at it.
 */
import { getManagerWeekLineups } from "@/shared/manager";
import { withBackgroundSleeper } from "@/shared/sleeper";

import { readWeekFeeds } from "./feeds";
import { gametimeRooms, newRoomRegistry } from "./live-room";
import type { RoomDeps, RoomRegistry } from "./live-room";
import { buildGametimePayload } from "./payload";

export { toRoomFrame } from "./live-room";
export type { JoinResult, RoomFrame, RoomListener } from "./live-room";

const REGISTRY_KEY = Symbol.for("thelab.gametime.registry");
const globalForRooms = globalThis as unknown as { [key: symbol]: RoomRegistry | undefined };
const registry: RoomRegistry = (globalForRooms[REGISTRY_KEY] ??= newRoomRegistry());

const deps: RoomDeps = {
  // **Background traffic, though a reader's join is what opens a room and a
  // timer is what ticks it.** The feeds are one read of the week for everybody
  // watching it, not any one request's answer, and the room outlives whichever
  // browser happened to be first — so no read of them may inherit that
  // reader's Sleeper budget or their signal. Declared here, in front of the
  // only path the room has to Sleeper, it covers the read that opens a room
  // and every tick after it alike: the timer chain is armed from inside the
  // joining request's scope, so a tick *inherits* the interactive class and
  // would put every later read on a four-second queue budget nobody chose,
  // were the read not wrapped for itself. `live-room` never reaches Sleeper
  // any other way, which `request-scopes.test.ts` pins.
  readFeeds: (season, week) => withBackgroundSleeper(() => readWeekFeeds(season, week)),
  readRows: getManagerWeekLineups,
  buildPayload: buildGametimePayload,
  now: Date.now,
  random: Math.random,
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
  log: console,
};

const rooms = gametimeRooms(registry, deps);

/**
 * Join (or open) the room for a week, as one reader — see `live-room`'s
 * `joinGametime` for the contract, which is unchanged: the first frame goes
 * out through the listener, `leave` is idempotent, and a failed Postgres read
 * is the reader's own failure.
 */
export const joinGametime = rooms.join;

/**
 * Whether a week's room is already open or opening — so the stream route can
 * tell a join from a cold open and claim an opening slot only for the second.
 */
export const hasGametimeRoom = rooms.has;

/** Open rooms and their readers — for a log line or a test. */
export const gametimeRoomStats = rooms.stats;
