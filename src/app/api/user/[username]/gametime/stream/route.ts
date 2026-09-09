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
/** Frames that may sit unread — see the picktracker stream for why this must be set. */
const QUEUE_DEPTH = 16;

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

        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        const send: RoomListener = (frame) => {
          const stalled = controller.desiredSize !== null && controller.desiredSize <= 0;
          // A payload and a delta are both droppable: the reader is caught up
          // by the full payload their next join sends, and a transition
          // (`stale`, a terminal `error`) never is.
          if (stalled && (frame.type === "payload" || frame.type === "delta")) {
            if ((unread += 1) >= MAX_UNREAD) finish();
            return;
          }
          unread = 0;
          write(`data: ${frame.json}\n\n`);
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

        send(joined.frame);

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
    new CountQueuingStrategy({ highWaterMark: QUEUE_DEPTH }),
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
