import { NextResponse } from "next/server";

import { interactiveRoute } from "@/shared/api";
import type { ApiErrorPayload, ManagerGametimePayload } from "@/shared/contract";
import { hasGametimeRoom, joinGametime, toRoomFrame } from "@/shared/gametime";
import type { RoomFrame } from "@/shared/gametime";
import { currentWeek, parseRequestedWeek } from "@/shared/projections";
import { clientKey } from "@/shared/request";
import { getActiveSeason, parseRequestedSeason } from "@/shared/season";
import { getNflState } from "@/shared/sleeper";
import {
  SSE_HEADERS,
  sseStream,
  streamAdmission,
  streamRefusalResponse,
  withStreamReservation,
} from "@/shared/streams";
import type { StreamReservation } from "@/shared/streams";
import { resolveManagerUser } from "@/shared/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** A payload and a delta may be dropped on a stalled socket; a transition never. */
const DROPPABLE = new Set<RoomFrame["type"]>(["payload", "delta"]);

/**
 * One manager's week, live, as Server-Sent Events.
 *
 * The picktracker's stream over a gametime room: SSE rather than a websocket
 * because Sleeper has no push API so something polls either way (see
 * `shared/gametime/live`, once per week however many watch it), and a
 * `ReadableStream` out of a route handler works today where an upgrade would
 * need a custom server. The mechanics of the stream itself — bytes before the
 * first await so the headers flush, a terminal `error` before closing so
 * `EventSource` stops reconnecting, a heartbeat, the backpressure rule — are
 * `shared/streams`' and are driven under Node's own runner there.
 *
 * **Admission is reserved before anything is awaited.** The reservation counts
 * against the process total and this client's own cap from the first line of
 * the handler — before the user is resolved, before the week is, before any
 * lineup is read — because that work is the expensive part and a connection
 * still initialising is a connection. A refusal is answered as a 429 or a 503
 * with a `Retry-After` **before** the stream opens, while a status can still
 * reach the browser. The room's own cap (`attach`) and the cold-open bound
 * (`beginOpening`) are claimed once the week is known and before the first
 * feed read; `withStreamReservation` and the stream's `onClose` between them
 * hand the slot back on every exit exactly once.
 *
 * **The manager, the season and the week are resolved before the stream
 * opens**, which is the one place this differs from the picktracker: nothing
 * has been written yet, so an unknown manager or a malformed week can answer a
 * real status rather than a frame. The season that has no week left answers
 * one payload saying so and closes — a fact about the season, and nothing to
 * stream.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
) {
  const reservation = streamAdmission.reserve({
    kind: "gametime",
    client: clientKey(request.headers),
  });
  if (!reservation.ok) return streamRefusalResponse(reservation);

  // Interactive Sleeper traffic — a reader is waiting on this handler, so the
  // reads under it share one bounded budget rather than queueing behind a crawl
  // batch, and an overload is answered as one rather than as a 500 (see
  // `shared/api`). No `signal`: see `shared/sleeper/request-policy`, which is
  // where both halves of that decision are argued. The room's own reads are
  // background traffic and declared so in `shared/gametime/live`.
  return withStreamReservation(reservation, request.signal, (streaming) =>
    interactiveRoute(() => openGametimeStream(request, context, reservation, streaming)),
  );
}

async function openGametimeStream(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
  reservation: StreamReservation,
  streaming: () => void,
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

  if (week === null) {
    // Nothing to seat and nothing to open: one payload saying the season has
    // no week left, then a terminal ending. The reservation is held for the
    // moment the stream takes and released by its close.
    const payload: ManagerGametimePayload = {
      season,
      week: null,
      projections: "ok",
      stats: "ok",
      scores: "ok",
      read_at: Date.now(),
      games: { pre: 0, live: 0, final: 0 },
      board: {},
      players: {},
      leagues: {},
    };
    streaming();
    return sseResponse(request, reservation, async (send) => {
      send(toRoomFrame({ type: "payload", payload }));
      return { ok: false, error: "No week left to follow" };
    });
  }

  // The room's own cap: a week's room is bounded on its own however the
  // process total is spread across weeks.
  const seated = reservation.attach(`${season}:${week}`);
  if (!seated.ok) return streamRefusalResponse(seated);

  // A cold open is the expensive shape — the week's three feeds, read for the
  // first time — and how many *distinct* weeks may be mid-open at once is
  // bounded before the read begins. A join into a room that already exists
  // costs no slot.
  if (!hasGametimeRoom(season, week)) {
    const opening = reservation.beginOpening();
    if (!opening.ok) return streamRefusalResponse(opening);
  }

  streaming();
  return sseResponse(request, reservation, async (send) => {
    try {
      return await joinGametime({ userId, username, season, week }, send);
    } finally {
      // The opening slot is the join's alone; the connection is the stream's.
      reservation.endOpening();
    }
  });
}

function sseResponse(
  request: Request,
  reservation: StreamReservation,
  join: Parameters<typeof sseStream<RoomFrame>>[0]["join"],
): Response {
  const stream = sseStream<RoomFrame>(
    {
      signal: request.signal,
      join,
      droppable: DROPPABLE,
      terminal: (error) => toRoomFrame({ type: "error", error }),
      onClose: () => reservation.release(),
      name: "gametime",
    },
    new ByteLengthQueuingStrategy({ highWaterMark: QUEUE_BYTES }),
  );
  return new Response(stream, { headers: SSE_HEADERS });
}

export async function POST() {
  const error: ApiErrorPayload = { error: "Method not allowed" };
  return NextResponse.json(error, { status: 405, headers: { Allow: "GET" } });
}
