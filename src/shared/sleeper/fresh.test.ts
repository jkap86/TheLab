import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CACHE_BUST_PARAM, cacheBustToken, freshUrl } from "./fresh.ts";

const URL_PLAIN = "https://api.sleeper.app/v1/league/123/rosters";
const URL_QUERIED = "https://api.sleeper.app/v1/league/123/rosters?page=2";

describe("cacheBustToken", () => {
  test("varies with the clock, which is the whole job", () => {
    // A token that does not vary busts nothing: the CDN sees one cache key and
    // serves the copy the press exists to get past.
    assert.notEqual(cacheBustToken(1), cacheBustToken(2));
  });

  test("is a string, so it composes into a URL without a cast", () => {
    assert.equal(cacheBustToken(1_800_000_000_000), "1800000000000");
  });
});

describe("freshUrl", () => {
  test("an absent token hands the URL back untouched", () => {
    // The common path, and the reason every getter can offer the parameter
    // while every caller but the refresh press keeps hitting the cacheable URL.
    assert.equal(freshUrl(URL_PLAIN), URL_PLAIN);
    assert.equal(freshUrl(URL_PLAIN, ""), URL_PLAIN);
  });

  test("appends with ? on a bare URL", () => {
    assert.equal(freshUrl(URL_PLAIN, "42"), `${URL_PLAIN}?${CACHE_BUST_PARAM}=42`);
  });

  test("composes with a URL that already has a query string", () => {
    // Appending `?` blindly makes a malformed URL, which Sleeper answers 404,
    // which `sleeperGetOptional` folds — so the bug would present as a league
    // that has gone away rather than as a bad request.
    assert.equal(
      freshUrl(URL_QUERIED, "42"),
      `${URL_QUERIED}&${CACHE_BUST_PARAM}=42`,
    );
  });

  test("encodes the token rather than trusting it", () => {
    assert.equal(freshUrl(URL_PLAIN, "a b&c"), `${URL_PLAIN}?_=a%20b%26c`);
  });
});
