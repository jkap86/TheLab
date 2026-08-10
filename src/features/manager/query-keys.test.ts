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

  await t.test("the two halves of the ranks read are two entries", () => {
    // `?projections=0` is a genuinely different answer — no weeks, and a null
    // `proj` on every league — so serving one for the other would blank two
    // columns with nothing on screen saying why.
    assert.notEqual(
      hash(managerQueryKeys.ranks("alice", undefined, { projections: true })),
      hash(managerQueryKeys.ranks("alice", undefined, { projections: false })),
    );
  });

  await t.test("the dependent invalidation is a prefix of both halves", () => {
    // React Query matches an invalidation by prefix, which is what lets one
    // entry in `dependentManagerQueryKeys` retire both variants.
    const prefix = managerQueryKeys.ranks("alice");
    for (const projections of [true, false]) {
      const full = managerQueryKeys.ranks("alice", undefined, { projections });
      assert.deepEqual(full.slice(0, prefix.length), [...prefix]);
    }
  });

  await t.test("two resources of one manager never share an entry", () => {
    const keys = [
      managerQueryKeys.leagues("alice"),
      managerQueryKeys.players("alice"),
      managerQueryKeys.leaguemates("alice"),
      managerQueryKeys.ranks("alice"),
      managerQueryKeys.ktc("alice"),
      managerQueryKeys.adpValue("alice", undefined, "steepness=4"),
    ].map(hash);
    assert.equal(new Set(keys).size, keys.length);
  });

  await t.test("two boards are two valuations", () => {
    // The curve is one axis of the board and the population is the rest: both
    // change every card's number, so both have to reach the key. Keying on the
    // steepness alone is what let a drawer narrowed to startup drafts sit above
    // cards still priced off every draft crawled.
    const key = (board: string) => hash(managerQueryKeys.adpValue("alice", undefined, board));
    assert.notEqual(key("steepness=4"), key("steepness=4.5"));
    assert.notEqual(key("steepness=4"), key("steepness=4&rounds_min=12"));
    assert.notEqual(
      key("steepness=4&start_after=2026-06-01"),
      key("steepness=4&start_after=2026-07-01"),
    );
  });

  await t.test("one board assembled two ways is one entry", () => {
    // Normalised like the ADP board's own key, so a re-ordered query string
    // doesn't cost a second request holding an identical payload — which is what
    // makes dragging the steepness back to a curve already read free.
    const key = (board: string) => hash(managerQueryKeys.adpValue("alice", undefined, board));
    assert.equal(
      key("steepness=4&rounds_min=12"),
      key("rounds_min=12&steepness=4"),
    );
  });

  await t.test("every board hangs under the valuation prefix", () => {
    const prefix = managerQueryKeys.adpValues("alice");
    const one = managerQueryKeys.adpValue("alice", undefined, "steepness=4");
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
  const BOARD = "steepness=4&board_season=2026";

  await t.test("two leagues are two entries under one prefix", () => {
    // The panel mounts on expand and clears on change, so a key shared between
    // two leagues would show one league's rosters under the other's name.
    assert.notEqual(
      hash(leagueQueryKeys.detail("123", BOARD)),
      hash(leagueQueryKeys.detail("124", BOARD)),
    );
    assert.deepEqual(leagueQueryKeys.detail("123", BOARD).slice(0, 1), [
      ...leagueQueryKeys.all,
    ]);
  });

  await t.test("two boards of one league are two entries", () => {
    // The rosters don't depend on the board, but the two value columns do and
    // they arrive on the same payload — so a narrowed drawer served from the
    // previous board's entry would show the old prices against the new board.
    assert.notEqual(
      hash(leagueQueryKeys.detail("123", BOARD)),
      hash(leagueQueryKeys.detail("123", `${BOARD}&rounds_min=12`)),
    );
    // …and one board written two ways is still one entry.
    assert.equal(
      hash(leagueQueryKeys.detail("123", "steepness=4&board_season=2026")),
      hash(leagueQueryKeys.detail("123", "board_season=2026&steepness=4")),
    );
  });

  await t.test("every board hangs under its own league's prefix", () => {
    // What lets the hook tell "another board of this league" (keep the rows on
    // screen) from "another league" (clear them) — it compares this prefix.
    const prefix = leagueQueryKeys.league("123");
    const one = leagueQueryKeys.detail("123", BOARD);
    assert.deepEqual(one.slice(0, prefix.length), [...prefix]);
    assert.notDeepEqual(
      leagueQueryKeys.detail("124", BOARD).slice(0, prefix.length),
      [...prefix],
    );
  });

  await t.test("it is not manager-scoped, since a league belongs to all its members", () => {
    // Two managers expanding the same league read one answer; filing it under
    // the searched name would fetch the same standings once per reader.
    assert.ok(!hash(leagueQueryKeys.detail("123", BOARD)).includes(managerQueryKeys.all[0]));
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
