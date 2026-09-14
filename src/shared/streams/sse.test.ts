import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sseStream, withStreamReservation } from "./sse.ts";
import type { SseFrame, SseJoinResult, SseTimers } from "./sse.ts";

/**
 * The stream driven for real: a scripted join, a scripted heartbeat, a real
 * `ReadableStream` read back through a reader. What every case counts is the
 * one thing a route cannot prove about itself — that the reservation goes
 * back exactly once on each way out, and that a reader who left mid-join is
 * never seated.
 */

type Frame = SseFrame;
const frame = (type: string, body: unknown = {}): Frame => ({ type, json: JSON.stringify({ type, ...(body as object) }) });
const terminal = (error: string): Frame => frame("error", { error });

function timers() {
  const beats: { run: () => void; cleared: boolean }[] = [];
  const api: SseTimers = {
    setInterval: (run) => {
      const beat = { run, cleared: false };
      beats.push(beat);
      return beat;
    },
    clearInterval: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  };
  return { api, beats, live: () => beats.filter((b) => !b.cleared) };
}

function harness(over: {
  join?: (send: (f: Frame) => boolean) => Promise<SseJoinResult<Frame>>;
  highWaterMark?: number;
  maxUnread?: number;
} = {}) {
  const controller = new AbortController();
  let closes = 0;
  let leaves = 0;
  let sendOut: ((f: Frame) => boolean) | null = null;
  let resolveJoin: ((r: SseJoinResult<Frame>) => void) | null = null;
  const t = timers();
  const stream = sseStream<Frame>(
    {
      signal: controller.signal,
      join:
        over.join ??
        ((send) => {
          sendOut = send;
          return new Promise((resolve) => {
            resolveJoin = resolve;
          });
        }),
      droppable: new Set(["board"]),
      terminal,
      onClose: () => {
        closes += 1;
      },
      name: "test",
      retryMs: 3000,
      maxUnread: over.maxUnread ?? 3,
      timers: t.api,
      log: { error: () => {} },
    },
    new CountQueuingStrategy({ highWaterMark: over.highWaterMark ?? 16 }),
  );
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const read = async () => {
    const { value, done } = await reader.read();
    return done ? null : decoder.decode(value);
  };
  const leave = () => {
    leaves += 1;
  };
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r));
  };
  return {
    controller,
    stream,
    reader,
    read,
    flush,
    timers: t,
    closes: () => closes,
    leaves: () => leaves,
    send: (f: Frame) => sendOut!(f),
    settle: (r: SseJoinResult<Frame>) => resolveJoin!(r),
    leave,
  };
}

describe("the frames on the wire", () => {
  test("the retry line is written before the join is awaited", async () => {
    const h = harness();
    assert.equal(await h.read(), "retry: 3000\n\n");
  });

  test("the first frame follows the seat, and later frames follow the room", async () => {
    const h = harness();
    await h.read();
    h.settle({ ok: true, leave: h.leave, first: frame("board", { n: 1 }) });
    assert.equal(await h.read(), `data: ${frame("board", { n: 1 }).json}\n\n`);
    assert.equal(h.send(frame("stale", { error: "quiet" })), true);
    assert.equal(await h.read(), `data: ${frame("stale", { error: "quiet" }).json}\n\n`);
    assert.equal(h.closes(), 0);
  });

  test("a failed join is a terminal error and one close", async () => {
    const h = harness();
    await h.read();
    h.settle({ ok: false, error: "No such league" });
    assert.equal(await h.read(), `data: ${terminal("No such league").json}\n\n`);
    assert.equal(await h.read(), null, "the stream closed");
    assert.equal(h.closes(), 1);
  });

  test("a join that throws is a terminal error and one close, never an errored stream", async () => {
    const h = harness({ join: async () => { throw new Error("boom"); } });
    await h.read();
    assert.match((await h.read()) ?? "", /Live updates are unavailable/);
    assert.equal(await h.read(), null);
    assert.equal(h.closes(), 1);
  });
});

describe("every exit releases exactly once", () => {
  test("an abort before the join resolves: the late seat is left, and nothing is sent", async () => {
    const h = harness();
    await h.read();
    h.controller.abort();
    await h.flush();
    assert.equal(h.closes(), 1);
    // The join lands for a reader who has gone.
    h.settle({ ok: true, leave: h.leave, first: frame("board") });
    await h.flush();
    assert.equal(h.leaves(), 1, "the room was left again at once — no orphan subscriber");
    assert.equal(h.closes(), 1, "released once, not twice");
    assert.equal(h.timers.live().length, 0, "no heartbeat was armed");
  });

  test("an abort before the stream even started releases once and seats nobody", async () => {
    const controller = new AbortController();
    controller.abort();
    let closes = 0;
    let joined = false;
    const stream = sseStream<Frame>(
      {
        signal: controller.signal,
        join: async () => {
          joined = true;
          return { ok: true, leave: () => {} };
        },
        droppable: new Set(),
        terminal,
        onClose: () => {
          closes += 1;
        },
        name: "test",
        retryMs: 3000,
        timers: timers().api,
      },
      new CountQueuingStrategy({ highWaterMark: 16 }),
    );
    const reader = stream.getReader();
    assert.deepEqual(await reader.read(), { value: undefined, done: true });
    assert.equal(closes, 1);
    assert.equal(joined, false);
  });

  test("an abort after the join: leaves once, stops the beat, releases once", async () => {
    const h = harness();
    await h.read();
    h.settle({ ok: true, leave: h.leave });
    await h.flush();
    assert.equal(h.timers.live().length, 1);
    h.controller.abort();
    await h.flush();
    assert.equal(h.leaves(), 1);
    assert.equal(h.closes(), 1);
    assert.equal(h.timers.live().length, 0);
    // A second abort, or the consumer cancelling afterwards, changes nothing.
    await h.reader.cancel();
    assert.equal(h.closes(), 1);
    assert.equal(h.leaves(), 1);
  });

  test("the consumer cancelling the stream releases once", async () => {
    const h = harness();
    await h.read();
    h.settle({ ok: true, leave: h.leave });
    await h.flush();
    await h.reader.cancel();
    await h.flush();
    assert.equal(h.leaves(), 1);
    assert.equal(h.closes(), 1);
    h.controller.abort();
    await h.flush();
    assert.equal(h.closes(), 1);
  });

  test("a stalled consumer is dropped after maxUnread refused droppable frames, releasing once", async () => {
    const h = harness({ highWaterMark: 1, maxUnread: 3 });
    // Do not read: the queue fills at one chunk (the retry line).
    h.settle({ ok: true, leave: h.leave });
    await h.flush();
    assert.equal(h.send(frame("board")), false, "refused, not queued");
    assert.equal(h.send(frame("board")), false);
    assert.equal(h.closes(), 0);
    assert.equal(h.send(frame("board")), false);
    assert.equal(h.closes(), 1, "the third refusal dropped the reader");
    assert.equal(h.leaves(), 1);
  });

  test("a transition is never dropped, and a taken frame resets the count", async () => {
    const h = harness({ highWaterMark: 1, maxUnread: 3 });
    h.settle({ ok: true, leave: h.leave });
    await h.flush();
    assert.equal(h.send(frame("board")), false);
    assert.equal(h.send(frame("board")), false);
    // A transition goes out regardless of backpressure.
    assert.equal(h.send(frame("stale", { error: "x" })), true);
    // And having been taken, the run of refusals starts over.
    assert.equal(h.send(frame("board")), false);
    assert.equal(h.send(frame("board")), false);
    assert.equal(h.closes(), 0);
  });

  test("a heartbeat on a dead socket finishes the stream once", async () => {
    const h = harness();
    await h.read();
    h.settle({ ok: true, leave: h.leave });
    await h.flush();
    // Simulate the socket going away: cancelling the reader makes enqueue throw.
    await h.reader.cancel();
    h.timers.beats[0].run();
    assert.equal(h.closes(), 1);
    assert.equal(h.leaves(), 1);
  });
});

describe("withStreamReservation", () => {
  const reservation = () => {
    let releases = 0;
    return { release: () => { releases += 1; }, releases: () => releases };
  };

  test("a handler that answers without streaming releases once", async () => {
    const r = reservation();
    const response = await withStreamReservation(r, new AbortController().signal, async () => Response.json({}, { status: 404 }));
    assert.equal(response.status, 404);
    assert.equal(r.releases(), 1);
  });

  test("a handler that throws releases once and rethrows", async () => {
    const r = reservation();
    await assert.rejects(
      withStreamReservation(r, new AbortController().signal, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(r.releases(), 1);
  });

  test("a handler that streams hands the slot to the stream", async () => {
    const r = reservation();
    await withStreamReservation(r, new AbortController().signal, async (streaming) => {
      streaming();
      return new Response("stream");
    });
    assert.equal(r.releases(), 0);
  });

  test("an abort during the handler releases; the stream's own close does not double it", async () => {
    const r = reservation();
    const controller = new AbortController();
    await withStreamReservation(r, controller.signal, async (streaming) => {
      controller.abort();
      streaming();
      return new Response("stream");
    });
    assert.equal(r.releases(), 1);
  });

  test("an already-aborted request is released before the handler runs", async () => {
    const r = reservation();
    const controller = new AbortController();
    controller.abort();
    await withStreamReservation(r, controller.signal, async () => Response.json({}));
    assert.equal(r.releases(), 1);
  });
});
