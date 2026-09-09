/**
 * One shared feed poller per NFL week, and a solve per reader of it.
 *
 * `picktracker/live`'s arrangement — a room, a ref-counted subscriber set, a
 * chained timer whose cadence is the board's own, and a linger — with one
 * difference that is the whole of this file: **a picktracker room's answer is
 * the same for every reader and a gametime room's is not.** The feeds (a
 * week's projections, its stat lines, its scoreboard) are shared by everyone
 * watching that week, so they are read once per tick however many are
 * watching; what a reader sees is those feeds solved against *their* stored
 * lineups, which is one Postgres read per reader every few minutes and one
 * cheap solve per tick. So the room is per week and the payload is per
 * subscriber, and a frame is serialised once per subscriber rather than once
 * per room.
 *
 * Sleeper has no push API, so something polls, and this is the honest place:
 * a tick is two Sleeper requests (the stats feed and the scoreboard; the
 * projections board is on its own five-minute cache) against the 1000-a-minute
 * document, per week being watched, however many people watch it.
 *
 * **The registry is on `globalThis`**, for the picktracker's reason: under
 * `next dev` a module edit re-evaluates this file, and a fresh `Map` would
 * strand every live room's timer with nothing pointing at it.
 */
import type {
  GametimeDelta,
  GametimeStreamMessage,
  ManagerGametimePayload,
} from "@/shared/contract";
import { getManagerWeekLineups } from "@/shared/manager";
import type { ManagerWeekLineupRow } from "@/shared/manager";

import { readWeekFeeds } from "./feeds";
import type { WeekFeeds } from "./feeds";
import {
  diffLeagues,
  FAILURE_INTERVAL_MS,
  LEAGUES_TTL_MS,
  LINGER_MS,
  pollIntervalMs,
  STALE_AFTER_FAILURES,
} from "./live-rules";
import { buildGametimePayload } from "./payload";

/** A message serialised once for the reader it is about to reach. */
export type RoomFrame = { type: GametimeStreamMessage["type"]; json: string };

export type RoomListener = (frame: RoomFrame) => void;

export function toRoomFrame(message: GametimeStreamMessage): RoomFrame {
  return { type: message.type, json: JSON.stringify(message) };
}

/** Who is watching, and what the room has solved for them. */
type Subscriber = {
  userId: string;
  username: string;
  listener: RoomListener;
  /** Their stored lineups, and when they were read. */
  rows: ManagerWeekLineupRow[];
  rowsAt: number;
  /**
   * Each league of the last answer sent, serialised — what a tick diffs the
   * next answer against, so a reader is sent the leagues that moved and not
   * the page. See `GametimeDelta`.
   */
  held: Map<string, string>;
  /** The last answer's header, serialised, so a tick that moved nothing sends nothing. */
  heldHeader: string;
};

type Room = {
  key: string;
  season: string;
  week: number;
  subscribers: Set<Subscriber>;
  feeds: WeekFeeds;
  timer: ReturnType<typeof setTimeout> | null;
  ticking: boolean;
  failures: number;
  toldStale: boolean;
  linger: ReturnType<typeof setTimeout> | null;
};

type Registry = {
  rooms: Map<string, Room>;
  /** First feed reads in flight, so simultaneous cold joiners share one. */
  openings: Map<string, Promise<Room>>;
};

const REGISTRY_KEY = Symbol.for("thelab.gametime.registry");
const globalForRooms = globalThis as unknown as { [key: symbol]: Registry | undefined };
const registry: Registry = (globalForRooms[REGISTRY_KEY] ??= {
  rooms: new Map(),
  openings: new Map(),
});
const { rooms, openings } = registry;

export type JoinResult =
  | { ok: true; frame: RoomFrame; leave: () => void }
  | { ok: false; status: 500 | 502; error: string };

/**
 * Join (or open) the room for a week, as one reader, and get their answer as
 * it stands now.
 *
 * The room's first feed read is shared between simultaneous cold joiners on
 * the picktracker's terms; the reader's own Postgres read is theirs alone and
 * is what a failed join reports. `leave` is idempotent, for the reason that
 * file gives: a stream is torn down by two different disconnects and either
 * may fire first.
 */
export async function joinGametime(
  input: { userId: string; username: string; season: string; week: number },
  listener: RoomListener,
): Promise<JoinResult> {
  const key = `${input.season}:${input.week}`;

  let room = rooms.get(key);
  if (!room) {
    let opening = openings.get(key);
    if (!opening) {
      opening = openRoom(key, input.season, input.week);
      openings.set(key, opening);
    }
    room = await opening;
  }

  let rows: ManagerWeekLineupRow[];
  try {
    rows = await getManagerWeekLineups(input.userId, input.season, input.week);
  } catch (error) {
    console.error(`[gametime] lineups unavailable for ${input.username} ${key}:`, error);
    return { ok: false, status: 500, error: "Failed to load lineups" };
  }

  // The room may have closed during the read — a linger that ran out with
  // nobody in it. Re-open rather than seat a reader in a room nothing ticks.
  if (rooms.get(key) !== room) {
    return joinGametime(input, listener);
  }

  const subscriber: Subscriber = {
    userId: input.userId,
    username: input.username,
    listener,
    rows,
    rowsAt: Date.now(),
    held: new Map(),
    heldHeader: "",
  };
  const frame = firstFrame(room, subscriber);

  if (room.linger !== null) {
    clearTimeout(room.linger);
    room.linger = null;
  }
  room.subscribers.add(subscriber);

  return { ok: true, frame, leave: leaver(room, subscriber) };
}

/**
 * The first feed read, and the room it produces.
 *
 * Never fails: `readWeekFeeds` degrades per feed rather than throwing, and a
 * room whose first read answered nothing is a room whose readers are told the
 * feeds are down and which keeps trying at the failure cadence.
 */
async function openRoom(key: string, season: string, week: number): Promise<Room> {
  try {
    const feeds = await readWeekFeeds(season, week);
    const room: Room = {
      key,
      season,
      week,
      subscribers: new Set(),
      feeds,
      timer: null,
      ticking: false,
      failures: feedsFailed(feeds) ? 1 : 0,
      toldStale: false,
      linger: null,
    };
    rooms.set(key, room);
    schedule(room);
    scheduleTeardown(room);
    console.log(
      `[gametime] room open ${key} (${feeds.games.live} live, ${feeds.games.pre} to come, ${feeds.games.final} final)`,
    );
    return room;
  } finally {
    openings.delete(key);
  }
}

/** Both feeds a tick reads for itself failed — the projections board is cached apart. */
function feedsFailed(feeds: WeekFeeds): boolean {
  return feeds.statuses.stats === "error" && feeds.statuses.scores === "error";
}

function leaver(room: Room, subscriber: Subscriber): () => void {
  let left = false;
  return () => {
    if (left) return;
    left = true;
    room.subscribers.delete(subscriber);
    if (room.subscribers.size === 0) scheduleTeardown(room);
  };
}

function scheduleTeardown(room: Room) {
  if (room.linger !== null) return;
  const timer = setTimeout(() => {
    room.linger = null;
    if (room.subscribers.size > 0) return;
    if (rooms.get(room.key) !== room) return;
    close(room);
  }, LINGER_MS);
  timer.unref?.();
  room.linger = timer;
}

function close(room: Room) {
  rooms.delete(room.key);
  console.log(`[gametime] room closed ${room.key}`);
  if (room.timer !== null) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  if (room.linger !== null) {
    clearTimeout(room.linger);
    room.linger = null;
  }
}

/**
 * Arm the next tick, or stop.
 *
 * The cadence is the board's own (`pollIntervalMs`): the live rate while a
 * game runs, the time to the next kickoff while games are still to come, and
 * nothing at all once the week is over — the stream stays open holding final
 * numbers, which is the honest end state.
 */
function schedule(room: Room) {
  if (room.timer !== null) clearTimeout(room.timer);
  room.timer = null;

  const interval =
    room.failures > 0
      ? FAILURE_INTERVAL_MS
      : pollIntervalMs({
          games: room.feeds.games,
          nextKickoff: room.feeds.nextKickoff,
          now: Date.now(),
        });
  if (interval === null) return;

  room.timer = setTimeout(() => void tick(room), interval);
  room.timer.unref?.();
}

async function tick(room: Room) {
  if (room.ticking) return;
  if (!rooms.has(room.key)) return;

  room.ticking = true;
  try {
    const previous = room.feeds;
    const feeds = await readWeekFeeds(room.season, room.week);
    if (!rooms.has(room.key)) return;

    if (feedsFailed(feeds)) {
      room.failures += 1;
      if (room.failures >= STALE_AFTER_FAILURES && !room.toldStale) {
        room.toldStale = true;
        emit(room, toRoomFrame({ type: "stale", error: "Sleeper's live feeds have stopped answering" }));
      }
      // Keep the last good feeds for the readers, and the cadence off them.
      schedule(room);
      return;
    }

    room.failures = 0;
    room.toldStale = false;
    room.feeds = feeds;

    // A moved feed re-solves everyone; an unmoved one re-solves only readers
    // whose stored lineups are due a re-read. Nothing is sent where the answer
    // did not change either way.
    const moved =
      feeds.signature !== previous.signature ||
      feeds.projections !== previous.projections ||
      feeds.statuses.projections !== previous.statuses.projections;

    for (const subscriber of [...room.subscribers]) {
      const rowsDue = Date.now() - subscriber.rowsAt >= LEAGUES_TTL_MS;
      if (rowsDue) await refreshRows(room, subscriber);
      if (!rooms.has(room.key)) return;
      if (!moved && !rowsDue) continue;
      deliver(room, subscriber);
    }

    schedule(room);
  } finally {
    room.ticking = false;
  }
}

/** Re-read one reader's stored lineups. A failed read keeps the last ones. */
async function refreshRows(room: Room, subscriber: Subscriber) {
  try {
    subscriber.rows = await getManagerWeekLineups(subscriber.userId, room.season, room.week);
  } catch (error) {
    console.warn(`[gametime] lineups re-read failed for ${subscriber.username} ${room.key}:`, error);
  } finally {
    subscriber.rowsAt = Date.now();
  }
}

function payloadFor(room: Room, subscriber: Subscriber): ManagerGametimePayload {
  return buildGametimePayload({
    season: room.season,
    week: room.week,
    leagues: subscriber.rows,
    feeds: room.feeds,
  });
}

/**
 * The payload's header — everything but the leagues, named field by field so
 * a field the payload grows has to be placed here before it rides a delta.
 */
function headerOf(payload: ManagerGametimePayload): Omit<ManagerGametimePayload, "leagues"> {
  return {
    season: payload.season,
    week: payload.week,
    projections: payload.projections,
    stats: payload.stats,
    scores: payload.scores,
    read_at: payload.read_at,
    games: payload.games,
    board: payload.board,
  };
}

/**
 * A reader's first frame: the whole payload, and the hold it is diffed
 * against from then on.
 */
function firstFrame(room: Room, subscriber: Subscriber): RoomFrame {
  const payload = payloadFor(room, subscriber);
  subscriber.held = diffLeagues(new Map(), payload.leagues).serialised;
  subscriber.heldHeader = JSON.stringify(headerOf(payload));
  return toRoomFrame({ type: "payload", payload });
}

/**
 * Solve for one reader and send **what moved**, or nothing.
 *
 * The header (statuses, the board, the read instant) rides every delta,
 * because the board is what moved; the leagues ride it only where their own
 * serialisation differs from the last one sent. A tick that moved neither
 * sends nothing at all, which is what makes a twenty-second cadence
 * reasonable on a page left open through a quiet afternoon.
 */
function deliver(room: Room, subscriber: Subscriber) {
  const payload = payloadFor(room, subscriber);
  const header = headerOf(payload);
  const headerJson = JSON.stringify(header);
  const diff = diffLeagues(subscriber.held, payload.leagues);
  if (diff.changed.length === 0 && diff.removed.length === 0 && headerJson === subscriber.heldHeader) {
    return;
  }
  subscriber.held = diff.serialised;
  subscriber.heldHeader = headerJson;

  const changed: Record<string, ManagerGametimePayload["leagues"][string]> = {};
  for (const id of diff.changed) changed[id] = payload.leagues[id];
  const delta: GametimeDelta = { ...header, leagues: changed, removed: diff.removed };

  try {
    subscriber.listener(toRoomFrame({ type: "delta", delta }));
  } catch {
    room.subscribers.delete(subscriber);
    if (room.subscribers.size === 0) close(room);
  }
}

/** Fan a room-wide message out — a listener that throws is dropped. */
function emit(room: Room, frame: RoomFrame) {
  for (const subscriber of [...room.subscribers]) {
    try {
      subscriber.listener(frame);
    } catch {
      room.subscribers.delete(subscriber);
    }
  }
  if (room.subscribers.size === 0) close(room);
}

/** Open rooms and their readers — for a log line or a test. */
export function gametimeRoomStats(): { weeks: number; subscribers: number } {
  let subscribers = 0;
  for (const room of rooms.values()) subscribers += room.subscribers.size;
  return { weeks: rooms.size, subscribers };
}
