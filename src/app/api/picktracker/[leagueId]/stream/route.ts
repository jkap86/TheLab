import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/shared/contract";
import { hasRoom, joinRoom } from "@/shared/picktracker";
import type { RoomListener } from "@/shared/picktracker";
import { clientKey } from "@/shared/request";
import {
  SSE_HEADERS,
  sseStream,
  streamAdmission,
  streamRefusalResponse,
  withStreamReservation,
} from "@/shared/streams";
import type { SseFrame } from "@/shared/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Every board is self-sufficient — the whole list, never a delta — so the
 * newest supersedes any the socket refused, and dropping one costs the reader
 * nothing once they start reading again. A transition is never dropped.
 */
const DROPPABLE = new Set(["board"]);

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
 * The stream's mechanics are `shared/streams`' — see `sseStream` for the four
 * that are silent when wrong. What this file decides is admission: a
 * reservation against the process total and this client's own cap is taken
 * before the league id is even read, the room's own cap is claimed on it, and
 * a league nobody is watching yet takes a cold-open slot before its four-call
 * first read begins — so a spray of distinct league ids is held to a handful
 * of Sleeper reads in flight rather than one apiece. A refusal is a 429 or 503
 * with a `Retry-After`, answered before any stream is opened.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const reservation = streamAdmission.reserve({
    kind: "picktracker",
    client: clientKey(request.headers),
  });
  if (!reservation.ok) return streamRefusalResponse(reservation);

  return withStreamReservation(reservation, request.signal, async (streaming) => {
    const { leagueId } = await params;

    const seated = reservation.attach(leagueId);
    if (!seated.ok) return streamRefusalResponse(seated);

    if (!hasRoom(leagueId)) {
      const opening = reservation.beginOpening();
      if (!opening.ok) return streamRefusalResponse(opening);
    }

    streaming();
    const stream = sseStream<SseFrame>(
      {
        signal: request.signal,
        join: async (send) => {
          try {
            // The room's listener returns nothing; the stream's `send` answers
            // whether the frame was taken, which this room has no use for.
            const joined = await joinRoom(leagueId, send as RoomListener);
            return joined.ok
              ? { ok: true, leave: joined.leave, first: joined.frame }
              : { ok: false, error: joined.error };
          } finally {
            reservation.endOpening();
          }
        },
        droppable: DROPPABLE,
        terminal: (error) => ({ type: "error", json: JSON.stringify({ type: "error", error }) }),
        onClose: () => reservation.release(),
        name: "picktracker",
      },
      new CountQueuingStrategy({ highWaterMark: QUEUE_DEPTH }),
    );
    return new Response(stream, { headers: SSE_HEADERS });
  });
}

export async function POST() {
  const error: ApiErrorPayload = { error: "Method not allowed" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "GET" } });
}
