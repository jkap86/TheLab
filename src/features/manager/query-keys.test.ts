import assert from "node:assert/strict";
import test from "node:test";

import {
  boardQueryKeys,
  dependentManagerQueryKeys,
  leagueQueryKeys,
  managerQueryKeys,
  normalizeAdpQuery,
  scheduleQueryKeys,
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

test("the ADP board's key, as this feature re-exports it", async (t) => {
  // The board's own behaviour is `features/shared/adp-query.test.ts`, where the
  // module lives; what this feature has to keep is that the name it hands out
  // still reaches that one definition, and that the board it keys stays outside
  // the manager prefix.
  await t.test("the re-export is that module's own normaliser, not a copy", async () => {
    const shared = await import("../shared/adp-query.ts");
    assert.equal(normalizeAdpQuery, shared.normalizeAdpQuery);
    assert.equal(boardQueryKeys, shared.boardQueryKeys);
  });

  await t.test("the board is not filed under the manager", () => {
    // A board is a fact about the crawled drafts, so it must survive a
    // manager-wide invalidation and not be re-fetched per manager.
    const key = hash(boardQueryKeys.adp("season=2026"));
    assert.ok(!key.includes(managerQueryKeys.all[0]));
    assert.notEqual(key, hash(boardQueryKeys.density()));
  });
});

test("leagueQueryKeys", async (t) => {
  await t.test("two leagues are two entries under one prefix", () => {
    // The panel mounts on expand and clears on change, so a key shared between
    // two leagues would show one league's rosters under the other's name.
    assert.notEqual(hash(leagueQueryKeys.detail("123")), hash(leagueQueryKeys.detail("124")));
    assert.deepEqual(leagueQueryKeys.detail("123").slice(0, 1), [...leagueQueryKeys.all]);
  });

  await t.test("it is not manager-scoped, since a league belongs to all its members", () => {
    // Two managers expanding the same league read one answer; filing it under
    // the searched name would fetch the same standings once per reader.
    assert.ok(!hash(leagueQueryKeys.detail("123")).includes(managerQueryKeys.all[0]));
  });
});

test("scheduleQueryKeys", async (t) => {
  await t.test("kickoff is keyed by season and nothing else", () => {
    // One instant for the whole app — it belongs to no manager, and the header
    // that draws it renders on every manager page.
    assert.deepEqual(scheduleQueryKeys.kickoff("2026"), ["kickoff", "2026"]);
    assert.notEqual(
      hash(scheduleQueryKeys.kickoff("2026")),
      hash(scheduleQueryKeys.kickoff("2025")),
    );
    assert.ok(!hash(scheduleQueryKeys.kickoff("2026")).includes(managerQueryKeys.all[0]));
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
