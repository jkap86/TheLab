import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ADP_STALE_TIMES, boardQueryKeys, normalizeAdpQuery } from "./adp-query.ts";

/**
 * The board's cache key, which is a *serialization* problem rather than a
 * naming one: two readers assemble the same filters independently — the manager
 * tool's Players column and the drawer above it, the trades page's own trigger —
 * and the only thing making those one request instead of several is that the key
 * normalises what they built rather than hashing the string they happened to
 * build it as.
 *
 * React Query hashes keys structurally, so the assertions here are about deep
 * equality: two keys that are `deepEqual` are one cache entry, and two that
 * aren't are two requests.
 */

/** What React Query compares — two keys landing on one entry look the same here. */
const same = (a: unknown, b: unknown) => {
  assert.deepEqual(a, b);
};

const different = (a: unknown, b: unknown) => {
  assert.notDeepEqual(a, b);
};

describe("normalizeAdpQuery", () => {
  test("parameter order doesn't change the meaning, so it doesn't change the key", () => {
    // The failure this exists to stop: two call sites building the same board in
    // a different order, landing on two entries and issuing two requests that
    // look like a hit in the code and a miss in the network panel.
    same(
      normalizeAdpQuery("season=2026&limit=1000&draft_type=snake,linear"),
      normalizeAdpQuery("draft_type=snake,linear&limit=1000&season=2026"),
    );
  });

  test("a repeated parameter is kept, not collapsed to its last value", () => {
    // A query string allows repeats and the route's `list` primitive reads them
    // — `?scoring=ppr&scoring=half_ppr` is a two-value filter. Reducing to a
    // plain object here would key two different boards identically.
    const repeated = normalizeAdpQuery("scoring=ppr&scoring=half_ppr");
    assert.deepEqual(repeated, [
      ["scoring", "half_ppr"],
      ["scoring", "ppr"],
    ]);
    different(repeated, normalizeAdpQuery("scoring=half_ppr"));
    different(repeated, normalizeAdpQuery("scoring=ppr"));
  });

  test("repeats in either order are the same selection", () => {
    // Sorted by value as well as by name, or the same two-value filter written
    // the other way round would be a second entry.
    same(
      normalizeAdpQuery("scoring=ppr&scoring=half_ppr"),
      normalizeAdpQuery("scoring=half_ppr&scoring=ppr"),
    );
  });

  test("values arrive decoded, so one encoding of a filter is not two boards", () => {
    same(normalizeAdpQuery("draft_type=snake%2Clinear"), normalizeAdpQuery("draft_type=snake,linear"));
    // `+` is a space in a query string, which is the one decoding that differs
    // from `decodeURIComponent` — worth pinning, since a value with a space
    // written both ways has to key alike.
    same(normalizeAdpQuery("k=a+b"), normalizeAdpQuery("k=a%20b"));
  });

  test("an empty query is an empty key, not a key with an empty pair", () => {
    assert.deepEqual(normalizeAdpQuery(""), []);
    same(normalizeAdpQuery(""), normalizeAdpQuery("?"));
  });

  test("a valueless parameter keeps its name with an empty value", () => {
    // `?best_ball=` is how the tri-state filters spell "don't narrow", and the
    // route reads the presence of the key — so it must not vanish from the key.
    assert.deepEqual(normalizeAdpQuery("best_ball="), [["best_ball", ""]]);
    different(normalizeAdpQuery("best_ball="), normalizeAdpQuery(""));
  });

  test("a leading ? is not part of the first parameter's name", () => {
    same(normalizeAdpQuery("?season=2026"), normalizeAdpQuery("season=2026"));
  });

  test("different filters are different keys", () => {
    different(normalizeAdpQuery("season=2026"), normalizeAdpQuery("season=2025"));
    different(normalizeAdpQuery("season=2026"), normalizeAdpQuery("season=2026&teams_min=12"));
  });
});

describe("boardQueryKeys", () => {
  test("the board and the density strip are siblings under one prefix", () => {
    // The prefix is what a board-wide invalidation reaches; the two are separate
    // entries under it because they are separate routes.
    assert.deepEqual(boardQueryKeys.all, ["adp"]);
    assert.equal(boardQueryKeys.adp("season=2026")[0], "adp");
    assert.equal(boardQueryKeys.density()[0], "adp");
    different(boardQueryKeys.adp("season=2026"), boardQueryKeys.density());
  });

  test("it is not under any feature's prefix, since it describes no account", () => {
    // The board is the same answer whoever is being looked at, so a
    // manager-scoped invalidation has no business throwing it away.
    assert.notEqual(boardQueryKeys.all[0], "manager");
    assert.notEqual(boardQueryKeys.all[0], "trades");
  });

  test("the key normalises, so the two readers of one board share an entry", () => {
    same(
      boardQueryKeys.adp("limit=1000&season=2026"),
      boardQueryKeys.adp("season=2026&limit=1000"),
    );
    different(boardQueryKeys.adp("season=2026"), boardQueryKeys.adp("season=2025"));
  });

  test("the density strip takes no arguments — it is one answer for every board", () => {
    same(boardQueryKeys.density(), boardQueryKeys.density());
  });
});

describe("ADP_STALE_TIMES", () => {
  test("the board is the shorter of the two, since it is what a filter moves", () => {
    // A month-grain histogram of the same drafts moves slower than the average
    // over them, and the strip is a readout rather than the answer being read.
    assert.ok(ADP_STALE_TIMES.board > 0);
    assert.ok(ADP_STALE_TIMES.density >= ADP_STALE_TIMES.board);
  });
});
