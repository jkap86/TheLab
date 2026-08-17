import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_ENRICHMENT_CACHE,
  COMPS_PLAYER_INDEX_CACHE,
  COMPS_POOL_CACHE,
  COMPS_POOL_VERSION,
  compsEnrichmentCacheKey,
  compsPoolCacheKey,
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
