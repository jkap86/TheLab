import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { TradesStreamMessage } from "@/shared/contract";

import { fetchTrades, TRADES_PUBLISH_INTERVAL_MS } from "./query-fns.ts";
import type { TradesStreamState } from "./stream.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const chunkOf = (from: number, n: number): TradesStreamMessage => ({
  type: "chunk",
  trades: Array.from({ length: n }, (_, i) => ({
    transaction_id: `t${from + i}`,
    league_id: "L1",
    week: 1,
    completed_at: 1_752_000_000_000,
    sides: [],
  })),
});

/**
 * A stream that hands over one message per read, so a test can pin what the
 * client does *between* messages rather than after all of them.
 */
function streamOf(messages: readonly TradesStreamMessage[]): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < messages.length) {
        controller.enqueue(
          encoder.encode(JSON.stringify(messages[sent++]) + "\n"),
        );
        return;
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function mockStream(messages: readonly TradesStreamMessage[]) {
  globalThis.fetch = (async () => streamOf(messages)) as typeof fetch;
}

const run = async (messages: readonly TradesStreamMessage[]) => {
  const published: TradesStreamState[] = [];
  mockStream(messages);
  const resolved = await fetchTrades({
    season: "2026",
    publish: (state) => published.push(state),
  });
  return { published, resolved };
};

test("the whole season arrives and the resolution is the last state", async () => {
  const { published, resolved } = await run([
    { type: "meta", season: "2026" },
    { type: "total", total: 30 },
    chunkOf(0, 10),
    chunkOf(10, 10),
    chunkOf(20, 10),
  ]);

  assert.equal(resolved.data?.trades.length, 30);
  assert.equal(resolved.data?.total, 30);
  // Whatever the cadence did in between, the caller ends up with everything.
  assert.equal(published.at(-1), resolved);
});

// The point of the cadence: a page that re-renders per network read is a page
// that re-renders dozens of times a second for a list nobody can watch grow
// that fast.
test("many chunks in quick succession do not become many publishes", async () => {
  const messages: TradesStreamMessage[] = [{ type: "meta", season: "2026" }];
  for (let i = 0; i < 50; i++) messages.push(chunkOf(i * 1000, 1000));

  const { published, resolved } = await run(messages);

  assert.equal(resolved.data?.trades.length, 50_000);
  // One for the first trades, one for completion, and whatever the interval
  // allowed in between — nowhere near the 50 a per-chunk publish would give.
  assert.ok(
    published.length < 20,
    `expected far fewer than 50 publishes, got ${published.length}`,
  );
});

test("the first state carrying trades is published immediately", async () => {
  const published: TradesStreamState[] = [];
  mockStream([{ type: "meta", season: "2026" }, chunkOf(0, 5), chunkOf(5, 5)]);

  const started = Date.now();
  let firstTradesAt: number | null = null;
  await fetchTrades({
    season: "2026",
    publish: (state) => {
      published.push(state);
      if (firstTradesAt === null && (state.data?.trades.length ?? 0) > 0) {
        firstTradesAt = Date.now() - started;
      }
    },
  });

  assert.notEqual(firstTradesAt, null);
  // The spinner coming off is the number this work is about, so it does not
  // wait out an interval.
  assert.ok(
    firstTradesAt! < TRADES_PUBLISH_INTERVAL_MS,
    `first trades waited ${firstTradesAt}ms`,
  );
});

test("completion is published even when it lands inside the interval", async () => {
  // Two chunks back to back: the second falls inside the window the first
  // opened, and would be held there if `done` were not urgent.
  const { published, resolved } = await run([
    { type: "meta", season: "2026" },
    chunkOf(0, 5),
    chunkOf(5, 5),
  ]);

  assert.equal(resolved.data?.trades.length, 10);
  assert.equal(published.at(-1)?.data?.trades.length, 10);
});

test("an error message is published rather than held for the cadence", async () => {
  const { published } = await run([
    { type: "meta", season: "2026" },
    chunkOf(0, 5),
    { type: "error", error: "Failed to load trades" },
  ]);

  const errored = published.find((state) => state.error !== null);
  assert.equal(errored?.error, "Failed to load trades");
  // Beside the data, never in place of it — the prefix that arrived stays.
  assert.equal(errored?.data?.trades.length, 5);
});

test("a message split across reads is decoded whole", async () => {
  const encoder = new TextEncoder();
  const line =
    JSON.stringify({ type: "meta", season: "2026" }) +
    "\n" +
    JSON.stringify(chunkOf(0, 2)) +
    "\n";
  const bytes = encoder.encode(line);
  const half = Math.floor(bytes.length / 2);

  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, half));
          controller.enqueue(bytes.slice(half));
          controller.close();
        },
      }),
      { status: 200 },
    )) as typeof fetch;

  const resolved = await fetchTrades({ season: "2026" });
  assert.equal(resolved.data?.trades.length, 2);
});

test("an aborted read rejects and leaves no timer behind", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    // What `fetch` does with an already-aborted signal.
    if (init?.signal?.aborted) throw abortError();
    return streamOf([{ type: "meta", season: "2026" }]);
  }) as unknown as typeof fetch;

  controller.abort();
  await assert.rejects(
    fetchTrades({ season: "2026", signal: controller.signal }),
    /aborted/i,
  );
});

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}
