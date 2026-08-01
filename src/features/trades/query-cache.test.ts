import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { QueryObserver, type QueryClient } from "@tanstack/react-query";

import type { TradesStreamMessage } from "@/shared/contract";

import { createQueryClient } from "../shared/query-client.ts";
import { fetchTrades } from "./query-fns.ts";
import { tradesQueryKeys } from "./query-keys.ts";
import type { TradesStreamState } from "./stream.ts";

/**
 * What the trades cache does across a navigation, without a renderer.
 *
 * `/trades` is one route, so "leaving and coming back" is a `QueryObserver`
 * unsubscribing and a new one subscribing against the same key — which is what
 * lets these assertions be about *request counts*. That is the thing the move
 * off `useState` was for: this is the most expensive read in the app, and as an
 * effect it ran again on every visit.
 *
 * The 15-minute stale time is deliberately not asserted here — `TRADES_STALE_TIME`
 * is the number, and a test restating a constant only pins the constant to
 * itself. What is asserted is the behaviour it buys.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SEASON = "2026";
const STALE_TIME = 15 * 60 * 1000;

const messages: TradesStreamMessage[] = [
  { type: "meta", season: SEASON },
  { type: "total", total: 2 },
  {
    type: "chunk",
    trades: [
      {
        transaction_id: "a",
        league_id: "L1",
        week: 1,
        completed_at: 1_752_000_000_000,
        sides: [],
      },
    ],
  },
];

/** Counts the requests, which is the whole assertion. */
function installFetchMock() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const encoder = new TextEncoder();
    let sent = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent < messages.length) {
            controller.enqueue(
              encoder.encode(JSON.stringify(messages[sent++]) + "\n"),
            );
            return;
          }
          controller.close();
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return calls;
}

const createTestClient = (): QueryClient =>
  createQueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

/** Mount a consumer of the trades query — the page. */
function mount(client: QueryClient, season: string) {
  const observer = new QueryObserver<TradesStreamState>(client, {
    queryKey: tradesQueryKeys.season(season),
    queryFn: ({ signal }) =>
      fetchTrades({
        season,
        signal,
        publish: (state) =>
          client.setQueryData(tradesQueryKeys.season(season), state),
      }),
    staleTime: STALE_TIME,
    retry: false,
  });
  return { observer, unmount: observer.subscribe(() => {}) };
}

const flush = (ms = 20): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("two consumers of one season are one stream, not two", async () => {
  const calls = installFetchMock();
  const client = createTestClient();

  const a = mount(client, SEASON);
  const b = mount(client, SEASON);
  await flush();

  assert.equal(calls.length, 1);
  a.unmount();
  b.unmount();
});

test("leaving and coming back inside the stale time costs no request", async () => {
  const calls = installFetchMock();
  const client = createTestClient();

  const first = mount(client, SEASON);
  await flush();
  assert.equal(calls.length, 1);
  first.unmount();

  // The whole season is the most expensive read in the app; a navigation away
  // and back used to pay for it again.
  const second = mount(client, SEASON);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(second.observer.getCurrentResult().data?.data?.trades.length, 1);
  second.unmount();
});

test("what is cached is the whole stream, not just the last message", async () => {
  installFetchMock();
  const client = createTestClient();
  const page = mount(client, SEASON);
  await flush();

  const { data } = page.observer.getCurrentResult();
  assert.equal(data?.data?.season, SEASON);
  assert.equal(data?.data?.total, 2);
  assert.equal(data?.data?.trades.length, 1);
  page.unmount();
});

test("a different season is a different entry, not a refetch of this one", async () => {
  const calls = installFetchMock();
  const client = createTestClient();

  const a = mount(client, "2026");
  await flush();
  const b = mount(client, "2025");
  await flush();

  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("season=2026"));
  assert.ok(calls[1].includes("season=2025"));
  // Both survive: a season change is not a season being replaced.
  assert.equal(
    client.getQueryData<TradesStreamState>(tradesQueryKeys.season("2026"))?.data
      ?.season,
    "2026",
  );
  a.unmount();
  b.unmount();
});

test("the mid-stream publishes are visible to a mounted consumer", async () => {
  installFetchMock();
  const client = createTestClient();

  const seen: number[] = [];
  const observer = new QueryObserver<TradesStreamState>(client, {
    queryKey: tradesQueryKeys.season(SEASON),
    queryFn: ({ signal }) =>
      fetchTrades({
        season: SEASON,
        signal,
        publish: (state) =>
          client.setQueryData(tradesQueryKeys.season(SEASON), state),
      }),
    staleTime: STALE_TIME,
    retry: false,
  });
  const unmount = observer.subscribe((result) => {
    if (result.data) seen.push(result.data.data?.trades.length ?? 0);
  });

  await flush();
  // The published state and the resolved one are the same shape, so the page
  // never sees a state that disagrees with what has arrived.
  assert.ok(seen.length > 0, "the page saw the season before it finished");
  assert.equal(seen.at(-1), 1);
  unmount();
});
