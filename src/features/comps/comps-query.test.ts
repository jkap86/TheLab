import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compsQueryKeys, normalizeCompsQuery } from "./comps-query.ts";

describe("normalizeCompsQuery", () => {
  test("parameter order doesn't split the cache", () => {
    assert.deepEqual(
      normalizeCompsQuery("player_id=1&basis=total"),
      normalizeCompsQuery("basis=total&player_id=1"),
    );
  });

  test("values stay verbatim — the fields/weights pairing survives", () => {
    // The pinned hazard: `weights=100,50` and `weights=50,100` are two
    // different boards, and a normalisation that sorted or deduplicated
    // values would collapse them into one cache entry.
    const a = compsQueryKeys.result("fields=rec,rec_yd&weights=100,50");
    const b = compsQueryKeys.result("fields=rec,rec_yd&weights=50,100");
    assert.notDeepEqual(a, b);
  });

  test("a repeated parameter keeps its document order", () => {
    assert.deepEqual(normalizeCompsQuery("fields=rec&fields=rec_yd"), [
      ["fields", "rec"],
      ["fields", "rec_yd"],
    ]);
    assert.notDeepEqual(
      normalizeCompsQuery("fields=rec&fields=rec_yd"),
      normalizeCompsQuery("fields=rec_yd&fields=rec"),
    );
  });
});

describe("compsQueryKeys", () => {
  test("everything hangs off one prefix", () => {
    assert.deepEqual(compsQueryKeys.players().slice(0, 1), ["comps"]);
    assert.deepEqual(compsQueryKeys.result("player_id=1").slice(0, 1), [
      "comps",
    ]);
  });

  test("different queries are different keys", () => {
    assert.notDeepEqual(
      compsQueryKeys.result("player_id=1"),
      compsQueryKeys.result("player_id=2"),
    );
  });
});
