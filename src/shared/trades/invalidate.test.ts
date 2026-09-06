import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { BoundedCache } from "../util/bounded-cache.ts";

/**
 * What a successful sync forgets, and what it must not.
 *
 * **The caches are module state behind `pool`, so this file tests the two
 * halves that can be reached without one.** The *keying* rules — a league id, a
 * `league|season` pair, a `user:season:circle` triple — are exercised against a
 * real {@link BoundedCache}, because a predicate that matches the wrong keys is
 * either a cache that never invalidates or one that clears itself, and both are
 * silent. The *wiring* — that this runs after the commit and not before, and
 * that it is targeted rather than a `clear()` — is pinned against the source,
 * the way `crawl-writes.test.ts` pins the freshness stamps it cannot execute.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Source with its comments removed, for asserting on what a module *does*. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("BoundedCache.prune", () => {
  const seeded = (...keys: string[]) => {
    const cache = new BoundedCache<number>(100, 60_000);
    keys.forEach((key, i) => cache.set(key, i));
    return cache;
  };

  test("it drops what matches and keeps everything else", () => {
    const cache = seeded("a", "b", "c");
    assert.equal(
      cache.prune((key) => key === "b"),
      1,
    );
    assert.equal(cache.size, 2);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 0);
  });

  test("it answers how many went, so a caller can stay quiet about zero", () => {
    const cache = seeded("a", "b");
    assert.equal(
      cache.prune(() => false),
      0,
    );
    assert.equal(cache.size, 2);
    assert.equal(
      cache.prune(() => true),
      2,
    );
    assert.equal(cache.size, 0);
  });

  test("deleting while it walks does not skip an entry", () => {
    // The reason it iterates a snapshot of the keys: a `Map` mutated mid-walk
    // is defined behaviour, but "defined" is not the same as "obvious", and the
    // failure would be entries surviving an invalidation that reported them
    // gone.
    const cache = seeded("k0", "k1", "k2", "k3", "k4");
    assert.equal(
      cache.prune(() => true),
      5,
    );
    assert.equal(cache.size, 0);
  });
});

/**
 * The three key shapes, driven the way the invalidation drives them.
 *
 * These mirror the predicates in `forgetTradeLeagueReads` and
 * `forgetTradeCircles` rather than importing them, because those modules reach
 * `pool` at import time. What they pin is the property that actually matters:
 * a sync of one league leaves every other league's entries alone.
 */
describe("the key shapes an invalidation matches on", () => {
  test("a `league|season` key is matched on its league half alone", () => {
    // The draft-order cache. A graph write can add a draft, set an order or
    // complete one, and none of those is scoped to the season the sync ran for
    // — so every season of that league goes, and no other league's does.
    const cache = new BoundedCache<number>(100, 60_000);
    for (const key of ["L1|2025", "L1|2026", "L2|2026", "L20|2026"]) {
      cache.set(key, 1);
    }

    const leagues = new Set(["L1"]);
    const dropped = cache.prune((key) => {
      const at = key.indexOf("|");
      return at !== -1 && leagues.has(key.slice(0, at));
    });

    assert.equal(dropped, 2);
    assert.equal(cache.get("L2|2026"), 1);
    assert.equal(
      cache.get("L20|2026"),
      1,
      "a league id that starts with another's is not that league",
    );
  });

  test("a `user:season:circle` key is matched on the reader and the season", () => {
    const cache = new BoundedCache<number>(100, 60_000);
    for (const key of [
      "userA:2026:mine",
      "userA:2026:leaguemates",
      "userA:2025:mine",
      "userB:2026:mine",
    ]) {
      cache.set(key, 1);
    }

    const readers = new Set(["userA"]);
    const season: string | null = "2026";
    const dropped = cache.prune((key) => {
      const first = key.indexOf(":");
      if (first === -1) return false;
      const second = key.indexOf(":", first + 1);
      if (second === -1) return false;
      if (!readers.has(key.slice(0, first))) return false;
      return season === null || key.slice(first + 1, second) === season;
    });

    assert.equal(dropped, 2, "both of this reader's circles for this season");
    assert.equal(cache.get("userA:2025:mine"), 1, "another season is untouched");
    assert.equal(cache.get("userB:2026:mine"), 1, "another reader is untouched");
  });

  test("a null season forgets a reader's circles in every season", () => {
    const cache = new BoundedCache<number>(100, 60_000);
    for (const key of ["userA:2026:mine", "userA:2025:mine", "userB:2026:mine"]) {
      cache.set(key, 1);
    }

    const readers = new Set(["userA"]);
    const season: string | null = null;
    const dropped = cache.prune((key) => {
      const first = key.indexOf(":");
      if (first === -1) return false;
      const second = key.indexOf(":", first + 1);
      if (second === -1) return false;
      if (!readers.has(key.slice(0, first))) return false;
      return season === null || key.slice(first + 1, second) === season;
    });

    assert.equal(dropped, 2);
    assert.equal(cache.get("userB:2026:mine"), 1);
  });
});

describe("invalidateTradeCaches, as it is written", () => {
  // The *code*, not the prose around it. This module's doc comments name every
  // cache it deliberately leaves alone — which is the point of them and would
  // make a search of the whole file match its own explanation.
  const source = withoutComments(read("src/shared/trades/invalidate.ts"));

  test("it forgets the four league-scoped reads and the circles", () => {
    for (const call of [
      "forgetTradeLeagueReads",
      "forgetTradeLeagueMarkets",
      "forgetSeasonAdp",
      "forgetTradeCircles",
    ]) {
      assert.ok(source.includes(`${call}(`), `${call} should be called`);
    }
  });

  test("it never clears a cache wholesale", () => {
    // The difference between an invalidation and a cold start. A crawler tick
    // syncs a batch every minute; `clear()` on that schedule is a cache that
    // never warms for anybody.
    assert.doesNotMatch(source, /clearTradeEnrichmentCaches|clearTradeCircleCache/);
    assert.doesNotMatch(source, /\.clear\(\)/);
  });

  test("it does not touch the players map or the market boards", () => {
    // A league graph landing says nothing about a player's name or about
    // KeepTradeCut's scrape. Invalidating an immutable global dataset to answer
    // a question about one league is the cost this module exists not to pay.
    assert.doesNotMatch(source, /playersCache|forgetPlayers/);
    assert.doesNotMatch(source, /getKtcBoards|ktcMarket|board-read/);
    assert.doesNotMatch(source, /getRosProjections|projections/);
  });

  test("nothing to forget is a no-op rather than a sweep", () => {
    assert.match(
      source,
      /if \(leagueIds\.length === 0 && userIds\.length === 0 && season === null\) return;/,
    );
  });

  test("the season gates the capital board and nothing else", () => {
    // A caller that cannot name a season must not have the whole board dropped
    // out from under every other reader.
    assert.match(source, /if \(season !== null\) dropped \+= forgetSeasonAdp\(season\)/);
  });
});

describe("where the invalidation is called from", () => {
  const persist = read("src/shared/manager/persist.ts");

  test("the graph write invalidates only after the transaction resolves", () => {
    // The one property that cannot be got wrong quietly: a rolled-back write
    // has changed nothing, and `withTransaction` throws rather than resolving,
    // so a call placed after the `await` is unreachable for a failed sync.
    const fn = persist.slice(persist.indexOf("export async function persistLeagueGraph("));
    const commitAt = fn.indexOf("await withTransaction(");
    const invalidateAt = fn.indexOf("invalidateTradeCaches({");
    assert.ok(commitAt > -1, "the write is still a transaction");
    assert.ok(
      invalidateAt > commitAt,
      "a failed sync must not drop caches for data it never wrote",
    );
    assert.ok(
      !fn.slice(0, commitAt).includes("invalidateTradeCaches"),
      "nothing invalidates before the commit",
    );
  });

  test("it names the league, its season and the members it wrote", () => {
    const fn = persist.slice(persist.indexOf("export async function persistLeagueGraph("));
    assert.match(fn, /leagueIds: \[g\.league\.league_id\]/);
    assert.match(fn, /season: g\.league\.season/);
    assert.match(fn, /userIds: g\.users\.map\(\(u\) => u\.user_id\)/);
  });

  test("the two league-row writers invalidate too", () => {
    // Both write the name, size and settings blobs the board prices a league
    // by, so a first write of either is the first moment the board can name
    // that league at all.
    for (const name of ["persistGoneLeagues", "persistUnsyncedLeagues"]) {
      const start = persist.indexOf(`export async function ${name}(`);
      assert.notEqual(start, -1, `${name} should exist`);
      const fn = persist.slice(start, persist.indexOf("\n}", start));
      assert.ok(
        fn.includes("invalidateTradeCaches({"),
        `${name} should invalidate what it rewrote`,
      );
    }
  });
});
