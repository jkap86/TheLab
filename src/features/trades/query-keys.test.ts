import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { tradesQueryKeys } from "./query-keys.ts";

/**
 * The keys the trades board is cached under.
 *
 * React Query hashes keys structurally, so what these assert is deep equality:
 * two keys that are equal are one entry, and two that differ are two requests.
 * That matters more on this board than anywhere else in the app — a miss is a
 * fresh first page and a lost scroll position, since the cursor is the query's
 * own state.
 */

describe("tradesQueryKeys", () => {
  test("everything hangs off one prefix, which is what an invalidation reaches", () => {
    for (const key of [
      tradesQueryKeys.board("season=2026"),
      tradesQueryKeys.leagues("2026"),
      tradesQueryKeys.facets("season=2026"),
    ]) {
      assert.equal(key[0], tradesQueryKeys.all[0]);
    }
  });

  test("it is outside the manager prefix, because the route asks about no account", () => {
    // The board describes every crawled league's trades, so a manager-scoped
    // invalidation has no business throwing it away — the same standing the ADP
    // board's own key has.
    assert.deepEqual(tradesQueryKeys.all, ["trades"]);
    assert.notEqual(tradesQueryKeys.all[0], "manager");
  });

  test("the three resources are three entries, not one keyed loosely", () => {
    // They are three routes answering three questions over one population; a
    // shared segment would let a board's page overwrite the menus.
    const keys = [
      tradesQueryKeys.board("season=2026"),
      tradesQueryKeys.leagues("2026"),
      tradesQueryKeys.facets("season=2026"),
    ];
    for (const [i, a] of keys.entries()) {
      for (const b of keys.slice(i + 1)) assert.notDeepEqual(a, b);
    }
  });

  test("a board is keyed by its whole query string, filters included", () => {
    // A filter change is a *different key* rather than an invalidation, which is
    // what lets widening back find the old board still loaded with its scroll
    // position.
    assert.notDeepEqual(
      tradesQueryKeys.board("season=2026"),
      tradesQueryKeys.board("season=2026&players=bijan"),
    );
    assert.deepEqual(
      tradesQueryKeys.board("season=2026&players=bijan"),
      tradesQueryKeys.board("season=2026&players=bijan"),
    );
  });

  test("the menus and the board are keyed separately, since one moves and one doesn't", () => {
    // The facets are counted *without* the selection — a checkbox cannot change
    // them — where the board's own total changes on every press. Sharing a key
    // would re-run a season-wide grouped aggregate for an unchanged answer.
    const scope = "season=2026";
    assert.notDeepEqual(tradesQueryKeys.facets(scope), tradesQueryKeys.board(scope));
  });

  test("the league list is keyed by season alone", () => {
    // It is the league rules' input and every card's name — a fact about the
    // season, not about the reader's selection.
    assert.deepEqual(tradesQueryKeys.leagues("2026"), ["trades", "leagues", "2026"]);
    assert.notDeepEqual(tradesQueryKeys.leagues("2026"), tradesQueryKeys.leagues("2025"));
  });

  test("a key is flat strings, so two spellings of one request cannot look alike", () => {
    // The board carries the *normalised query string* rather than the filter
    // objects for exactly this reason: two objects describing one request would
    // be two entries.
    for (const segment of tradesQueryKeys.board("season=2026")) {
      assert.equal(typeof segment, "string");
    }
  });
});
