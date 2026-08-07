import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isSleeperUserId,
  memoizeManagerLookup,
  resolveManagerId,
} from "./user-resolution.ts";
import type { ManagerLookup, SleeperUserLike } from "./user-resolution.ts";

/**
 * Who a manager route thinks it is answering about, and how many times Sleeper
 * had to be asked to find out.
 *
 * The number is the point. A manager page is one username and five reads — the
 * leagues stream plus rosters, membership, ranks, values and the ADP valuation —
 * and every one of those routes used to open with `GET /v1/user/<name>`, four of
 * them purely to arrive at an id the leagues response had already sent. What is
 * pinned below is the shape of the fix: the resolver route looks the name up,
 * the database-backed ones take the id, and nothing about direct navigation
 * changes.
 */

const alice: SleeperUserLike = {
  user_id: "12345678901234567",
  username: "alice",
  display_name: "Alice",
  avatar: null,
};

/** A lookup that answers from a table and counts what it was asked. */
function countingLookup(
  answers: Record<string, SleeperUserLike | null> = { alice },
): ManagerLookup & { calls: string[] } {
  const calls: string[] = [];
  const lookup = async (name: string) => {
    calls.push(name);
    return answers[name.toLowerCase()] ?? null;
  };
  lookup.calls = calls;
  return lookup;
}

describe("isSleeperUserId", () => {
  test("accepts a digit string of a plausible length", () => {
    assert.ok(isSleeperUserId("12345678901234567"));
    assert.ok(isSleeperUserId("7"));
  });

  test("rejects anything that is not one", () => {
    // Deliberately narrower than the username rules: a name that could pass as
    // an id is a name that would silently skip resolution.
    for (const value of [
      "",
      "alice",
      "123abc",
      "123 456",
      "'; DROP TABLE rosters; --",
      "1".repeat(33),
      null,
      undefined,
      12345,
      ["123"],
    ]) {
      assert.equal(isSleeperUserId(value), false, String(value));
    }
  });
});

describe("resolveManagerId", () => {
  test("a hinted id costs no Sleeper request", async () => {
    const lookup = countingLookup();
    const resolved = await resolveManagerId("alice", alice.user_id, lookup);
    assert.deepEqual(resolved, {
      ok: true,
      userId: alice.user_id,
      // No profile, because nothing was fetched — a route that needs one must
      // resolve rather than hint.
      user: null,
    });
    assert.equal(lookup.calls.length, 0);
  });

  test("a manager page is one lookup, not one per resource", async () => {
    const lookup = countingLookup();

    // The leagues route resolves the name; its payload carries the canonical id.
    const leagues = await resolveManagerId("alice", null, lookup);
    assert.equal(leagues.ok && leagues.userId, alice.user_id);

    // The five database-backed reads then send that id back.
    for (const path of ["players", "leaguemates", "ranks", "ktc", "adp-value"]) {
      const resolved = await resolveManagerId("alice", alice.user_id, lookup);
      assert.equal(resolved.ok && resolved.userId, alice.user_id, path);
    }

    assert.deepEqual(lookup.calls, ["alice"], "one username lookup for the page");
  });

  test("without a hint it resolves exactly as before", async () => {
    // Direct navigation, a bookmark, an older client: nothing depends on the
    // hint being there.
    const lookup = countingLookup();
    const resolved = await resolveManagerId("alice", null, lookup);
    assert.equal(resolved.ok && resolved.userId, alice.user_id);
    assert.equal(resolved.ok && resolved.user?.username, "alice");
    assert.equal(lookup.calls.length, 1);
  });

  test("an unusable hint falls through to the lookup rather than failing", async () => {
    const lookup = countingLookup();
    for (const hint of ["", "not-an-id", null, undefined, 7]) {
      const resolved = await resolveManagerId("alice", hint, lookup);
      assert.equal(resolved.ok && resolved.userId, alice.user_id, String(hint));
    }
    assert.equal(lookup.calls.length, 5);
  });

  test("an unknown manager is still a 404", async () => {
    const resolved = await resolveManagerId("nobody", null, countingLookup());
    assert.deepEqual(resolved, {
      ok: false,
      status: 404,
      error: "User not found",
    });
  });

  test("a blank username is still a 400", async () => {
    const lookup = countingLookup();
    const resolved = await resolveManagerId("   ", null, lookup);
    assert.equal(resolved.ok === false && resolved.status, 400);
    assert.equal(lookup.calls.length, 0);
  });

  test("an unreachable Sleeper is still a 502", async () => {
    const resolved = await resolveManagerId("alice", null, async () => {
      throw new Error("ECONNRESET");
    });
    assert.equal(resolved.ok === false && resolved.status, 502);
  });
});

describe("memoizeManagerLookup", () => {
  test("collapses repeats inside the TTL", async () => {
    const lookup = countingLookup();
    let now = 0;
    const memo = memoizeManagerLookup(lookup, { ttlMs: 1000, now: () => now });

    assert.equal((await memo("alice"))?.user_id, alice.user_id);
    assert.equal((await memo("alice"))?.user_id, alice.user_id);
    assert.equal(lookup.calls.length, 1);

    now = 1001;
    await memo("alice");
    assert.equal(lookup.calls.length, 2, "and asks again once the TTL is out");
  });

  test("one manager under two spellings is one entry", async () => {
    // Sleeper resolves `Jkap` and `jkap` to one account, which is the duplicate
    // request the client's own keys lower-case for.
    const lookup = countingLookup();
    const memo = memoizeManagerLookup(lookup);
    await Promise.all([memo("alice"), memo("Alice"), memo("ALICE")]);
    assert.equal(lookup.calls.length, 1);
  });

  test("collapses requests that arrive together", async () => {
    // The in-flight promise is what is cached, not the settled answer — a cache
    // that only remembers results collapses neither of two simultaneous reads.
    let resolve: (user: SleeperUserLike) => void = () => {};
    let calls = 0;
    const memo = memoizeManagerLookup(async () => {
      calls += 1;
      return new Promise<SleeperUserLike>((r) => {
        resolve = r;
      });
    });

    const both = Promise.all([memo("alice"), memo("alice")]);
    resolve(alice);
    const [a, b] = await both;
    assert.equal(calls, 1);
    assert.equal(a?.user_id, alice.user_id);
    assert.equal(b?.user_id, alice.user_id);
  });

  test("remembers a null but not a failure", async () => {
    let calls = 0;
    const memo = memoizeManagerLookup(async (name) => {
      calls += 1;
      if (name === "boom") throw new Error("upstream down");
      return null;
    });

    // "No such user" is a real answer, and the one an abusive caller can
    // manufacture endlessly — so it is cached.
    await memo("nobody");
    await memo("nobody");
    assert.equal(calls, 1);

    // A failure is a 502 the caller should be able to retry at once, so it is
    // not held.
    await assert.rejects(memo("boom"));
    await assert.rejects(memo("boom"));
    assert.equal(calls, 3);
  });

  test("is bounded", async () => {
    const lookup = countingLookup();
    const memo = memoizeManagerLookup(lookup, { max: 2 });
    await memo("a");
    await memo("b");
    await memo("c");
    // "a" was evicted, so asking again is a real lookup rather than a hit.
    await memo("a");
    assert.equal(lookup.calls.length, 4);
    // …while the newest is still held.
    await memo("c");
    assert.equal(lookup.calls.length, 4);
  });

  test("clear drops everything", async () => {
    const lookup = countingLookup();
    const memo = memoizeManagerLookup(lookup);
    await memo("alice");
    memo.clear();
    await memo("alice");
    assert.equal(lookup.calls.length, 2);
  });
});
