import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AdmissionAbortedError,
  AdmissionTimeoutError,
} from "../sleeper/limiter.ts";
import { SleeperBudgetExhaustedError } from "../sleeper/request-policy.ts";
import { withInteractiveSleeper } from "../sleeper/request-policy.ts";
import { interactiveRoute } from "./interactive-route.ts";
import {
  OVERLOAD_MESSAGE,
  OVERLOAD_RETRY_AFTER_SECONDS,
  isOverload,
  mapOverload,
  overloadResponse,
} from "./overload.ts";

/**
 * What a route answers when the process declined to do the work.
 *
 * The failure this replaces is not a crash: a shed limiter permit reaching a
 * handler's `catch` produced `{ error: "Failed to load …" }` with a 500, which
 * is indistinguishable from a null dereference to an operator, tells a browser
 * nothing about retrying, and buries the one number that would show the shed
 * rate. Every assertion here is about telling the two apart.
 */

/** Swallow the module's own warn line so a passing suite is quiet. */
function quiet<T>(fn: () => T): T {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

describe("which errors are the app shedding", () => {
  test("all three admission refusals are", () => {
    assert.equal(isOverload(new AdmissionTimeoutError(4_000)), true);
    assert.equal(isOverload(new AdmissionAbortedError()), true);
    assert.equal(isOverload(new SleeperBudgetExhaustedError(12)), true);
  });

  test("and nothing else is", () => {
    // The whole point: an application fault must go on being a 500, or the
    // overload response becomes a place bugs go to hide.
    assert.equal(isOverload(new Error("Cannot read properties of undefined")), false);
    assert.equal(isOverload(new TypeError("fetch failed")), false);
    assert.equal(isOverload({ name: "HttpTimeoutError" }), false);
    assert.equal(isOverload("AdmissionTimeoutError"), false);
    assert.equal(isOverload(null), false);
    assert.equal(isOverload(undefined), false);
  });
});

describe("the overload response", () => {
  test("is a 503 with a Retry-After a browser can act on", async () => {
    const response = overloadResponse();
    assert.equal(response.status, 503);
    assert.equal(
      response.headers.get("Retry-After"),
      String(OVERLOAD_RETRY_AFTER_SECONDS),
    );
    // Never cached: a shed is a fact about this instant, and a CDN holding one
    // would turn a five-second burst into a five-minute outage.
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: OVERLOAD_MESSAGE });
  });

  test("says something about load rather than about a fault", () => {
    assert.doesNotMatch(OVERLOAD_MESSAGE, /error|failed|wrong/i);
  });

  test("the retry window is seconds rather than minutes", () => {
    // What a shed caller waits out is a burst — a full limiter, or a request
    // that spent its own twelve seconds — not an outage.
    assert.ok(OVERLOAD_RETRY_AFTER_SECONDS > 0);
    assert.ok(OVERLOAD_RETRY_AFTER_SECONDS <= 30);
  });
});

describe("mapOverload — the seam a handler with its own catch uses", () => {
  test("answers a refusal", async () => {
    const response = quiet(() => mapOverload(new AdmissionTimeoutError(4_000)));
    assert.ok(response);
    assert.equal(response.status, 503);
  });

  test("and answers null for everything else, so the caller's 500 stands", () => {
    assert.equal(mapOverload(new Error("boom")), null);
  });

  test("does not log a client disconnect as a shed", () => {
    // An abort is the browser having gone, which says nothing about load and
    // must not show up in whatever counts overload.
    const lines: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => lines.push(args);
    try {
      mapOverload(new AdmissionAbortedError());
      assert.deepEqual(lines, []);
      mapOverload(new AdmissionTimeoutError(4_000));
      assert.equal(lines.length, 1);
    } finally {
      console.warn = warn;
    }
  });
});

describe("interactiveRoute — the scope and the mapping are one wrapper", () => {
  test("a handler's own response is returned untouched", async () => {
    const response = await interactiveRoute(async () =>
      Response.json({ ok: true }, { status: 200 }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });

  test("a 4xx a handler produced itself is untouched", async () => {
    // The rule that makes this safe in front of sixteen routes: only the one
    // error class that had no answer gets a new one.
    const response = await interactiveRoute(async () =>
      Response.json({ error: "User not found" }, { status: 404 }),
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Retry-After"), null);
  });

  test("a refusal thrown from *outside* a handler's own try becomes a 503", async () => {
    // The case that motivated the wrapper. Every handler in this app resolves
    // its manager and its season before the `try` it wraps the rest in, so a
    // refusal from either escaped every catch on the page and reached Next as
    // an unhandled exception.
    const response = await quiet(() =>
      interactiveRoute(async () => {
        throw new AdmissionTimeoutError(4_000);
      }),
    );
    assert.equal(response.status, 503);
    assert.equal(
      response.headers.get("Retry-After"),
      String(OVERLOAD_RETRY_AFTER_SECONDS),
    );
    assert.deepEqual(await response.json(), { error: OVERLOAD_MESSAGE });
  });

  test("a spent request budget becomes the same 503", async () => {
    const response = await quiet(() =>
      interactiveRoute(async () => {
        throw new SleeperBudgetExhaustedError(140, "the NFL state");
      }),
    );
    assert.equal(response.status, 503);
  });

  test("an unexpected exception is rethrown, so a route's own 500 still happens", async () => {
    // Rather than mapped here: whatever a handler does about its own failures
    // today, it goes on doing. This adds an answer where there was none; it
    // does not take one over.
    await assert.rejects(
      interactiveRoute(async () => {
        throw new Error("Cannot read properties of undefined");
      }),
      /Cannot read properties of undefined/,
    );
  });

  test("a route that catches for itself still ends at its own 500", async () => {
    // The shape every handler in this app has, with the shared mapper in its
    // catch: a refusal sheds and everything else keeps the route's own body.
    const handler = (thrown: unknown) => async () => {
      try {
        throw thrown;
      } catch (error) {
        const shed = mapOverload(error);
        if (shed) return shed;
        return Response.json({ error: "Failed to load lineups" }, { status: 500 });
      }
    };

    const failed = await interactiveRoute(handler(new Error("boom")));
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "Failed to load lineups" });

    const shed = await quiet(() =>
      interactiveRoute(handler(new AdmissionTimeoutError(4_000))),
    );
    assert.equal(shed.status, 503);
    assert.equal(shed.headers.get("Retry-After"), String(OVERLOAD_RETRY_AFTER_SECONDS));
  });

  test("it opens the interactive scope, which is the other half of its job", async () => {
    // A wrapper that mapped overloads and forgot the scope would leave every
    // read in the handler on the background budget — slow rather than wrong,
    // and invisible.
    let sawInteractive = false;
    let sawDeadline: number | undefined;
    await interactiveRoute(async () => {
      // Read through the same storage a Sleeper read resolves against.
      const { currentSleeperPolicy } = await import("../sleeper/request-policy.ts");
      const policy = currentSleeperPolicy();
      sawInteractive = policy?.requestClass === "interactive";
      sawDeadline = policy?.expiresAt;
      return Response.json({});
    });
    assert.equal(sawInteractive, true);
    assert.ok(sawDeadline !== undefined && sawDeadline > Date.now());
  });

  test("a signal a caller passes reaches the scope", async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await interactiveRoute(
      async () => {
        const { currentSleeperPolicy } = await import("../sleeper/request-policy.ts");
        seen = currentSleeperPolicy()?.signal;
        return Response.json({});
      },
      { signal: controller.signal },
    );
    assert.equal(seen, controller.signal);
  });

  test("nesting it inside a scope does not extend the budget", async () => {
    // `withInteractiveSleeper` is what a page opens; a route helper reached
    // from inside one must describe the same request rather than a new one.
    const at = 1_000_000;
    let inner: number | undefined;
    await withInteractiveSleeper(
      async () =>
        interactiveRoute(async () => {
          const { currentSleeperPolicy } = await import(
            "../sleeper/request-policy.ts"
          );
          inner = currentSleeperPolicy()?.expiresAt;
          return Response.json({});
        }),
      { now: () => at },
    );
    const { INTERACTIVE_REQUEST_BUDGET_MS } = await import(
      "../sleeper/request-policy.ts"
    );
    assert.equal(inner, at + INTERACTIVE_REQUEST_BUDGET_MS);
  });
});
