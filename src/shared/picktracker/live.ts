/**
 * One shared Sleeper poller per league, fanned out to every viewer of it.
 *
 * **The tool is meant to be pasted into a league chat mid-draft**, so the
 * common case is a dozen people opening the same URL at once. A poll per
 * viewer would be a dozen Sleeper fan-outs for one draft; a poll per *league*
 * is one, however many are watching. That is the whole reason this module
 * exists rather than a `setInterval` in the browser — and the second reason is
 * that a background tab throttles its timers to about once a minute, which is
 * the same argument the lineup checker's Sync key makes against a client-side
 * countdown.
 *
 * Sleeper has no push API of its own: the documented API is read-only REST, so
 * something has to poll, and this is the cheapest honest place to put it. A
 * tick is two requests (`retrackPlaceholderDraft`), so a room costs 8 requests
 * a minute against the 1000 Sleeper documents.
 *
 * **The registry is cached on `globalThis`**, the arrangement `sleeper/limiter`
 * already uses, for its reason plus one of this module's own: under `next dev`
 * a module edit re-evaluates this file, and a fresh `Map` would strand every
 * live room's timer with nothing pointing at it — a poller nobody can stop and
 * nobody is reading.
 */
import type {
  PicktrackerPayload,
  PicktrackerStreamMessage,
} from "@/shared/contract";

import {
  boardSignature,
  pollIntervalMs,
  FAILURE_INTERVAL_MS,
  STALE_AFTER_FAILURES,
} from "./live-rules";
import { toPicktrackerPayload } from "./payload";
import { retrackPlaceholderDraft, trackPlaceholderDraft } from "./track";
import type { PicktrackerContext } from "./track";

/** What a subscriber is handed. */
export type RoomListener = (message: PicktrackerStreamMessage) => void;

type Room = {
  leagueId: string;
  subscribers: Set<RoomListener>;
  context: PicktrackerContext;
  timer: ReturnType<typeof setTimeout> | null;
  /** A tick is in flight — the re-entry guard. */
  ticking: boolean;
  /** The last state pushed, per `boardSignature`. */
  signature: string;
  /** The draft status the last tick observed. */
  status: string;
  /**
   * The held {@link PicktrackerContext} was read at a status that has since
   * changed, so the next tick must read it whole again.
   *
   * **The context is immutable *during* a draft, not immutable.** Before one
   * starts, `draft_order` is unset, a commissioner can still change the
   * league's size, and members are still joining — so `teams` and `users` are
   * both live. Holding the first read forever would label every pick against a
   * team count from before the order was set and drop any manager who joined
   * since, with nothing on screen saying so.
   */
  contextStale: boolean;
  /** Consecutive failed ticks. */
  failures: number;
  /** Whether the readers have already been told the board stopped moving. */
  toldStale: boolean;
  /** Replayed to a joiner, so the twelfth reader does not stare at nothing. */
  last: PicktrackerPayload;
  /** Armed when the last reader leaves — see {@link scheduleTeardown}. */
  linger: ReturnType<typeof setTimeout> | null;
};

/**
 * How long a room keeps polling after its last reader leaves.
 *
 * Not politeness — it pays for itself three times. React's StrictMode double
 * mount takes the count 1 -> 0 -> 1 within a turn, so without it every page
 * load in development costs two four-call reads and throws the first board
 * away. A reader navigating inside the app does the same. And a dozen people
 * opening one chat link over a minute pay for one cold read instead of twelve.
 *
 * The cost is stated exactly: at most thirty seconds of polling with nobody
 * watching, per league.
 */
const LINGER_MS = 30_000;

/**
 * The two maps, together on one global entry.
 *
 * Together because they are one piece of state: an `openings` that duplicated
 * while `rooms` did not would let two module copies each open a room for one
 * league — the very fan-in this file exists to provide, lost silently.
 */
type Registry = {
  rooms: Map<string, Room>;
  /** First reads in flight, so simultaneous cold joiners share one. */
  openings: Map<string, Promise<Room | Extract<JoinResult, { ok: false }>>>;
};

const REGISTRY_KEY = Symbol.for("thelab.picktracker.registry");

const globalForRooms = globalThis as unknown as {
  [key: symbol]: Registry | undefined;
};

const registry: Registry = (globalForRooms[REGISTRY_KEY] ??= {
  rooms: new Map(),
  openings: new Map(),
});

const { rooms, openings } = registry;

/** A room's first read failed — the caller has a status to answer with. */
export type JoinResult =
  | { ok: true; payload: PicktrackerPayload; leave: () => void }
  | { ok: false; status: 404 | 502; error: string };

/**
 * Join (or open) the room for a league, and get the board as it stands now.
 *
 * The returned `leave` is **idempotent**, which is load-bearing rather than
 * defensive: a stream is torn down by both `request.signal` and the underlying
 * source's `cancel`, they fire on different disconnects and either may fire
 * first. A second `leave` that decremented again would drop a room out from
 * under the readers still in it — the same failure `Limiter.tryAcquire`'s
 * release guards against, where a doubled release does not merely miscount.
 */
export async function joinRoom(
  leagueId: string,
  listener: RoomListener,
): Promise<JoinResult> {
  const existing = rooms.get(leagueId);
  if (existing) return rejoin(existing, listener);

  // **The in-flight open is shared, and this is the feature's core claim.**
  // Looking the room up, missing, and *then* awaiting a four-call read would
  // have every simultaneous cold joiner run its own — and simultaneous cold
  // joiners are precisely this tool's use case, a dozen people opening one
  // link out of a league chat at once. Registering the promise before the
  // await, with nothing between the miss and the insert, is what makes that
  // one read instead of twelve. Re-checking `rooms` afterwards would only
  // deduplicate the *room*, never the Sleeper work already spent.
  let opening = openings.get(leagueId);
  if (!opening) {
    opening = openRoom(leagueId);
    openings.set(leagueId, opening);
  }

  const opened = await opening;
  // `Room` carries no `ok`, so its presence is the discriminant.
  if ("ok" in opened) return opened;
  return rejoin(opened, listener);
}

/**
 * The four-call first read, and the room it produces.
 *
 * Its failure is terminal, which is the one place this differs from a tick:
 * without a league and a draft there is nothing to label picks with, so the
 * caller answers a status rather than opening an empty room.
 *
 * **The room is born with no subscribers**, because it is shared: every joiner
 * — the one that opened it and any that queued behind the same promise — adds
 * itself through `rejoin` afterwards, on one path rather than two. A room that
 * seats its opener here would seat only the first of them.
 */
async function openRoom(
  leagueId: string,
): Promise<Room | Extract<JoinResult, { ok: false }>> {
  try {
    const first = await trackPlaceholderDraft(leagueId);
    if (!first.ok) return first;

    const payload = toPicktrackerPayload(first);
    const room: Room = {
      leagueId,
      subscribers: new Set(),
      context: first.context,
      timer: null,
      ticking: false,
      signature: boardSignature({
        draft_status: first.draft_status,
        last_picked: first.last_picked,
        pickCount: first.picks.length,
      }),
      status: first.draft_status,
      contextStale: false,
      failures: 0,
      toldStale: false,
      last: payload,
      linger: null,
    };
    rooms.set(leagueId, room);
    schedule(room, first.draft_status);
    // Armed immediately, and cancelled by the first `rejoin` a moment later.
    // It is the backstop for a room whose only joiner went away between the
    // read landing and its seat being taken — without it that room polls with
    // nobody watching for as long as the process lives.
    scheduleTeardown(room);
    console.log(
      `[picktracker] room open ${leagueId} (${first.draft_status}, ${first.picks.length} picks)`,
    );
    return room;
  } finally {
    // Cleared however it settled, so a failed open is retried by the next
    // reader rather than being remembered — `board-read.ts`'s rule that a
    // rejection is evicted rather than cached, at a different grain.
    openings.delete(leagueId);
  }
}

/**
 * Join a room that already exists.
 *
 * **The linger is cancelled before the subscriber is added**, not after: a
 * timer firing between the two would tear down a room that has just been
 * joined, and the reader would hold a board nothing is refreshing.
 */
function rejoin(room: Room, listener: RoomListener): JoinResult {
  if (room.linger !== null) {
    clearTimeout(room.linger);
    room.linger = null;
  }
  room.subscribers.add(listener);
  return { ok: true, payload: room.last, leave: leaver(room, listener) };
}

/** The idempotent departure, closed over one subscriber. */
function leaver(room: Room, listener: RoomListener): () => void {
  let left = false;
  return () => {
    if (left) return;
    left = true;
    room.subscribers.delete(listener);
    if (room.subscribers.size === 0) scheduleTeardown(room);
  };
}

/**
 * Arm a room's teardown rather than performing one — see {@link LINGER_MS}.
 *
 * The timer re-checks `subscribers.size`, which is belt to `rejoin`'s braces,
 * and it only deletes the registry entry **if it is still this room's**. A room
 * re-created for the same league while the timer was armed is not this one's to
 * evict, and evicting it would leave a live poller nothing can find or stop.
 */
function scheduleTeardown(room: Room) {
  if (room.linger !== null) return;
  const timer = setTimeout(() => {
    room.linger = null;
    if (room.subscribers.size > 0) return;
    if (rooms.get(room.leagueId) !== room) return;
    close(room);
  }, LINGER_MS);
  timer.unref?.();
  room.linger = timer;
}

/**
 * Tear a room down.
 *
 * Deleted from the registry *and* its timer cleared, in that order, so a tick
 * that is mid-flight cannot reschedule a room nobody holds: `tick` re-reads the
 * registry before scheduling and finds itself gone.
 */
function close(room: Room) {
  rooms.delete(room.leagueId);
  console.log(`[picktracker] room closed ${room.leagueId}`);
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
 * `setTimeout` chained per tick rather than a `setInterval`, because the
 * cadence is a function of the draft's own status and changes underneath us
 * when it starts and when it ends. **`startBackgroundLoop` is deliberately not
 * reused here**: it is a fixed interval, and its guard is a `Set` of
 * app-lifetime loop *names* where a room is ephemeral and keyed by league.
 * Teaching it a variable interval and a per-key lifecycle is most of what it
 * does — that would be a fork wearing a shared name.
 */
function schedule(room: Room, draftStatus: string) {
  if (room.timer !== null) clearTimeout(room.timer);
  room.timer = null;

  const interval =
    room.failures > 0 ? FAILURE_INTERVAL_MS : pollIntervalMs(draftStatus);
  // A complete draft stops the poller outright. The stream stays open holding a
  // board that will not change, which is the honest end state.
  if (interval === null) return;

  room.timer = setTimeout(() => void tick(room), interval);
  // Node keeps the process alive for a pending timer; a draft room is not a
  // reason to hold a shutdown open.
  room.timer.unref?.();
}

async function tick(room: Room) {
  // Re-entry guard. A slow Sleeper response outruns a 15-second interval, and
  // two ticks in flight would race to write one `signature` — the later answer
  // could land first and a real pick would be swallowed as "no change".
  if (room.ticking) return;
  // Torn down while the timer was pending.
  if (!rooms.has(room.leagueId)) return;

  room.ticking = true;
  try {
    // **Two arms, both about a context that is not yet settled.** A
    // `pre_draft` draft has no final team count, no draft order and a
    // membership that is still changing, so its context is re-read every tick
    // — which it can afford, because that status polls four times slower. And
    // a status that changed under a cheap tick re-reads once, because the
    // transition is the moment the order and the size become final.
    const full = room.contextStale || room.status === "pre_draft";
    const result = full
      ? await trackPlaceholderDraft(room.leagueId)
      : await retrackPlaceholderDraft(room.context);

    // Every path below re-checks: the last reader can leave during the await,
    // and a room that closed mid-tick must not be rescheduled.
    if (!rooms.has(room.leagueId)) return;

    if (!result.ok) {
      room.failures += 1;
      if (room.failures >= STALE_AFTER_FAILURES && !room.toldStale) {
        room.toldStale = true;
        // A note beside a usable board, never an `error` — the reader keeps
        // what they have. Reporting this as terminal would close the stream on
        // a blip and blank a board that is merely a minute behind.
        emit(room, { type: "stale", error: result.error });
      }
      schedule(room, room.last.draft_status);
      return;
    }

    room.failures = 0;
    if (room.toldStale) room.toldStale = false;

    room.context = result.context;
    // A full read just refreshed it; a cheap read that saw the status move
    // leaves it describing a draft that has since become final.
    room.contextStale = full ? false : result.draft_status !== room.status;
    room.status = result.draft_status;

    const signature = boardSignature({
      draft_status: result.draft_status,
      last_picked: result.last_picked,
      pickCount: result.picks.length,
    });

    // **Nothing is sent when nothing changed**, which is what makes a
    // 15-second cadence reasonable on a page left open for three hours: an
    // idle draft costs no wire traffic and no re-renders at all.
    if (signature !== room.signature) {
      room.signature = signature;
      room.last = toPicktrackerPayload(result);
      emit(room, { type: "board", payload: room.last });
    }

    schedule(room, result.draft_status);
  } finally {
    room.ticking = false;
  }
}

/**
 * Fan a message out.
 *
 * A listener that throws is dropped rather than allowed to take the room's
 * other readers down with it — a closed stream whose `enqueue` throws is the
 * ordinary way this happens, and its own `leave` may not have run yet.
 */
function emit(room: Room, message: PicktrackerStreamMessage) {
  for (const listener of [...room.subscribers]) {
    try {
      listener(message);
    } catch {
      room.subscribers.delete(listener);
    }
  }
  if (room.subscribers.size === 0) close(room);
}

/** Open rooms and their sizes — for a log line or a test. */
export function roomStats(): { leagues: number; subscribers: number } {
  let subscribers = 0;
  for (const room of rooms.values()) subscribers += room.subscribers.size;
  return { leagues: rooms.size, subscribers };
}
