import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assetKey,
  assetValue,
  bundleValue,
  formatAssetValue,
  NO_ASSET_VALUES,
} from "./asset-value.ts";

const pick = (season: string, round: number, roster_id: number) => ({
  season,
  round,
  roster_id,
  user_id: null,
});

const bundle = (
  players: string[] = [],
  picks: ReturnType<typeof pick>[] = [],
  faab = 0,
) => ({ players, picks, faab });

test("a pick's key is its identity, not the roster trading it", () => {
  // Same season and round, different original owner: two different assets.
  assert.notEqual(assetKey(pick("2026", 1, 3)), assetKey(pick("2026", 1, 7)));
  assert.equal(assetKey(pick("2026", 1, 3)), assetKey(pick("2026", 1, 3)));
  // A player id and a pick can never collide.
  assert.notEqual(assetKey("4034"), assetKey(pick("2026", 1, 3)));
});

test("an unpriceable asset is null, never zero", () => {
  assert.equal(assetValue("4034", NO_ASSET_VALUES), null);
  assert.equal(assetValue(pick("2026", 1, 3), NO_ASSET_VALUES), null);
});

test("a side with nothing priced totals null, never 0", () => {
  // The rule the module exists for: `0` would claim the side received nothing
  // of value, where the truth is that nothing here can price it.
  assert.equal(bundleValue(bundle(["4034"], [pick("2026", 1, 3)]), NO_ASSET_VALUES), null);
  assert.equal(bundleValue(bundle([], [], 42), NO_ASSET_VALUES), null);
  assert.equal(bundleValue(bundle(), NO_ASSET_VALUES), null);
});

test("a side sums what it can price and ignores what it cannot", () => {
  const values = { [assetKey("4034")]: 8120, [assetKey(pick("2027", 2, 5))]: 1720 };

  // The unpriced player is absent from the sum rather than counted as zero.
  assert.equal(bundleValue(bundle(["4034", "9999"]), values), 8120);
  assert.equal(
    bundleValue(bundle(["4034"], [pick("2027", 2, 5), pick("2028", 1, 5)]), values),
    9840,
  );
});

test("FAAB never contributes to a total, and never suppresses one", () => {
  const values = { [assetKey("4034")]: 8120 };
  // In the league's own currency, which no market prices — but a side that
  // received a priced player alongside it still has a real total.
  assert.equal(bundleValue(bundle(["4034"], [], 42), values), 8120);
  assert.equal(bundleValue(bundle([], [], 42), values), null);
});

test("a value prints grouped, an absent one prints a dash", () => {
  assert.equal(formatAssetValue(null), "—");
  assert.equal(formatAssetValue(8120), (8120).toLocaleString());
  // Zero is a real price and must not read as "no answer".
  assert.equal(formatAssetValue(0), "0");
});
