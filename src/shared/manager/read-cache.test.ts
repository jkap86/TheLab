import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AdpFilters } from "./adp-filters.ts";
import {
  ADP_BOARD_CACHE,
  LEAGUE_DETAIL_CACHE,
  MANAGER_RANKS_CACHE,
  adpBoardCacheKey,
  managerRanksCacheKey,
} from "./read-cache.ts";

/**
 * A cache key is wrong *silently*. Too narrow and one population's board is
 * served under another's filters — a real number, from a real query, about
 * drafts nobody asked for. Too wide and the cache simply never hits, which
 * profiles as "the cache didn't help" rather than as a bug. So what these tests
 * assert is the agreement itself: **for every field of the filters, changing it
 * changes the key, and changing nothing does not.**
 *
 * The field table is checked against the type's own shape first, so a filter
 * added to `AdpFilters` and forgotten in the key fails here rather than in
 * production.
 */

const BASE: AdpFilters = {
  seasons: ["2026"],
  start_after: "2026-01-01",
  start_before: "2026-06-30",
  draft_types: ["snake", "linear"],
  draft_statuses: ["complete"],
  league_ids: ["1", "2"],
  exclude_league_ids: ["9"],
  scoring: ["ppr"],
  best_ball: false,
  superflex: true,
  rounds_min: 12,
  rounds_max: 25,
  teams_min: 10,
  teams_max: 14,
  min_picks: 2,
  limit: 1000,
  offset: 0,
};

/** One alternate value per field — each a board a reader could actually ask for. */
const ALTERNATES: { [K in keyof AdpFilters]: AdpFilters[K] } = {
  seasons: ["2025"],
  start_after: "2026-02-01",
  start_before: "2026-07-31",
  draft_types: ["snake"],
  draft_statuses: ["complete", "drafting"],
  league_ids: ["1", "3"],
  exclude_league_ids: ["8"],
  scoring: ["half_ppr"],
  best_ball: true,
  superflex: false,
  rounds_min: 1,
  rounds_max: 11,
  teams_min: 12,
  teams_max: 12,
  min_picks: 1,
  limit: 200,
  offset: 200,
};

describe("adpBoardCacheKey", () => {
  test("the same filters key the same board", () => {
    assert.equal(adpBoardCacheKey(BASE), adpBoardCacheKey({ ...BASE }));
  });

  test("every field of AdpFilters is named by the key", () => {
    const fields = Object.keys(BASE) as (keyof AdpFilters)[];
    assert.deepEqual(
      fields.sort(),
      (Object.keys(ALTERNATES) as (keyof AdpFilters)[]).sort(),
      "the alternates table covers the whole type",
    );

    const base = adpBoardCacheKey(BASE);
    for (const field of fields) {
      const changed = adpBoardCacheKey({ ...BASE, [field]: ALTERNATES[field] });
      assert.notEqual(changed, base, `changing ${field} must change the key`);
    }
  });

  test("property order is not part of the key", () => {
    // The same values assembled in the reverse order the parser writes them.
    const reversed = Object.fromEntries(
      Object.entries(BASE).reverse(),
    ) as unknown as AdpFilters;
    assert.equal(adpBoardCacheKey(reversed), adpBoardCacheKey(BASE));
  });

  test("a list's order and repeats are not part of the key", () => {
    // `= ANY(…)` is a set comparison, so these are one population and must not
    // be computed twice.
    assert.equal(
      adpBoardCacheKey({
        ...BASE,
        draft_types: ["linear", "snake", "snake"],
        league_ids: ["2", "1", "2"],
      }),
      adpBoardCacheKey(BASE),
    );
  });

  test("an absent list and an empty one are different boards", () => {
    // Null narrows nothing; empty is league rules that matched no league, whose
    // honest board is empty. Collapsing them shows every draft on file to a
    // reader who asked for none.
    assert.notEqual(
      adpBoardCacheKey({ ...BASE, league_ids: null }),
      adpBoardCacheKey({ ...BASE, league_ids: [] }),
    );
  });
});

describe("managerRanksCacheKey", () => {
  const full = { projections: true };
  const cheap = { projections: false };

  test("one manager, one season, one option is one key", () => {
    assert.equal(
      managerRanksCacheKey("123", "2026", full),
      managerRanksCacheKey("123", "2026", { projections: true }),
    );
  });

  test("different managers do not share", () => {
    assert.notEqual(
      managerRanksCacheKey("123", "2026", full),
      managerRanksCacheKey("456", "2026", full),
    );
  });

  test("different seasons do not share", () => {
    assert.notEqual(
      managerRanksCacheKey("123", "2026", full),
      managerRanksCacheKey("123", "2025", full),
    );
  });

  test("the projections option does not share", () => {
    // The cheap answer carries no weeks and a null `proj` on every league;
    // serving it to a caller that asked for the full one blanks two columns.
    assert.notEqual(
      managerRanksCacheKey("123", "2026", full),
      managerRanksCacheKey("123", "2026", cheap),
    );
  });

  test("the segments cannot run together", () => {
    // A key built by concatenation would make ("12", "32026") and
    // ("123", "2026") one entry — one manager's ranks under another's id.
    assert.notEqual(
      managerRanksCacheKey("12", "32026", full),
      managerRanksCacheKey("123", "2026", full),
    );
  });
});

describe("the core League Details cache", () => {
  test("is bounded, and generously enough to cover a session's leagues", () => {
    // A hundred-league account browsed for a few minutes, several readers at a
    // time — and an entry is a dozen rosters, their members and their picks, so
    // the bound is in leagues rather than in bytes.
    assert.ok(LEAGUE_DETAIL_CACHE.max >= 256);
    assert.ok(Number.isFinite(LEAGUE_DETAIL_CACHE.max));
  });

  test("expires sooner than the browser entry it stands behind", () => {
    // The house rule every cache here keeps: a layer's TTL is shorter than the
    // one in front of it, so a client entry going stale costs a request this
    // answers from memory rather than four queries. `LEAGUE_DETAIL_STALE_TIME`
    // is five minutes; this must stay under it.
    assert.ok(LEAGUE_DETAIL_CACHE.ttlMs < 5 * 60 * 1000);
    // …and comfortably inside the crawler's fastest tier, which is what bounds
    // how wrong a cached answer can be.
    assert.ok(LEAGUE_DETAIL_CACHE.ttlMs <= 15 * 60 * 1000);
  });

  test("the three caches are three names", () => {
    // They share one debug channel (`CACHE_DEBUG=on`), so a duplicated name
    // would make two caches indistinguishable in the only place they are
    // observable.
    const names = [ADP_BOARD_CACHE, MANAGER_RANKS_CACHE, LEAGUE_DETAIL_CACHE].map(
      (c) => c.name,
    );
    assert.equal(new Set(names).size, names.length);
  });
});
