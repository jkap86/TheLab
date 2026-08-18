import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BoundedCache } from "../util/bounded-cache.ts";
import { COMPS_ENRICHMENTS } from "./fields.ts";
import {
  COMPS_ENRICHMENT_CACHE,
  COMPS_MAX_SEASONS,
  COMPS_PLAYER_INDEX_CACHE,
  COMPS_POOL_CACHE,
  COMPS_POOL_VERSION,
  COMPS_RECENT_SEASONS,
  COMPS_SEASON_TTL_MS,
  COMPS_SEASON_TTL_STAGGER_SHARE,
  compsEnrichmentCacheKey,
  compsPoolCacheKey,
  getCompsSeasonTtlMs,
} from "./read-cache.ts";

describe("compsPoolCacheKey", () => {
  test("varies on the season", () => {
    assert.notEqual(compsPoolCacheKey("2024"), compsPoolCacheKey("2025"));
  });

  test("carries the version, so a shape bump is a miss", () => {
    assert.ok(compsPoolCacheKey("2025").includes(String(COMPS_POOL_VERSION)));
  });

  test("is deterministic", () => {
    assert.equal(compsPoolCacheKey("2025"), compsPoolCacheKey("2025"));
  });

  test("names no dataset — the pool is what every board shares", () => {
    // The whole point of the split: a reader weighting KTC and a reader on the
    // defaults read one entry for a season's stats between them, so a market
    // weight can never be why a season's stat lines are read again — and a
    // dataset in this key would be exactly that, one corpus per board.
    assert.ok(!compsPoolCacheKey("2025").includes("ktc"));
    assert.ok(!compsPoolCacheKey("2025").includes("adp"));
  });
});

describe("compsEnrichmentCacheKey", () => {
  test("varies on the dataset and on the season", () => {
    assert.notEqual(
      compsEnrichmentCacheKey("ktc", "2025"),
      compsEnrichmentCacheKey("ktc_history", "2025"),
    );
    assert.notEqual(
      compsEnrichmentCacheKey("ktc", "2024"),
      compsEnrichmentCacheKey("ktc", "2025"),
    );
  });

  test("carries the version", () => {
    assert.ok(
      compsEnrichmentCacheKey("adp", "2025").includes(String(COMPS_POOL_VERSION)),
    );
  });
});

describe("the cache policies", () => {
  test("the pool holds every stored season at once", () => {
    // Every season is read on every request, so a cap the working set outgrows
    // evicts and rebuilds a season per request — cache churn wearing a cache's
    // name. The archive reaches back to 2000.
    assert.ok(COMPS_POOL_CACHE.max >= 32);
  });

  test("the datasets are bounded for four of them, not one", () => {
    assert.ok(COMPS_ENRICHMENT_CACHE.max >= COMPS_POOL_CACHE.max);
  });

  test("a dataset and the pool it is merged onto share one TTL", () => {
    // Either outliving the other is a merged corpus whose halves are from
    // different moments — a KTC value as of a scrape the season's stats have
    // since been replaced under.
    assert.equal(COMPS_ENRICHMENT_CACHE.ttlMs, COMPS_POOL_CACHE.ttlMs);
  });

  test("sits above the client's five-minute result staleness", () => {
    assert.ok(COMPS_POOL_CACHE.ttlMs > 5 * 60 * 1000);
  });

  test("the picker's index is one entry and outlives the pools", () => {
    // It takes no parameters, and what is under it moves weekly at its fastest
    // — where the client holds the list for fifteen minutes, which is the floor
    // this has to clear (see `cache-layering.test.ts`).
    assert.equal(COMPS_PLAYER_INDEX_CACHE.max, 1);
    assert.ok(COMPS_PLAYER_INDEX_CACHE.ttlMs > COMPS_POOL_CACHE.ttlMs);
  });
});


/**
 * The season TTL policy.
 *
 * What it replaces: one fifteen-minute clock over the whole corpus, which
 * comps walks end to end on every request. ~27 seasons × two reads each, four
 * times an hour, to re-learn numbers that for 2008 have not moved in seventeen
 * years — and populated together, so they expired together and one reader paid
 * for the lot. The tiers are the fix and the stagger is what keeps the
 * remaining cliff from being a cliff.
 */
describe("getCompsSeasonTtlMs", () => {
  /** The tier's floor, since the stagger only ever extends. */
  const tier = (season: string, current: string) =>
    getCompsSeasonTtlMs(season, current);

  test("the current season stays on the short clock", () => {
    const ttl = tier("2026", "2026");
    assert.ok(ttl >= COMPS_SEASON_TTL_MS.live);
    assert.ok(ttl < COMPS_SEASON_TTL_MS.recent);
    // The floor the client's five-minute stale time needs: a server entry
    // outlives the browser's by half again at least.
    assert.ok(COMPS_SEASON_TTL_MS.live >= 1.5 * 5 * 60 * 1000);
  });

  test("last season gets the intermediate clock", () => {
    const ttl = tier("2025", "2026");
    assert.ok(ttl >= COMPS_SEASON_TTL_MS.recent, "past the live tier");
    assert.ok(ttl < COMPS_SEASON_TTL_MS.historical, "short of the archive tier");
  });

  test("an old season gets the long clock", () => {
    for (const season of ["2024", "2017", "2008", "2000"]) {
      const ttl = tier(season, "2026");
      assert.ok(
        ttl >= COMPS_SEASON_TTL_MS.historical,
        `${season} should be on the archive clock`,
      );
    }
  });

  test("the tiers are ordered, and the recency boundary is where it says", () => {
    assert.ok(COMPS_SEASON_TTL_MS.live < COMPS_SEASON_TTL_MS.recent);
    assert.ok(COMPS_SEASON_TTL_MS.recent < COMPS_SEASON_TTL_MS.historical);
    // The boundary is `COMPS_RECENT_SEASONS` behind, not a number typed twice.
    const boundary = String(2026 - COMPS_RECENT_SEASONS);
    const beyond = String(2026 - COMPS_RECENT_SEASONS - 1);
    assert.ok(tier(boundary, "2026") < COMPS_SEASON_TTL_MS.historical);
    assert.ok(tier(beyond, "2026") >= COMPS_SEASON_TTL_MS.historical);
  });

  test("a season ahead of the current one reads as live", () => {
    // The one a clock disagreement produces. Holding next season's empty,
    // filling pool for a day is the expensive way to be wrong.
    assert.ok(tier("2027", "2026") < COMPS_SEASON_TTL_MS.recent);
  });

  test("an unparseable season falls to the short clock", () => {
    // Anything that isn't a year is a corpus this policy doesn't understand,
    // and the short clock can only cost a query.
    assert.ok(tier("all", "2026") < COMPS_SEASON_TTL_MS.recent);
    assert.ok(tier("2008", "unknown") < COMPS_SEASON_TTL_MS.recent);
  });

  test("the stagger only ever extends, and never past a quarter of the tier", () => {
    for (const season of ["2000", "2008", "2013", "2017", "2021", "2024"]) {
      const ttl = tier(season, "2026");
      assert.ok(ttl >= COMPS_SEASON_TTL_MS.historical, season);
      assert.ok(
        ttl <
          COMPS_SEASON_TTL_MS.historical *
            (1 + COMPS_SEASON_TTL_STAGGER_SHARE),
        `${season} was held past its tier's spread`,
      );
    }
  });

  test("it is deterministic — no random jitter to make a test a coin toss", () => {
    assert.equal(tier("2008", "2026"), tier("2008", "2026"));
    assert.equal(
      getCompsSeasonTtlMs("2008", "2026", "key"),
      getCompsSeasonTtlMs("2008", "2026", "key"),
    );
  });

  test("a corpus's entries do not expire in one instant", () => {
    // The cliff the tiers alone would only make rarer: the corpus is filled in
    // one walk, so without a spread every archive entry expires within
    // milliseconds of every other and the next reader rebuilds all of them.
    const seasons = Array.from({ length: 24 }, (_, i) => String(2000 + i));
    const ttls = new Set(seasons.map((season) => tier(season, "2026")));
    assert.ok(
      ttls.size >= seasons.length - 2,
      `only ${ttls.size} distinct expiry times across ${seasons.length} seasons`,
    );
  });

  test("a season's datasets do not expire with its pool", () => {
    // Keyed on the entry rather than the season, so the five entries a season
    // can hold come back one at a time rather than together.
    const season = "2019";
    const keys = [
      compsPoolCacheKey(season),
      ...COMPS_ENRICHMENTS.map((e) => compsEnrichmentCacheKey(e, season)),
    ];
    const ttls = new Set(
      keys.map((key) => getCompsSeasonTtlMs(season, "2026", key)),
    );
    assert.equal(ttls.size, keys.length, "two entries share an expiry instant");
  });
});

describe("the caches are sized from the working set", () => {
  test("the pool holds every supported season", () => {
    // Every season is read on every request, so this is a working set rather
    // than a hit rate: a cap the corpus outgrows rebuilds a season per request.
    assert.equal(COMPS_POOL_CACHE.max, COMPS_MAX_SEASONS);
    // The stats archive reaches back to `STATS_ARCHIVE_FLOOR_SEASON` (2000) and
    // gains a season a year, so the bound has to cover that span with room to
    // spare — ~27 seasons today, and this still fits every season through 2050.
    assert.ok(COMPS_MAX_SEASONS >= 2050 - 2000 + 1);
  });

  test("the enrichment bound is every season times every dataset family", () => {
    // The invariant, stated rather than counted. It used to be 128, which fit
    // ~27 seasons × 4 families and stopped fitting at 33 — six years out,
    // silently, as continual eviction of a corpus every request walks.
    assert.equal(
      COMPS_ENRICHMENT_CACHE.max,
      COMPS_MAX_SEASONS * COMPS_ENRICHMENTS.length,
    );
    // And this is the assertion that fails when a fifth family is added or the
    // season count is raised without the bound following.
    assert.ok(
      COMPS_ENRICHMENT_CACHE.max >= COMPS_MAX_SEASONS * COMPS_ENRICHMENTS.length,
      "the full working set no longer fits the enrichment cache",
    );
  });

  test("a full corpus with every dataset weighted does not thrash", () => {
    // The regression, driven rather than asserted: fill the caches exactly as a
    // request walking every supported season with every dataset weighted would,
    // then read the whole set back. An eviction here is a season rebuilt on the
    // next request, for as long as the corpus stays this size.
    const seasons = Array.from({ length: COMPS_MAX_SEASONS }, (_, i) =>
      String(2000 + i),
    );
    const pools = new BoundedCache<string>(COMPS_POOL_CACHE.max, 60_000);
    const datasets = new BoundedCache<string>(COMPS_ENRICHMENT_CACHE.max, 60_000);

    for (const season of seasons) {
      pools.set(compsPoolCacheKey(season), season);
      for (const enrichment of COMPS_ENRICHMENTS) {
        datasets.set(compsEnrichmentCacheKey(enrichment, season), season);
      }
    }

    for (const season of seasons) {
      assert.equal(
        pools.get(compsPoolCacheKey(season)),
        season,
        `${season}'s pool was evicted while the corpus was being built`,
      );
      for (const enrichment of COMPS_ENRICHMENTS) {
        assert.equal(
          datasets.get(compsEnrichmentCacheKey(enrichment, season)),
          season,
          `${season}'s ${enrichment} was evicted while the corpus was being built`,
        );
      }
    }
    assert.equal(datasets.size, seasons.length * COMPS_ENRICHMENTS.length);
  });

  test("the picker index outlives the browser's own stale time", () => {
    assert.ok(COMPS_PLAYER_INDEX_CACHE.ttlMs >= 1.5 * 15 * 60 * 1000);
    assert.equal(COMPS_PLAYER_INDEX_CACHE.max, 1);
  });
});
