import assert from "node:assert/strict";
import test from "node:test";

import {
  boardQueryKeys,
  dependentManagerQueryKeys,
  managerQueryKeys,
  normalizeAdpQuery,
} from "./query-keys.ts";

/** What the cache actually compares: the hash of the key, not the array. */
const hash = (key: readonly unknown[]): string => JSON.stringify(key);

test("managerQueryKeys", async (t) => {
  await t.test("two managers never share an entry", () => {
    assert.notEqual(
      hash(managerQueryKeys.ktc("alice")),
      hash(managerQueryKeys.ktc("bob")),
    );
    assert.notEqual(
      hash(managerQueryKeys.leagues("alice")),
      hash(managerQueryKeys.leagues("bob")),
    );
  });

  await t.test("one manager under two spellings is one entry", () => {
    // Sleeper resolves `Jkap` and `jkap` to the same account, so two entries for
    // them is the duplicate request the factory exists to remove.
    assert.equal(hash(managerQueryKeys.players("JKap")), hash(managerQueryKeys.players("jkap")));
  });

  await t.test("two seasons never share an entry", () => {
    assert.notEqual(
      hash(managerQueryKeys.ranks("alice", "2025")),
      hash(managerQueryKeys.ranks("alice", "2026")),
    );
    // An omitted season is its own selection, not one of the named ones.
    assert.notEqual(
      hash(managerQueryKeys.ranks("alice")),
      hash(managerQueryKeys.ranks("alice", "2026")),
    );
  });

  await t.test("two resources of one manager never share an entry", () => {
    const keys = [
      managerQueryKeys.leagues("alice"),
      managerQueryKeys.players("alice"),
      managerQueryKeys.leaguemates("alice"),
      managerQueryKeys.ranks("alice"),
      managerQueryKeys.ktc("alice"),
      managerQueryKeys.adpValue("alice", undefined, 4),
    ].map(hash);
    assert.equal(new Set(keys).size, keys.length);
  });

  await t.test("two steepness values are two valuations", () => {
    assert.notEqual(
      hash(managerQueryKeys.adpValue("alice", undefined, 4)),
      hash(managerQueryKeys.adpValue("alice", undefined, 4.5)),
    );
    // …and the same one twice is one entry, which is what makes dragging the
    // slider back to a curve already read cost nothing.
    assert.equal(
      hash(managerQueryKeys.adpValue("alice", undefined, 4)),
      hash(managerQueryKeys.adpValue("alice", undefined, "4")),
    );
  });

  await t.test("every curve hangs under the valuation prefix", () => {
    const prefix = managerQueryKeys.adpValues("alice");
    const one = managerQueryKeys.adpValue("alice", undefined, 4);
    assert.deepEqual(one.slice(0, prefix.length), [...prefix]);
  });
});

test("normalizeAdpQuery", async (t) => {
  await t.test("parameter order doesn't make a second board", () => {
    assert.deepEqual(
      normalizeAdpQuery("season=2026&limit=1000&draft_type=snake,linear"),
      normalizeAdpQuery("draft_type=snake,linear&limit=1000&season=2026"),
    );
  });

  await t.test("a changed filter is a different board", () => {
    assert.notDeepEqual(
      normalizeAdpQuery("season=2026&superflex=1"),
      normalizeAdpQuery("season=2026&superflex=0"),
    );
    // A filter the other side omits is a narrowing, not the same question.
    assert.notDeepEqual(
      normalizeAdpQuery("season=2026"),
      normalizeAdpQuery("season=2026&teams_min=12"),
    );
  });

  await t.test("a repeated parameter is kept, not collapsed", () => {
    assert.deepEqual(normalizeAdpQuery("scoring=ppr&scoring=std"), [
      ["scoring", "ppr"],
      ["scoring", "std"],
    ]);
  });

  await t.test("the board is not filed under the manager", () => {
    // A board is a fact about the crawled drafts, so it must survive a
    // manager-wide invalidation and not be re-fetched per manager.
    const key = hash(boardQueryKeys.adp("season=2026"));
    assert.ok(!key.includes("manager"));
    assert.notEqual(key, hash(boardQueryKeys.density()));
  });
});

test("dependentManagerQueryKeys", async (t) => {
  const dependents = dependentManagerQueryKeys("alice").map(hash);

  await t.test("holds the five reads a sync rewrites", () => {
    assert.equal(dependents.length, 5);
    for (const key of [
      managerQueryKeys.players("alice"),
      managerQueryKeys.leaguemates("alice"),
      managerQueryKeys.ranks("alice"),
      managerQueryKeys.ktc("alice"),
      managerQueryKeys.adpValues("alice"),
    ]) {
      assert.ok(dependents.includes(hash(key)), `missing ${hash(key)}`);
    }
  });

  await t.test("holds neither the leagues themselves nor the ADP board", () => {
    // The leagues entry *is* the change and already holds the new data; the
    // board describes the database, not this manager.
    assert.ok(!dependents.includes(hash(managerQueryKeys.leagues("alice"))));
    assert.ok(!dependents.includes(hash(boardQueryKeys.adp("season=2026"))));
  });

  await t.test("names one manager's reads only", () => {
    for (const key of dependents) assert.ok(!key.includes("bob"));
  });
});
