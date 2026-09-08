import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classifyUserLeagues } from "./enumeration.ts";

/**
 * The one decision in the Sleeper client that is silently wrong rather than
 * loudly wrong.
 *
 * A manager's enumeration is authoritative for which leagues are theirs, so
 * "Sleeper says none" empties their page — which makes "we could not read the
 * answer" a completely different sentence that has to be told apart from it.
 * `sleeperGet` cannot: it folds a 200-with-null into whatever fallback the
 * caller passed, so a body nobody could parse arrives spelled exactly like a
 * manager with no leagues. Every case below is a body this endpoint has been
 * seen to send or could send.
 */
describe("classifyUserLeagues", () => {
  test("an array is the answer, however many leagues are in it", () => {
    const leagues = [{ league_id: "1" }, { league_id: "2" }];
    const result = classifyUserLeagues(leagues);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.leagues, leagues);
  });

  test("an EMPTY array is a confirmed answer, not an absence", () => {
    // The whole point. This is what lets a manager who has left every league
    // see zero leagues, and what the old `[]` fallback made unreachable.
    const result = classifyUserLeagues([]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.leagues, []);
  });

  test("null is unreadable, never a confirmed empty list", () => {
    // Sleeper's documented convention says null means "no data"; this refuses
    // to act on it, because null is also what an unresolvable user, a
    // truncated body and a proxy's empty answer all look like from here. The
    // cost is one extra attempt; the other direction empties a page.
    assert.deepEqual(classifyUserLeagues(null), {
      ok: false,
      reason: "unreadable",
    });
  });

  test("undefined is unreadable", () => {
    assert.equal(classifyUserLeagues(undefined).ok, false);
  });

  test("an object is unreadable — an error envelope is not a league list", () => {
    assert.equal(classifyUserLeagues({ error: "not found" }).ok, false);
    assert.equal(classifyUserLeagues({}).ok, false);
  });

  test("a string is unreadable — an HTML error page parses as one", () => {
    assert.equal(classifyUserLeagues("<!doctype html>").ok, false);
    assert.equal(classifyUserLeagues("").ok, false);
  });

  test("a number is unreadable", () => {
    assert.equal(classifyUserLeagues(0).ok, false);
  });
});
