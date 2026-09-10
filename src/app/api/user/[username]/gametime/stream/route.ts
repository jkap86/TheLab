import { NextResponse } from "next/server";

import type {
  ApiErrorPayload,
  GametimeStreamMessage,
  ManagerGametimePayload,
} from "@/shared/contract";
import { joinGametime, toRoomFrame } from "@/shared/gametime";
import type { RoomListener } from "@/shared/gametime";
import { currentWeek, parseRequestedWeek } from "@/shared/projections";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often a silent stream proves it is still there. */
const HEARTBEAT_MS = 20_000;
/** Consecutive refused payloads before a stalled consumer is dropped. */
const MAX_UNREAD = 20;
/**
 * Bytes that may sit unread on one connection before the next payload or delta
 * is refused.
 *
 * **Bytes rather than frames, and the difference is what the number means.**
 * A count of sixteen bounds nothing on a stream whose frames run from a
 * two-byte heartbeat to a whole week of a hundred-league account: the ceiling
 * it sets is sixteen times the largest frame there is, which is megabytes per
 * stalled reader and exactly the memory a dyno cannot spare when the stall is
 * everybody's at once. `ByteLengthQueuingStrategy` counts what is actually
 * held, so this is a real per-connection bound.
 *
 * **A quarter of a megabyte is chosen against the frames, not the pipe.** The
 * check is made *before* an enqueue, so the queue is under the mark whenever
 * one happens and the true ceiling is this plus one frame — which is what lets
 * it sit below the size of a first payload without ever refusing one: at the
 * moment a reader joins, nothing is queued, `desiredSize` is the whole mark,
 * and the payload goes out however large it is. What the number bounds is the
 * *backlog* behind it, and a quarter of a megabyte is several deltas' worth of
 * one.
 */
const QUEUE_BYTES = 256 * 1024;

/**
 * One manager's week, live, as Server-Sent Events.
 *
 * The picktracker's stream over a gametime room: SSE rather than a websocket
 * because Sleeper has no push API so something polls either way (see
 * `shared/gametime/live`, once per week however many watch it), and a
 * `ReadableStream` out of a route handler works today where an upgrade would
 * need a custom server. Every mechanic below is that route's, and its comments
 * carry the arguments — bytes before the first await so the headers flush, a
 * queuing strategy so `desiredSize` means something, a terminal `error` before
 * closing so `EventSource` stops reconnecting, a heartbeat so a proxy does not
 * cut a correctly silent stream.
 *
 * **The room writes the reader's first frame through {@link send} like any
 * other**, so there is one path a frame can be refused on and one place that
 * refusal is recorded. See `joinGametime`.
 *
 * **The manager, the season and the week are resolved before the stream
 * opens**, which is the one place this differs: nothing has been written yet,
 * so an unknown manager or a malformed week can answer a real status rather
 * than a frame. The season that has no week left answers one payload saying
 * so and closes — a fact about the season, and nothing to stream.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const resolved = await resolveManagerUser(username);
  if (!resolved.ok) {
    const error: ApiErrorPayload = { error: resolved.error };
    return NextResponse.json(error, { status: resolved.status });
  }
  const userId = resolved.user.user_id;

  const searchParams = new URL(request.url).searchParams;
  const requestedSeason = parseRequestedSeason(searchParams.get("season"));
  if (requestedSeason && !requestedSeason.ok) {
    const error: ApiErrorPayload = { error: requestedSeason.error };
    return NextResponse.json(error, { status: 400 });
  }
  const requestedWeek = parseRequestedWeek(searchParams.get("week"));
  if (requestedWeek && !requestedWeek.ok) {
    const error: ApiErrorPayload = { error: requestedWeek.error };
    return NextResponse.json(error, { status: 400 });
  }

  const season = requestedSeason?.season ?? (await getActiveSeason());
  const week = requestedWeek?.week ?? (await currentWeek(season, getNflState));

  const encoder = new TextEncoder();
  let closed = false;
  let teardown: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let leave: (() => void) | null = null;
        let beat: ReturnType<typeof setInterval> | null = null;
        let unread = 0;

        const write = (chunk: string): boolean => {
          if (closed) return false;
          try {
            controller.enqueue(encoder.encode(chunk));
            return true;
          } catch {
            closed = true;
            return false;
          }
        };
        const send: RoomListener = (frame) => {
          const stalled = controller.desiredSize !== null && controller.desiredSize <= 0;
          // A payload and a delta are both droppable, and the room is what
          // makes that safe: it advances a reader's baseline only on a frame
          // this answers `true` for, so the next delta is computed against
          // what they actually hold and carries everything since. A transition
          // (`stale`, a terminal `error`) is never droppable.
          if (stalled && (frame.type === "payload" || frame.type === "delta")) {
            // A reader who cannot take a frame for twenty ticks running is not
            // reading; the socket is dropped rather than buffered against.
            if ((unread += 1) >= MAX_UNREAD) finish();
            return false;
          }
          unread = 0;
          return write(`data: ${frame.json}\n\n`);
        };
        const finish = () => {
          if (beat !== null) {
            clearInterval(beat);
            beat = null;
          }
          leave?.();
          leave = null;
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by a disconnect.
          }
        };
        teardown = finish;
        request.signal.addEventListener("abort", finish, { once: true });

        write(`retry: ${3000 + Math.floor(Math.random() * 3000)}\n\n`);

        if (week === null) {
          const payload: ManagerGametimePayload = {
            season,
            week: null,
            projections: "ok",
            stats: "ok",
            scores: "ok",
            read_at: Date.now(),
            games: { pre: 0, live: 0, final: 0 },
            board: {},
            leagues: {},
          };
          send(toRoomFrame({ type: "payload", payload }));
          // Terminal on purpose: there is nothing to follow, and an open stream
          // the browser would reconnect forever is not the honest end state.
          const done: GametimeStreamMessage = { type: "error", error: "No week left to follow" };
          send(toRoomFrame(done));
          finish();
          return;
        }

        const joined = await joinGametime({ userId, username, season, week }, send);

        if (!joined.ok) {
          const message: GametimeStreamMessage = { type: "error", error: joined.error };
          send(toRoomFrame(message));
          finish();
          return;
        }
        if (closed) {
          joined.leave();
          return;
        }
        leave = joined.leave;

        beat = setInterval(() => {
          write(":\n\n");
          if (closed) finish();
        }, HEARTBEAT_MS);
        beat.unref?.();
      },
      cancel() {
        teardown?.();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: QUEUE_BYTES }),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST() {
  const error: ApiErrorPayload = { error: "Method not allowed" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "GET" } });
}
