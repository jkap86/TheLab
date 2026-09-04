import { NextResponse } from "next/server";

import type { ApiErrorPayload, PicktrackerStreamMessage } from "@/shared/contract";
import { joinRoom } from "@/shared/picktracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often a silent stream proves it is still there. */
const HEARTBEAT_MS = 20_000;

/**
 * How many consecutive writes a stalled consumer may refuse before it is
 * dropped.
 *
 * `enqueue` never blocks — it grows an internal queue — so a reader that has
 * stopped draining (a suspended phone, a tab on a dead link) would otherwise
 * accumulate boards forever *and* pin the room's poller open by never
 * releasing its subscription. Twenty refusals is several minutes of a consumer
 * that is not reading, which is long past the point its socket is coming back.
 */
const MAX_UNREAD = 20;

/**
 * How many frames may sit unread before the consumer counts as stalled.
 *
 * **A queuing strategy is required for `desiredSize` to mean anything here.** A
 * `ReadableStream` built with no strategy gets a count-based high-water mark of
 * **one**, so `desiredSize` drops to 0 the instant a single chunk is queued and
 * has not yet been pulled — which is the normal state of a healthy stream, not
 * a stalled one. Read against that default, a back-pressure guard silently
 * discards every frame after the first: the connection opens, `onopen` fires,
 * and no board ever arrives. Sixteen is a depth a consumer that is genuinely
 * reading never reaches.
 */
const QUEUE_DEPTH = 16;

/**
 * The live board, as Server-Sent Events.
 *
 * **SSE rather than a websocket, and the reason is two-sided.** Sleeper
 * publishes no push API at all — its documented API is read-only REST — so
 * something must poll it either way, and that happens in
 * `shared/picktracker/live`, once per league however many people are watching.
 * What is left is how the server tells a browser, and there a `ReadableStream`
 * out of a route handler works today (the leagues route already streams NDJSON)
 * where a WebSocket upgrade would need a custom server this app does not have.
 *
 * The stream shape is the leagues route's: a `TextEncoder`, a `send` that
 * swallows a throw from a gone client, and a `closed` flag hoisted out of
 * `start` so the source's own `cancel` can set it.
 *
 * **Every piece of per-stream state is declared inside the handler**, which is
 * not a style preference: a module-level `teardown` would be overwritten by the
 * next concurrent reader and `cancel` would then tear down somebody else's
 * room — twelve people on one league is the ordinary case here, so that is the
 * common path rather than an edge.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const { leagueId } = await params;

  const encoder = new TextEncoder();
  let closed = false;
  /** Set by `start`, called by `cancel` — one stream's teardown, not the module's. */
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let leave: (() => void) | null = null;
      let beat: ReturnType<typeof setInterval> | null = null;
      /** Consecutive boards a stalled consumer has refused. */
      let unread = 0;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true; // client disconnected
        }
      };
      /**
       * Deliver one message, dropping a *board* the consumer is not draining.
       *
       * Every board is self-sufficient — the whole list, never a delta — so the
       * newest supersedes any the socket refused, and dropping one costs the
       * reader nothing once they start reading again. A transition is never
       * dropped: a `stale` or a terminal `error` lost behind a full buffer is
       * the one message whose absence changes what the reader believes.
       */
      const send = (message: PicktrackerStreamMessage) => {
        const stalled =
          controller.desiredSize !== null && controller.desiredSize <= 0;
        if (stalled && message.type === "board") {
          if ((unread += 1) >= MAX_UNREAD) finish();
          return;
        }
        unread = 0;
        write(`data: ${JSON.stringify(message)}\n\n`);
      };

      /** Idempotent on every path: leave the room, stop the beat, close once. */
      const finish = () => {
        if (beat !== null) {
          clearInterval(beat);
          beat = null;
        }
        // Idempotent by construction — see `joinRoom`. Called from the abort
        // listener, from `cancel`, and from the terminal-error path, any of
        // which may be first.
        leave?.();
        leave = null;
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect; nothing to do.
        }
      };
      teardown = finish;

      // Both, because they fire on different disconnects and either may be
      // first: `abort` is the request going away, `cancel` is the consumer
      // dropping the stream. Registered before the await so a client that gives
      // up during the first Sleeper read is not missed.
      request.signal.addEventListener("abort", finish, { once: true });

      // **Bytes before the first await, and this line is the whole reason.**
      // Next flushes the response headers on the first chunk written, not when
      // the `Response` is returned — its own comment in `pipe-readable.js` says
      // so ("we don't actually flush the headers until we've started writing
      // chunks"). Until something is enqueued the browser has no headers, so
      // `EventSource.onopen` has not fired and the reader is staring at a
      // connection that is in fact perfectly healthy for as long as the first
      // Sleeper read takes.
      //
      // `retry:` is jittered because the reconnect delay is the browser's to
      // own and a fixed one is a thundering herd: a dozen viewers of one league
      // lose the socket to the same deploy and all come back in the same 3s.
      write(`retry: ${3000 + Math.floor(Math.random() * 3000)}\n\n`);

      const joined = await joinRoom(leagueId, send);

      if (!joined.ok) {
        // **Terminal, and it has to say so before closing.** `EventSource`
        // reconnects automatically on *any* close, so a league id that will
        // never work would otherwise be retried forever, a second apart, by
        // every tab that opened it. The client closes on this message; the
        // status cannot ride the response, because the headers are long gone.
        send({ type: "error", error: joined.error });
        finish();
        return;
      }

      // The reader may have gone during that read — in which case the room was
      // opened for nobody, and leaving immediately is what closes it again.
      if (closed) {
        joined.leave();
        return;
      }

      leave = joined.leave;

      // The board as it stands, immediately: a joiner must not stare at nothing
      // until the room's next tick, which on a `pre_draft` league is a minute.
      send({ type: "board", payload: joined.payload });

      // **The heartbeat is not decoration.** An SSE comment keeps a proxy's
      // idle timeout from cutting a stream that is correctly silent — the room
      // sends nothing while nothing changes — and it is also how this handler
      // learns a client has gone when no message is due. Without it a closed
      // tab is only noticed at the next real pick, which may be never.
      beat = setInterval(() => {
        write(":\n\n");
        if (closed) finish();
      }, HEARTBEAT_MS);
      beat.unref?.();
    },
    cancel() {
      teardown?.();
    },
  }, new CountQueuingStrategy({ highWaterMark: QUEUE_DEPTH }));

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Without this an nginx in front buffers the whole stream and the board
      // simply never updates, with nothing on screen saying why.
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST() {
  const error: ApiErrorPayload = { error: "Method not allowed" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "GET" } });
}
