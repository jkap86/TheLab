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
import { mapWithConcurrency } from "@/shared/util";

import { readWeekFeeds } from "./feeds";
import type { WeekFeeds } from "./feeds";
import { newDelivery, nextDelivery } from "./live-delivery";
import type { DeliveryState } from "./live-delivery";
import {
  FAILURE_INTERVAL_MS,
  feedsMoved,
  LINGER_MS,
  pollIntervalMs,
  ROW_REFRESH_CONCURRENCY,
  rowsDueAt,
  STALE_AFTER_FAILURES,
} from "./live-rules";
import { buildGametimePayload } from "./payload";

/** A message serialised once for the reader it is about to reach. */
export type RoomFrame = { type: GametimeStreamMessage["type"]; json: string };

/**
 * Hand a frame to one reader, and say whether it was **taken**.
 *
 * `false` is a frame the transport refused — a stalled socket dropping a
 * droppable payload, or a stream already closed. It is not an error and needs
 * no handling beyond the one thing that matters: the room must not then
 * believe the reader holds what it just tried to send. See
 * `./live-delivery` for what that buys.
 */
export type RoomListener = (frame: RoomFrame) => boolean;

export function toRoomFrame(message: GametimeStreamMessage): RoomFrame {
  return { type: message.type, json: JSON.stringify(message) };
}

/** Who is watching, and what the room has solved for them. */
type Subscriber = {
  userId: string;
  username: string;
  listener: RoomListener;
  /** Their stored lineups, and when they are next due a re-read. */
  rows: ManagerWeekLineupRow[];
  rowsDueAt: number;
  /** A re-read in flight, so a slow one is never started twice. */
  refreshing: boolean;
  /**
   * What this reader is known to **hold** — the last frame they actually took,
   * never the last one offered. See `./live-delivery`, which owns every rule
   * about it.
   */
  delivery: DeliveryState;
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
  | { ok: true; leave: () => void }
  | { ok: false; status: 500 | 502; error: string };

/**
 * Join (or open) the room for a week, as one reader.
 *
 * The room's first feed read is shared between simultaneous cold joiners on
 * the picktracker's terms; the reader's own Postgres read is theirs alone and
 * is what a failed join reports. `leave` is idempotent, for the reason that
 * file gives: a stream is torn down by two different disconnects and either
 * may fire first.
 *
 * **The first frame goes out through the listener rather than back to the
 * caller**, which is what makes the whole delivery contract one path. It used
 * to be returned for the route to write, and the room stamped its baseline as
 * it built it — so a first payload the socket refused left the reader holding
 * nothing while the room believed they held the week, and every delta after it
 * folded onto an answer that was never there. Sent through {@link deliver} it
 * is a frame like any other: the baseline moves only if it lands, and until
 * one does, the next frame is a full payload again.
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
    rowsDueAt: rowsDueAt(Date.now(), Math.random()),
    refreshing: false,
    delivery: newDelivery(),
  };

  if (room.linger !== null) {
    clearTimeout(room.linger);
    room.linger = null;
  }
  room.subscribers.add(subscriber);

  const leave = leaver(room, subscriber);
  deliver(room, subscriber);

  return { ok: true, leave };
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

    // A `stale` note is a claim about the feeds rather than about any league,
    // so nothing else on this wire ever takes it back off the page: the
    // recovery frame has to be forced, because the values behind it may well
    // have come back unchanged.
    const recovered = room.toldStale;
    room.failures = 0;
    room.toldStale = false;
    room.feeds = feeds;

    // A moved feed re-solves everyone; an unmoved one re-solves only readers
    // whose stored lineups have just been re-read. Nothing is sent where the
    // answer did not change either way.
    const moved = feedsMoved(previous, feeds);

    const subscribers = [...room.subscribers];
    const due = subscribers.filter(
      (subscriber) => !subscriber.refreshing && Date.now() >= subscriber.rowsDueAt,
    );
    await refreshDue(room, due);
    if (!rooms.has(room.key)) return;

    const refreshed = new Set(due);
    for (const subscriber of subscribers) {
      if (!room.subscribers.has(subscriber)) continue;
      if (!moved && !recovered && !refreshed.has(subscriber)) continue;
      deliver(room, subscriber, recovered);
    }

    // A delivery whose listener threw can close the room out from under the
    // walk; arming a timer on a closed one is harmless and pointless.
    if (rooms.has(room.key)) schedule(room);
  } finally {
    room.ticking = false;
  }
}

/**
 * Re-read the stored lineups of every reader that is due one.
 *
 * **Bounded, and neither of the two shapes it replaces.** The loop was serial
 * and awaited inside the delivery walk, so a kickoff crowd whose TTLs had
 * converged made one tick a queue of round trips with every reader's frame
 * behind it; `Promise.all` is the other failure, a fan-out as wide as the
 * room is popular with each branch holding a pool connection.
 * `ROW_REFRESH_CONCURRENCY` is the middle, and the refresh happens *before*
 * the walk so nobody's frame waits on somebody else's database read.
 *
 * **One reader's failure is theirs alone.** The read is caught per subscriber,
 * their last good rows stand, and the deadline moves anyway — a failing read
 * retried every tick is the hammering the interval exists to prevent, and the
 * page says `stale` for its own reasons long before a lineup three minutes old
 * matters.
 */
async function refreshDue(room: Room, due: readonly Subscriber[]) {
  if (due.length === 0) return;
  await mapWithConcurrency([...due], ROW_REFRESH_CONCURRENCY, async (subscriber) => {
    await refreshRows(room, subscriber);
  });
}

/** Re-read one reader's stored lineups. A failed read keeps the last ones. */
async function refreshRows(room: Room, subscriber: Subscriber) {
  subscriber.refreshing = true;
  try {
    subscriber.rows = await getManagerWeekLineups(subscriber.userId, room.season, room.week);
  } catch (error) {
    console.warn(`[gametime] lineups re-read failed for ${subscriber.username} ${room.key}:`, error);
  } finally {
    subscriber.refreshing = false;
    // Jittered, so a room everybody joined at kickoff does not land every
    // reader's re-read on one tick for the rest of the afternoon.
    subscriber.rowsDueAt = rowsDueAt(Date.now(), Math.random());
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
 * Solve for one reader and send **what moved**, or nothing.
 *
 * The header (statuses, the board, the read instant) rides every delta,
 * because the board is what moved; the leagues ride it only where their own
 * serialisation differs from the last one the reader *took*. A tick that moved
 * neither sends nothing at all, which is what makes a twenty-second cadence
 * reasonable on a page left open through a quiet afternoon.
 *
 * **The baseline moves only on a frame that was accepted.** A stalled socket
 * drops a payload or a delta (see the stream route), and advancing the hold
 * for one of those is how a reader ends up folding a `B → C` delta onto a week
 * still at `A` — a page that renders perfectly and is wrong in a handful of
 * leagues, with nothing anywhere to say so. Left where it was, the next delta
 * is computed against `A` and carries everything since, which is both correct
 * and *cheaper* than the full resend a dropped frame would otherwise trigger
 * — on precisely the connection that has just proved it cannot take one.
 * `./live-delivery` holds the rule and its test drives it.
 */
function deliver(room: Room, subscriber: Subscriber, force = false) {
  const payload = payloadFor(room, subscriber);
  const header = headerOf(payload);
  const headerJson = JSON.stringify(header);
  const next = nextDelivery(subscriber.delivery, headerJson, payload.leagues, force);
  if (next.kind === "none") return;

  let frame: RoomFrame;
  if (next.kind === "payload") {
    frame = toRoomFrame({ type: "payload", payload });
  } else {
    const changed: Record<string, ManagerGametimePayload["leagues"][string]> = {};
    for (const id of next.changed) changed[id] = payload.leagues[id];
    const delta: GametimeDelta = { ...header, leagues: changed, removed: next.removed };
    frame = toRoomFrame({ type: "delta", delta });
  }

  let accepted: boolean;
  try {
    accepted = subscriber.listener(frame);
  } catch {
    room.subscribers.delete(subscriber);
    if (room.subscribers.size === 0) close(room);
    return;
  }
  if (accepted) subscriber.delivery = next.commit;
}

/** Fan a room-wide message out — a listener that throws is dropped. */
function emit(room: Room, frame: RoomFrame) {
  for (const subscriber of [...room.subscribers]) {
    try {
      // A transition is never droppable, so what the listener answers here is
      // of no interest — only that it did not throw.
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
