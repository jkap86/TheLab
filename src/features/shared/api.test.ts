import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { apiFetch, fetchJson, isAbortError } from "./api.ts";

/**
 * The one failure mode every query hook is written against.
 *
 * `apiFetch` turns a non-2xx into a throw carrying the *server's* own message,
 * which is what lets a hook report "no such user" rather than "Request failed
 * (404)" — so what is worth pinning is which of the two a caller gets, and that
 * the fallback is reached only when there is genuinely nothing to read. The
 * routes all answer `ApiErrorPayload`, and `read-failure` is why a 503 has to
 * stay distinguishable from a 500 all the way out to the browser.
 */

/** Answer the next `fetch` with this response, and put the real one back after. */
function stubFetch(response: Response | (() => Promise<Response>)): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    typeof response === "function" ? response() : response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("apiFetch", () => {
  test("a 2xx response is handed back untouched", async (t) => {
    t.after(stubFetch(json({ user_id: "1" }, 200)));
    const res = await apiFetch("/api/user/jkap86");
    assert.equal(res.ok, true);
    assert.deepEqual(await res.json(), { user_id: "1" });
  });

  test("a failure throws the server's own message, not the status", async (t) => {
    // The whole point: `resolveManagerUser` maps an unknown username to a 404
    // with a sentence, and that sentence is what the page shows.
    t.after(stubFetch(json({ error: "No Sleeper user named jkap87" }, 404)));
    await assert.rejects(apiFetch("/api/user/jkap87"), {
      message: "No Sleeper user named jkap87",
    });
  });

  test("the fallback is reached only when there is no readable body", async (t) => {
    // A proxy error page or a connection dropped mid-response — the platform
    // answering on the route's behalf, which is exactly when the status is the
    // only thing worth reporting.
    t.after(stubFetch(new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    await assert.rejects(apiFetch("/api/adp", { fallbackError: "Failed to load ADP" }), {
      message: "Failed to load ADP (502)",
    });
  });

  test("a body without an `error` field falls back too", async (t) => {
    // Readable JSON that isn't an `ApiErrorPayload` is not a message; reporting
    // `undefined` to the reader would be worse than the status.
    t.after(stubFetch(json({ detail: "nope" }, 500)));
    await assert.rejects(apiFetch("/api/adp", { fallbackError: "Failed to load ADP" }), {
      message: "Failed to load ADP (500)",
    });
  });

  test("with no fallback named, the failure still says something", async (t) => {
    t.after(stubFetch(new Response("", { status: 503 })));
    await assert.rejects(apiFetch("/api/trades"), { message: "Request failed (503)" });
  });

  test("the status survives into the message, so a 503 is not a 500", async (t) => {
    // `isDatabaseBusy` answers 503 precisely so a caller knows to ask again;
    // collapsing every failure to one string would lose that at the last step.
    t.after(stubFetch(new Response("", { status: 503 })));
    await assert.rejects(apiFetch("/api/trades", { fallbackError: "Failed to load trades" }), {
      message: "Failed to load trades (503)",
    });
  });

  test("`fallbackError` is not passed on to fetch as a request option", async (t) => {
    // It rides on the same object the caller's `signal` does, so it has to be
    // split off — `fetch` ignores unknown keys today, but sending it is a lie
    // about what the request is.
    let seen: RequestInit | undefined;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return json({}, 200);
    }) as typeof fetch;
    t.after(() => {
      globalThis.fetch = original;
    });

    await apiFetch("/api/adp", { fallbackError: "x", method: "GET" });
    assert.equal(seen?.method, "GET");
    assert.ok(!("fallbackError" in (seen ?? {})));
  });
});

describe("fetchJson", () => {
  test("reads the body of a good answer", async (t) => {
    t.after(stubFetch(json({ draft_count: 12 }, 200)));
    assert.deepEqual(await fetchJson("/api/adp", "Failed to load ADP"), {
      draft_count: 12,
    });
  });

  test("throws the route's message rather than returning a partial answer", async (t) => {
    t.after(stubFetch(json({ error: "Invalid season: 20266" }, 400)));
    await assert.rejects(fetchJson("/api/adp", "Failed to load ADP"), {
      message: "Invalid season: 20266",
    });
  });

  test("passes the caller's abort signal through to the request", async (t) => {
    let seen: RequestInit | undefined;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen = init;
      return json({}, 200);
    }) as typeof fetch;
    t.after(() => {
      globalThis.fetch = original;
    });

    const controller = new AbortController();
    await fetchJson("/api/adp", "Failed to load ADP", controller.signal);
    assert.equal(seen?.signal, controller.signal);
  });
});

describe("isAbortError", () => {
  test("recognises the rejection an AbortController produces", () => {
    // Expected teardown — an unmount, or a dependency change — not a failure
    // worth showing anyone.
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    assert.equal(isAbortError(error), true);
  });

  test("a real failure is not teardown", () => {
    assert.equal(isAbortError(new Error("Failed to load ADP (500)")), false);
    assert.equal(isAbortError(new TypeError("fetch failed")), false);
  });

  test("a non-Error is never an abort", () => {
    // `catch` binds `unknown`, so this is asked of thrown strings and nulls too.
    for (const value of [null, undefined, "AbortError", { name: "AbortError" }]) {
      assert.equal(isAbortError(value), false);
    }
  });
});
