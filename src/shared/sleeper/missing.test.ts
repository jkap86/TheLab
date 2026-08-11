import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isMissingResource } from "./missing.ts";

/**
 * The predicate that decides whether a Sleeper failure is an answer.
 *
 * Worth pinning because every mistake it can make is invisible at the call
 * site: what a wrong answer here produces is not an error but a *fallback* —
 * an empty roster list, an empty week of transactions — travelling on into a
 * transaction that persists it. The two directions fail differently and both
 * matter, so both are asserted rather than only the happy 404.
 */

/** An axios error as the client sees one: a response with a status on it. */
const withStatus = (status: number) => ({ response: { status } });

describe("isMissingResource", () => {
  test("404 is Sleeper's other spelling of a null body", () => {
    assert.equal(isMissingResource(withStatus(404)), true);
  });

  test("a rate limit is a fault, never an absent resource", () => {
    // The failure this guards is the quiet one: folded, a throttled crawl
    // writes empty collections over rows that were perfectly good.
    assert.equal(isMissingResource(withStatus(429)), false);
  });

  test("no other status folds", () => {
    for (const status of [200, 400, 401, 403, 410, 500, 502, 503]) {
      assert.equal(
        isMissingResource(withStatus(status)),
        false,
        `status ${status} must not read as missing`,
      );
    }
  });

  test("a request that never got a response is never missing", () => {
    // A timeout or a DNS failure learned nothing about whether the resource
    // exists, so there is no answer to fold — it has to stay an error.
    for (const error of [
      new Error("timeout of 30000ms exceeded"),
      { request: {} },
      { response: undefined },
      { response: {} },
      null,
      undefined,
      "404",
    ]) {
      assert.equal(
        isMissingResource(error),
        false,
        `${JSON.stringify(error) ?? String(error)} must not read as missing`,
      );
    }
  });
});
