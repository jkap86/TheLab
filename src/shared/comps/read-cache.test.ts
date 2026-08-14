import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  COMPS_POOL_CACHE,
  COMPS_POOL_VERSION,
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
});

describe("COMPS_POOL_CACHE", () => {
  test("holds every stored season at once — the deepens-yearly promise", () => {
    // Two seasons stored today, one more per year: a cap the working set can
    // outgrow is eviction churn wearing a cache's name. 32 is decades of room.
    assert.ok(COMPS_POOL_CACHE.max >= 32);
  });

  test("sits above the client's five-minute result staleness", () => {
    assert.ok(COMPS_POOL_CACHE.ttlMs > 5 * 60 * 1000);
  });
});
