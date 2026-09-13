/**
 * One shared feed poller per NFL week, and a solve per reader of it — the
 * room itself, with everything it reaches (Sleeper, Postgres, the clock, the
 * timers) handed in.
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
 * **Why the dependencies are arguments**, on `sleeper/request.ts`' terms: the
 * wiring in `./live` reaches `@/shared/manager`, `@/shared/sleeper` and the
 * feed reader through aliases Node's own runner cannot resolve, so for as
 * long as the timers and the subscriber sets lived beside those imports the
 * only thing a test could say about the room was what its source text
 * contained. Every decision in here renders perfectly while being wrong — a
 * poller that stopped on an unread week, a timer armed on a room that had
 * closed — so `live-room.test.ts` drives this module with a scripted feed
 * reader and scripted timers, and `./live` is left as the wiring that names
 * the real ones. Nothing about the delivery contract, the shared feed read or
 * the bounded row re-reads moved; only where the seams are.
 */
import type {
  GametimeDelta,
  GametimeStreamMessage,
  ManagerGametimePayload,
} from "@/shared/contract";
import type { ManagerWeekLineupRow } from "@/shared/manager";

import { mapWithConcurrency } from "../util/concurrency.ts";
import type { WeekFeeds } from "./feeds.ts";
import { newDelivery, nextDelivery } from "./live-delivery.ts";
import type { DeliveryState } from "./live-delivery.ts";
import {
  feedsFailed,
  feedsIncomplete,
  feedsMoved,
  LINGER_MS,
  ROW_REFRESH_CONCURRENCY,
  rowsDueAt,
  settledSince,
  STALE_AFTER_FAILURES,
  tickIntervalMs,
} from "./live-rules.ts";

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

/** A timer handle, whatever made it — the real one carries `unref`. */
export type RoomTimer = ReturnType<typeof setTimeout>;

/**
 * What a room reaches, named so a test can hand in each.
 *
 * `readFeeds` is expected to arrive **already scoped as background Sleeper
 * traffic** — see `./live`, which is where that argument is made and the
 * scope declared, once, in front of every read the room will ever make.
 */
export type RoomDeps = {
  readFeeds: (season: string, week: number) => Promise<WeekFeeds>;
  readRows: (userId: string, season: string, week: number) => Promise<ManagerWeekLineupRow[]>;
  buildPayload: (input: {
    season: string;
    week: number;
    leagues: ManagerWeekLineupRow[];
    feeds: WeekFeeds;
  }) => ManagerGametimePayload;
  now: () => number;
  random: () => number;
  setTimeout: (callback: () => void, ms: number) => RoomTimer;
  clearTimeout: (timer: RoomTimer) => void;
  log: Pick<Console, "log" | "warn" | "error">;
};

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
  ctx: RoomContext;
  key: string;
  season: string;
  week: number;
  subscribers: Set<Subscriber>;
  feeds: WeekFeeds;
  timer: RoomTimer | null;
  ticking: boolean;
  /** Consecutive reads on which both live feeds failed — the stale note's count. */
  failures: number;
  toldStale: boolean;
  /**
   * When the current run of healthy, all-final reads began, or null — the
   * finalization policy's whole state. See `live-rules`' `settledSince`.
   */
  settledSince: number | null;
  linger: RoomTimer | null;
};

/**
 * The open rooms and the first reads in flight — held apart from the deps so
 * the wiring can keep them on `globalThis` across a dev-server re-evaluation
 * (see `./live`) while a test makes a fresh one per case.
 */
export type RoomRegistry = {
  rooms: Map<string, Room>;
  /** First feed reads in flight, so simultaneous cold joiners share one. */
  openings: Map<string, Promise<Room>>;
};

export function newRoomRegistry(): RoomRegistry {
  return { rooms: new Map(), openings: new Map() };
}

type RoomContext = { deps: RoomDeps; registry: RoomRegistry };

export type JoinResult =
  | { ok: true; leave: () => void }
  | { ok: false; status: 500 | 502; error: string };

export type JoinInput = { userId: string; username: string; season: string; week: number };

/** The rooms of one process, bound to what they reach. */
export type GametimeRooms = {
  join: (input: JoinInput, listener: RoomListener) => Promise<JoinResult>;
  /** Open rooms and their readers — for a log line or a test. */
  stats: () => { weeks: number; subscribers: number };
};

export function gametimeRooms(registry: RoomRegistry, deps: RoomDeps): GametimeRooms {
  const ctx: RoomContext = { deps, registry };
  return {
    join: (input, listener) => joinGametime(ctx, input, listener),
    stats: () => {
      let subscribers = 0;
      for (const room of registry.rooms.values()) subscribers += room.subscribers.size;
      return { weeks: registry.rooms.size, subscribers };
    },
  };
}

/**
 * Whether this room is still the one its key names. **Identity, not
 * presence**: a room that closed while a tick was awaiting its read can find
 * a *new* room under the same key by the time it resumes, and a check that
 * asked only whether the key was present would then arm the old room's timer
 * again — a poller nothing points at, ticking a week for nobody until the
 * process dies. Every path that resumes after an `await`, and every path that
 * arms a timer, asks this.
 */
function isOpen(room: Room): boolean {
  return room.ctx.registry.rooms.get(room.key) === room;
}

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
async function joinGametime(
  ctx: RoomContext,
  input: JoinInput,
  listener: RoomListener,
): Promise<JoinResult> {
  const { rooms, openings } = ctx.registry;
  const key = `${input.season}:${input.week}`;

  let room = rooms.get(key);
  if (!room) {
    let opening = openings.get(key);
    if (!opening) {
      opening = openRoom(ctx, key, input.season, input.week);
      openings.set(key, opening);
    }
    // **Deliberately not bounded by the joining reader's budget**, which is the
    // one shared promise in this app that `sleeper/shared-wait`'s waiter rule
    // is not applied to, and the reason is where this runs. By the time a
    // `start` callback is executing the response has already been returned, so
    // there is no platform deadline left to protect: what a bounded wait would
    // buy is a reader told "no" after twelve seconds instead of a first frame
    // after fifteen, and what it would cost is a reconnect into the same cold
    // open. The read behind it is background (see `./live`), so nothing about
    // the *producer* half is skipped — only the patience.
    room = await opening;
  }

  let rows: ManagerWeekLineupRow[];
  try {
    rows = await ctx.deps.readRows(input.userId, input.season, input.week);
  } catch (error) {
    ctx.deps.log.error(`[gametime] lineups unavailable for ${input.username} ${key}:`, error);
    return { ok: false, status: 500, error: "Failed to load lineups" };
  }

  // The room may have closed during the read — a linger that ran out with
  // nobody in it. Re-open rather than seat a reader in a room nothing ticks.
  if (!isOpen(room)) {
    return joinGametime(ctx, input, listener);
  }

  const subscriber: Subscriber = {
    userId: input.userId,
    username: input.username,
    listener,
    rows,
    rowsDueAt: rowsDueAt(ctx.deps.now(), ctx.deps.random()),
    refreshing: false,
    delivery: newDelivery(),
  };

  if (room.linger !== null) {
    ctx.deps.clearTimeout(room.linger);
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
 * Never fails: the feed reader degrades per feed rather than throwing, and a
 * room whose first read answered nothing is a room whose readers are told the
 * feeds are down and which keeps trying at the failure cadence.
 *
 * **The finalization state is folded from the first read like any other.** A
 * reader joining a week that already reads all-final with a feed down gets a
 * room that keeps retrying rather than one that stopped on the read it could
 * not trust — which is exactly the tick's own rule, applied to the read that
 * opened the room. See `live-rules`' `tickIntervalMs`.
 */
async function openRoom(
  ctx: RoomContext,
  key: string,
  season: string,
  week: number,
): Promise<Room> {
  const { deps, registry } = ctx;
  try {
    const feeds = await deps.readFeeds(season, week);
    const room: Room = {
      ctx,
      key,
      season,
      week,
      subscribers: new Set(),
      feeds,
      timer: null,
      ticking: false,
      failures: feedsFailed(feeds.statuses) ? 1 : 0,
      toldStale: false,
      settledSince: settledSince(null, {
        games: feeds.games,
        incomplete: feedsIncomplete(feeds.statuses),
        now: deps.now(),
      }),
      linger: null,
    };
    registry.rooms.set(key, room);
    schedule(room);
    scheduleTeardown(room);
    deps.log.log(
      `[gametime] room open ${key} (${feeds.games.live} live, ${feeds.games.pre} to come, ${feeds.games.final} final)`,
    );
    return room;
  } finally {
    registry.openings.delete(key);
  }
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
  const timer = room.ctx.deps.setTimeout(() => {
    room.linger = null;
    if (room.subscribers.size > 0) return;
    if (!isOpen(room)) return;
    close(room);
  }, LINGER_MS);
  timer.unref?.();
  room.linger = timer;
}

function close(room: Room) {
  room.ctx.registry.rooms.delete(room.key);
  room.ctx.deps.log.log(`[gametime] room closed ${room.key}`);
  if (room.timer !== null) {
    room.ctx.deps.clearTimeout(room.timer);
    room.timer = null;
  }
  if (room.linger !== null) {
    room.ctx.deps.clearTimeout(room.linger);
    room.linger = null;
  }
}

/**
 * Arm the next tick, or stop.
 *
 * The cadence is `tickIntervalMs`'s, which is the board's own while a game is
 * still to be played (the live rate while one runs, the time to the next
 * kickoff while games are still to come) and the finalization policy's once
 * every game is final: a bounded run of settling reads while the feeds are
 * healthy, the failure cadence for as long as one of them is not, and nothing
 * at all once the run has settled — the stream stays open holding the final
 * numbers, which is the honest end state.
 *
 * **Never armed on a room that has closed.** A tick resumes here after its
 * read, and a room can close under an in-flight read; a timer armed then is
 * a poller nobody can stop.
 */
function schedule(room: Room) {
  const { deps } = room.ctx;
  if (room.timer !== null) deps.clearTimeout(room.timer);
  room.timer = null;
  if (!isOpen(room)) return;

  const interval = tickIntervalMs({
    failures: room.failures,
    games: room.feeds.games,
    nextKickoff: room.feeds.nextKickoff,
    now: deps.now(),
    incomplete: feedsIncomplete(room.feeds.statuses),
    settledSince: room.settledSince,
  });
  if (interval === null) return;

  room.timer = deps.setTimeout(() => void tick(room), interval);
  room.timer.unref?.();
}

async function tick(room: Room) {
  if (room.ticking) return;
  if (!isOpen(room)) return;

  room.ticking = true;
  try {
    const previous = room.feeds;
    const feeds = await room.ctx.deps.readFeeds(room.season, room.week);
    if (!isOpen(room)) return;

    if (feedsFailed(feeds.statuses)) {
      room.failures += 1;
      if (room.failures >= STALE_AFTER_FAILURES && !room.toldStale) {
        room.toldStale = true;
        emit(room, toRoomFrame({ type: "stale", error: "Sleeper's live feeds have stopped answering" }));
      }
      // A read that failed whole breaks any run of trustworthy ones: the
      // finalization window restarts from the next healthy read.
      room.settledSince = null;
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
    room.settledSince = settledSince(room.settledSince, {
      games: feeds.games,
      incomplete: feedsIncomplete(feeds.statuses),
      now: room.ctx.deps.now(),
    });

    // A moved feed re-solves everyone; an unmoved one re-solves only readers
    // whose stored lineups have just been re-read. Nothing is sent where the
    // answer did not change either way.
    const moved = feedsMoved(previous, feeds);

    const subscribers = [...room.subscribers];
    const now = room.ctx.deps.now();
    const due = subscribers.filter(
      (subscriber) => !subscriber.refreshing && now >= subscriber.rowsDueAt,
    );
    await refreshDue(room, due);
    if (!isOpen(room)) return;

    const refreshed = new Set(due);
    for (const subscriber of subscribers) {
      if (!room.subscribers.has(subscriber)) continue;
      if (!moved && !recovered && !refreshed.has(subscriber)) continue;
      deliver(room, subscriber, recovered);
    }

    // A delivery whose listener threw can close the room out from under the
    // walk; `schedule` refuses a closed room for itself.
    schedule(room);
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
  const { deps } = room.ctx;
  subscriber.refreshing = true;
  try {
    subscriber.rows = await deps.readRows(subscriber.userId, room.season, room.week);
  } catch (error) {
    deps.log.warn(`[gametime] lineups re-read failed for ${subscriber.username} ${room.key}:`, error);
  } finally {
    subscriber.refreshing = false;
    // Jittered, so a room everybody joined at kickoff does not land every
    // reader's re-read on one tick for the rest of the afternoon.
    subscriber.rowsDueAt = rowsDueAt(deps.now(), deps.random());
  }
}

function payloadFor(room: Room, subscriber: Subscriber): ManagerGametimePayload {
  return room.ctx.deps.buildPayload({
    season: room.season,
    week: room.week,
    leagues: subscriber.rows,
    feeds: room.feeds,
  });
}

/**
 * The payload's header — everything but its two diffed collections, named
 * field by field so a field the payload grows has to be placed here before it
 * rides a delta.
 *
 * `leagues` and `players` are both absent, and for one reason: each is diffed
 * against what the reader holds rather than re-sent whole. The header is
 * re-serialised on every tick — `read_at` moves whether or not anything else
 * does — so anything named here is carried in full to every reader on every
 * frame. See `./live-delivery`.
 */
function headerOf(
  payload: ManagerGametimePayload,
): Omit<ManagerGametimePayload, "leagues" | "players"> {
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
 * The header (statuses, the scoreboard, the read instant) rides every delta,
 * because the scoreboard is what moved; the leagues and the week's stat lines
 * ride it only where their own serialisation differs from the last one the
 * reader *took*. A tick that moved none of them sends nothing at all, which is
 * what makes a twenty-second cadence reasonable on a page left open through a
 * quiet afternoon.
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
  const next = nextDelivery(
    subscriber.delivery,
    headerJson,
    payload.leagues,
    payload.players,
    force,
  );
  if (next.kind === "none") return;

  let frame: RoomFrame;
  if (next.kind === "payload") {
    frame = toRoomFrame({ type: "payload", payload });
  } else {
    const changed: Record<string, ManagerGametimePayload["leagues"][string]> = {};
    for (const id of next.changed) changed[id] = payload.leagues[id];
    const players: Record<string, ManagerGametimePayload["players"][string]> = {};
    for (const id of next.players.changed) players[id] = payload.players[id];
    const delta: GametimeDelta = {
      ...header,
      leagues: changed,
      removed: next.removed,
      players,
      removed_players: next.players.removed,
    };
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
