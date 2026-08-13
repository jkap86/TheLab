import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CACHE_BUST_PARAM, cacheBustToken, freshUrl } from "./fresh.ts";

/**
 * What a cache-busted URL has to promise, none of which a type can carry.
 *
 * Both ways of getting this wrong render as working code. A token that does not
 * vary is a cache-buster that busts nothing — the URL is stable, so the edge
 * answers it exactly as before and the press it was added for still shows stale
 * data. And a parameter appended without regard to what is already on the URL
 * produces a request Sleeper answers with a 404, which reads as a league that has
 * gone away.
 */

describe("freshUrl", () => {
  test("no token leaves the URL byte-for-byte alone", () => {
    // The background loops are almost all of this app's traffic and pass none:
    // busting the cache for them would move every one of those requests onto
    // Sleeper's origin for a freshness nobody asked for.
    const url = "https://api.sleeper.app/v1/league/123/rosters";
    assert.equal(freshUrl(url), url);
    assert.equal(freshUrl(url, ""), url);
  });

  test("a token is appended as the first parameter of a bare URL", () => {
    assert.equal(
      freshUrl("https://api.sleeper.app/v1/league/123/rosters", "1755100000000"),
      "https://api.sleeper.app/v1/league/123/rosters?_=1755100000000",
    );
  });

  test("it joins a URL that already carries a query string", () => {
    // Nothing in this app sends one today; the day something does, an assumed
    // `?` is a second question mark and an upstream 404.
    assert.equal(
      freshUrl("https://api.sleeper.app/v1/x?a=1", "42"),
      "https://api.sleeper.app/v1/x?a=1&_=42",
    );
  });

  test("the token is encoded, so it can never break out of the query", () => {
    assert.equal(freshUrl("https://x/y", "a b&c=d"), "https://x/y?_=a%20b%26c%3Dd");
  });

  test("the parameter is the one every client uses for this", () => {
    // Named rather than spelled at each call site, and deliberately not a word
    // Sleeper might one day give a meaning to.
    assert.equal(CACHE_BUST_PARAM, "_");
  });
});

describe("cacheBustToken", () => {
  test("two presses never share a token", () => {
    // The whole point: a repeated token is a repeated URL, which is a URL the
    // edge can answer from its own copy. The refresh's cooldown is measured in
    // seconds, so a millisecond stamp cannot collide across two presses.
    assert.notEqual(cacheBustToken(1_755_100_000_000), cacheBustToken(1_755_100_000_001));
  });

  test("it is the timestamp, readable in a log line", () => {
    // A random value would bust the cache just as well and say nothing about
    // *when* — and these land in an access log one press at a time.
    assert.equal(cacheBustToken(1_755_100_000_000), "1755100000000");
  });

  test("it is URL-safe as minted, so nothing depends on the encoding", () => {
    assert.match(cacheBustToken(), /^[0-9]+$/);
  });
});
