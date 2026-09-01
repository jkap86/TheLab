import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { get, HttpError, HttpTimeoutError } from "./index.ts";

/**
 * What this file is for.
 *
 * The JSON handling is barely worth a test. The retry ladder is worth several:
 * it decides which failures are worth repeating, and it runs *around* a caller's
 * cancellation, so the two ways it can be wrong are both silent. Retrying a 404
 * turns one request into four to learn what the first one said. Missing an abort
 * that fires during a backoff leaves a request running for a client that has
 * already gone — no error, no symptom, just work nobody is waiting for.
 *
 * `RETRY_BASE_DELAY_MS` is 300ms and deliberately not injectable, so the tests
 * that cross a backoff cost real milliseconds. Kept to one retry each.
 */

/** Only the two fields the client passes; enough to drive every path here. */
type FetchStub = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

const realFetch = globalThis.fetch;

function stubFetch(stub: FetchStub): void {
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
}

/**
 * A request that never settles on its own — only the signal ends it.
 *
 * The already-aborted branch matters: `addEventListener("abort")` never fires on
 * a signal that has already aborted, so a stub without it would hang exactly
 * where real `fetch` rejects at once.
 */
const hangs: FetchStub = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    if (init.signal.aborted) {
      reject(init.signal.reason);
      return;
    }
    init.signal.addEventListener("abort", () => reject(init.signal.reason), {
      once: true,
    });
  });

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("http.get — the body", () => {
  it("resolves a parsed body into the data envelope", async () => {
    stubFetch(async () => Response.json({ user_id: "42" }));

    const { data, status } = await get<{ user_id: string }>(
      "https://example.test/user",
    );

    assert.deepEqual(data, { user_id: "42" });
    assert.equal(status, 200);
  });

  it("reads an empty body as null rather than throwing", async () => {
    // Sleeper's convention for "no data" is a null body, and some endpoints
    // send nothing at all. `sleeperGet` folds both into its fallback, which it
    // can only do if neither one throws here — `response.json()` would.
    stubFetch(async () => new Response("", { status: 200 }));

    const { data } = await get<unknown>("https://example.test/empty");

    assert.equal(data, null);
  });
});

describe("http.get — what is worth retrying", () => {
  it("does not retry a 404: it is an answer, not a fault", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return new Response("not found", {
        status: 404,
        statusText: "Not Found",
      });
    });

    await assert.rejects(
      () => get("https://example.test/gone"),
      (error: unknown) =>
        error instanceof HttpError && error.response.status === 404,
    );
    // Default retries is 3. A retried 404 would make four.
    assert.equal(calls, 1);
  });

  it("does not retry a 429: more requests is the wrong answer", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return new Response("slow down", {
        status: 429,
        statusText: "Too Many Requests",
      });
    });

    await assert.rejects(() => get("https://example.test/limited"));
    assert.equal(calls, 1);
  });

  it("retries a 5xx and returns the attempt that succeeds", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("", { status: 503, statusText: "Unavailable" });
      }
      return Response.json({ ok: true });
    });

    const { data } = await get<{ ok: boolean }>("https://example.test/flaky", {
      retries: 1,
    });

    assert.deepEqual(data, { ok: true });
    assert.equal(calls, 2);
  });

  it("gives up after the configured number of retries", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      return new Response("", { status: 500, statusText: "Server Error" });
    });

    await assert.rejects(
      () => get("https://example.test/down", { retries: 1 }),
      (error: unknown) =>
        error instanceof HttpError && error.response.status === 500,
    );
    assert.equal(calls, 2, "one attempt plus one retry");
  });

  it("bounds each attempt on its own clock and reports a timeout", async () => {
    stubFetch(hangs);

    await assert.rejects(
      () => get("https://example.test/slow", { timeoutMs: 10, retries: 0 }),
      (error: unknown) => error instanceof HttpTimeoutError,
    );
  });

  it("retries a timeout — the server never said anything", async () => {
    let calls = 0;
    stubFetch((url, init) => {
      calls += 1;
      return hangs(url, init);
    });

    await assert.rejects(() =>
      get("https://example.test/slow", { timeoutMs: 10, retries: 1 }),
    );
    assert.equal(calls, 2);
  });
});

describe("http.get — the caller's cancellation", () => {
  it("ends the ladder when the caller aborts during the backoff", async () => {
    // The case that motivated the test: the attempt fails retryably, so the
    // client is *between* requests when it goes away. A ladder that only checked
    // the signal before an attempt would still be sleeping here.
    const controller = new AbortController();
    const reason = new Error("client went away");
    let calls = 0;

    stubFetch(async () => {
      calls += 1;
      setTimeout(() => controller.abort(reason), 20);
      return new Response("", { status: 500, statusText: "Server Error" });
    });

    await assert.rejects(
      () =>
        get("https://example.test/abandoned", {
          signal: controller.signal,
          retries: 3,
        }),
      (error: unknown) => error === reason,
    );
    assert.equal(calls, 1, "the second attempt must never be made");
  });

  it("does not retry a request the caller aborted mid-flight", async () => {
    const controller = new AbortController();
    let calls = 0;

    stubFetch((url, init) => {
      calls += 1;
      setTimeout(() => controller.abort(), 10);
      return hangs(url, init);
    });

    await assert.rejects(() =>
      get("https://example.test/abandoned", {
        signal: controller.signal,
        retries: 3,
      }),
    );
    assert.equal(calls, 1);
  });

  it("refuses a signal that was already aborted", async () => {
    let calls = 0;
    stubFetch((url, init) => {
      calls += 1;
      return hangs(url, init);
    });

    await assert.rejects(() =>
      get("https://example.test/x", {
        signal: AbortSignal.abort(),
        retries: 3,
      }),
    );
    assert.equal(calls, 1, "no retry ladder for a caller that is already gone");
  });
});
