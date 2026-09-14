/**
 * One Server-Sent Events stream over a room join — the mechanics both live
 * routes share, with the join, the reservation and the timers handed in.
 *
 * The two routes (`/api/user/[username]/gametime/stream` and
 * `/api/picktracker/[leagueId]/stream`) spelled this twice, and every rule in
 * it is one that renders perfectly while being wrong: a reservation released
 * on three of four exits, a subscriber seated for a reader who had already
 * gone, a heartbeat that outlived its socket. Spelled once and driven under
 * Node's own runner, each of those is a test rather than a paragraph.
 *
 * The mechanics themselves are the picktracker route's, unchanged:
 *
 * - **Bytes before the first `await`**, because Next flushes the response
 *   headers on the first chunk written and not when the `Response` is
 *   returned — until something is enqueued the browser's `EventSource` has not
 *   opened. The `retry:` line is that chunk, jittered so a dozen readers who
 *   lose one deploy do not all come back in the same three seconds.
 * - **A stalled consumer is refused droppable frames, then dropped.** `enqueue`
 *   never blocks; it grows a queue. A frame the strategy says is unwanted is
 *   refused (`send` answers `false`, which the gametime room reads as "this
 *   reader does not hold it"), and `maxUnread` refusals in a row is a reader
 *   who is not reading. A transition (`stale`, a terminal `error`) is never
 *   dropped.
 * - **A terminal failure says so before closing**, or `EventSource` reconnects
 *   into the same refusal a second apart for as long as the tab is open.
 * - **The heartbeat is not decoration**: it keeps a proxy's idle timeout off a
 *   correctly silent stream, and it is how a closed tab is noticed when no
 *   frame is due.
 *
 * **`onClose` fires exactly once, on every way out** — a join that failed or
 * threw, a request aborted before or after the join, the consumer cancelling
 * the stream, a terminal error, a stalled reader being dropped. It is where
 * the route hands its admission reservation back, and "exactly once" is the
 * whole of what makes the bound honest: a release missed on one path is a
 * slot leaked per disconnect, and a release doubled on another is a bound
 * that widens.
 *
 * **A reader who leaves during the join is not seated.** The abort listener
 * is registered before the join is awaited, and the join's answer is checked
 * against it afterwards: a room joined for a reader who has gone is left again
 * at once rather than held until the heartbeat finds the socket dead.
 */

/** A message already serialised for the wire, with its kind beside it. */
export type SseFrame = { type: string; json: string };

export type SseJoinResult<F extends SseFrame> =
  | {
      ok: true;
      /** Idempotent departure — see the room modules. */
      leave: () => void;
      /** A frame to send as soon as the reader is seated. */
      first?: F;
    }
  | { ok: false; error: string };

export type SseTimers = {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (timer: unknown) => void;
};

export type SseOptions<F extends SseFrame> = {
  /** The request's own signal — the reader going away. */
  signal: AbortSignal;
  /**
   * Seat the reader: hand the room a listener and get back its departure.
   * The listener answers whether the frame was taken, which a room may read
   * or ignore.
   */
  join: (send: (frame: F) => boolean) => Promise<SseJoinResult<F>>;
  /** Frame kinds a stalled consumer may be refused. */
  droppable: ReadonlySet<string>;
  /** The terminal `error` frame in this stream's own vocabulary. */
  terminal: (error: string) => F;
  /** Called exactly once when the stream is finished with, however it ended. */
  onClose: () => void;
  /** For the one log line a thrown join produces. */
  name: string;
  heartbeatMs?: number;
  maxUnread?: number;
  /** The `retry:` the browser is told, in ms. Jittered by default. */
  retryMs?: number;
  timers?: SseTimers;
  log?: Pick<Console, "error">;
};

/** How often a silent stream proves it is still there. */
export const HEARTBEAT_MS = 20_000;

/**
 * Consecutive refused frames before a stalled consumer is dropped — several
 * minutes of a reader that is not reading, well past the point its socket is
 * coming back.
 */
export const MAX_UNREAD = 20;

/** A reconnect delay of 3–6s, so a lost deploy is not a thundering herd. */
export function jitteredRetryMs(random: () => number = Math.random): number {
  return 3000 + Math.floor(random() * 3000);
}

/** The headers every SSE response here carries. */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  // Without this an nginx in front buffers the whole stream and nothing on
  // the page ever updates.
  "X-Accel-Buffering": "no",
} as const;

const realTimers: SseTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

export function sseStream<F extends SseFrame>(
  options: SseOptions<F>,
  strategy: QueuingStrategy<Uint8Array>,
): ReadableStream<Uint8Array> {
  const { signal, join, droppable, terminal, onClose, name } = options;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const maxUnread = options.maxUnread ?? MAX_UNREAD;
  const retryMs = options.retryMs ?? jitteredRetryMs();
  const timers = options.timers ?? realTimers;
  const log = options.log ?? console;

  const encoder = new TextEncoder();
  let closed = false;
  /** Set by `start`, called by `cancel` — one stream's teardown. */
  let teardown: (() => void) | null = null;
  let closedOnce = false;
  const closeOnce = () => {
    if (closedOnce) return;
    closedOnce = true;
    onClose();
  };

  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let leave: (() => void) | null = null;
        let beat: unknown = null;
        let unread = 0;

        const write = (chunk: string): boolean => {
          if (closed) return false;
          try {
            controller.enqueue(encoder.encode(chunk));
            return true;
          } catch {
            closed = true; // the client disconnected
            return false;
          }
        };

        const send = (frame: F): boolean => {
          const stalled = controller.desiredSize !== null && controller.desiredSize <= 0;
          if (stalled && droppable.has(frame.type)) {
            if ((unread += 1) >= maxUnread) finish();
            return false;
          }
          unread = 0;
          return write(`data: ${frame.json}\n\n`);
        };

        /** Idempotent on every path: stop the beat, leave the room, close once. */
        const finish = () => {
          if (beat !== null) {
            timers.clearInterval(beat);
            beat = null;
          }
          leave?.();
          leave = null;
          closeOnce();
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by a disconnect.
          }
        };
        teardown = finish;

        // A reader who was gone before the stream existed: an `abort` listener
        // on an already-aborted signal never fires, so it is asked directly.
        if (signal.aborted) {
          finish();
          return;
        }
        // Registered before the join is awaited, so a client that gives up
        // during the first read is not missed.
        signal.addEventListener("abort", finish, { once: true });

        write(`retry: ${retryMs}\n\n`);

        let joined: SseJoinResult<F>;
        try {
          joined = await join(send);
        } catch (error) {
          // A room that threw is a fault of ours; the reader is told the
          // stream is over rather than left to reconnect into it forever, and
          // the reservation goes back like any other ending.
          log.error(`[${name}] stream join threw:`, error);
          joined = { ok: false, error: "Live updates are unavailable" };
        }

        if (!joined.ok) {
          send(terminal(joined.error));
          finish();
          return;
        }

        // The reader may have gone during the join — a room opened for nobody
        // is left again at once, which is what closes it.
        if (closed || signal.aborted) {
          joined.leave();
          finish();
          return;
        }

        leave = joined.leave;
        if (joined.first !== undefined) send(joined.first);

        beat = timers.setInterval(() => {
          write(":\n\n");
          if (closed) finish();
        }, heartbeatMs);
        (beat as { unref?: () => void } | null)?.unref?.();
      },
      cancel() {
        teardown?.();
        closeOnce();
      },
    },
    strategy,
  );
}

/**
 * Hold an admission reservation across a route handler, releasing it on every
 * exit that does not end in a stream.
 *
 * A handler that answers a 400, a 404, a 503 or throws must hand its slot
 * back; one that returns a stream hands the slot to the stream, whose
 * `onClose` releases it. The handler says which by calling `streaming()`
 * before it returns the stream response. An abort before that point releases
 * the slot too — the reader has gone, and whatever the handler goes on to
 * build is for nobody.
 */
export async function withStreamReservation(
  reservation: { release: () => void },
  signal: AbortSignal,
  handler: (streaming: () => void) => Promise<Response>,
): Promise<Response> {
  let streaming = false;
  // Once here as well as in the reservation itself: the abort listener, the
  // non-streaming return and the throw are three paths that can each be the
  // first to run, and only one of them may count.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reservation.release();
  };
  if (signal.aborted) release();
  signal.addEventListener("abort", release, { once: true });
  try {
    const response = await handler(() => {
      streaming = true;
    });
    if (!streaming) release();
    return response;
  } catch (error) {
    release();
    throw error;
  } finally {
    // Once the stream owns the slot its own `onClose` releases it; the early
    // listener is only for the window before that.
    if (!streaming) signal.removeEventListener("abort", release);
  }
}
