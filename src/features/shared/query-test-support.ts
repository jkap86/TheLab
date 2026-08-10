import type { QueryClient } from "@tanstack/react-query";

import { createQueryClient } from "./query-client.ts";

/**
 * What the query tests need and the app doesn't: a `fetch` that answers from a
 * table and counts what it was asked, and a client configured to make timing
 * observable.
 *
 * It is a module rather than a copy in each test file for the reason the
 * `shared/query` primitives are one module — the copies had already drifted. It
 * is deliberately *not* a `.test.ts`: the runner globs those, and a helper file
 * that registers no tests would report as an empty suite.
 */

/** A JSON route's answer, as `apiFetch` expects to read it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The leagues route's answer: newline-delimited messages, each pushed as its own
 * chunk so a test can pin what the client sees *between* them. `fail` errors the
 * stream after the last one, which is a refresh dying mid-flight.
 */
export function ndjsonResponse(
  messages: readonly unknown[],
  options: { fail?: boolean } = {},
): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  // One message per `pull` rather than all of them in `start`: a stream that is
  // already errored before anyone reads it rejects somewhere the client can't
  // catch, which is not the failure being modelled — the failure here is a
  // connection dying *after* the cached payload was read.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < messages.length) {
        controller.enqueue(encoder.encode(JSON.stringify(messages[sent++]) + "\n"));
        return;
      }
      if (options.fail) controller.error(new Error("stream died"));
      else controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

export type FetchMock = {
  /** Every URL asked for, in order — what a request-count assertion reads. */
  calls: string[];
  /** How many of those matched a substring. */
  countOf: (fragment: string) => number;
  restore: () => void;
};

/**
 * Replace `globalThis.fetch` with a handler, recording every call.
 *
 * The handler takes the URL, the call index and the request's own init, so a
 * test can answer the same route differently the second time — which is how "a
 * failed background refetch keeps the previous data" is set up — and can reach
 * the `AbortSignal` the caller passed, which is what lets a cancellation be
 * modelled with a real controller rather than with a hand-made rejection.
 */
export function installFetchMock(
  handler: (
    url: string,
    call: number,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): FetchMock {
  const original = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call = calls.length;
    calls.push(url);
    return handler(url, call, init);
  }) as typeof fetch;

  return {
    calls,
    countOf: (fragment) => calls.filter((url) => url.includes(fragment)).length,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/**
 * The app's client with the two things a test needs changed: no retries (a
 * failure should be one call, not two) and no garbage collection between
 * assertions, so an entry disappearing is always the test's own doing. The test
 * that checks collection sets its own `gcTime` on the query.
 */
export function createTestQueryClient(): QueryClient {
  return createQueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** Let the microtask queue and any pending timers run. */
export const flush = (ms = 5): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
