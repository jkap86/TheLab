import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { memoizeManagerLookup } from "./memoize-manager-lookup.ts";
import type { ManagerLookup } from "./resolve-manager-id.ts";

/**
 * The memo's two decisions that are silent when wrong: a rejection is evicted
 * so a 502 is retryable, and — the one this file was written for — a refreshed
 * key moves to the back of the eviction line. `Map.set` on an existing key
 * keeps its original insertion position, so a memo that refreshed in place
 * would evict the answer it had just fetched the moment a new name arrived.
 */

type User = NonNullable<Awaited<ReturnType<ManagerLookup>>>;

const user = (name: string): User => ({ user_id: name } as unknown as User);

/** A lookup that counts its calls, resolving every name to a stub user. */
function countingLookup() {
  const calls: string[] = [];
  const lookup: ManagerLookup = (name) => {
    calls.push(name.toLowerCase());
    return Promise.resolve(user(name));
  };
  return { calls, lookup };
}

describe("memoizeManagerLookup", () => {
  test("serves a hit inside the TTL, case-insensitively", async () => {
    const { calls, lookup } = countingLookup();
    const memo = memoizeManagerLookup(lookup, { ttlMs: 1000, now: () => 0 });

    await memo("Jkap");
    await memo("jkap");
    assert.deepEqual(calls, ["jkap"]);
  });

  test("a refreshed key is not the next evicted", async () => {
    const { calls, lookup } = countingLookup();
    let clock = 0;
    const memo = memoizeManagerLookup(lookup, {
      ttlMs: 1000,
      max: 2,
      now: () => clock,
    });

    await memo("a"); // oldest by insertion
    clock = 1;
    await memo("b");
    assert.deepEqual(calls, ["a", "b"]);

    // `a` expires and is refreshed. Refreshed *in place* it would still be the
    // first key in insertion order — and the next name past the bound would
    // evict exactly the answer just fetched for it.
    clock = 1001;
    await memo("a");
    assert.deepEqual(calls, ["a", "b", "a"]);

    await memo("c"); // size 3 > max 2: one eviction, of the genuinely oldest
    assert.deepEqual(calls, ["a", "b", "a", "c"]);

    await memo("a");
    assert.deepEqual(calls, ["a", "b", "a", "c"], "the refreshed key survived");

    await memo("b");
    assert.deepEqual(calls, ["a", "b", "a", "c", "b"], "b was the one evicted");
  });

  test("a rejected lookup is evicted so the next ask retries", async () => {
    let attempts = 0;
    const lookup: ManagerLookup = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("502"))
        : Promise.resolve(user("x"));
    };
    const memo = memoizeManagerLookup(lookup, { ttlMs: 1000, now: () => 0 });

    await assert.rejects(memo("x"));
    // The rejection handler that evicts runs on a later microtask.
    await new Promise((r) => setImmediate(r));
    assert.equal((await memo("x"))?.user_id, "x");
    assert.equal(attempts, 2);
  });
});
