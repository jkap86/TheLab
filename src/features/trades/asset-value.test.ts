import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assetKey,
  assetValue,
  bundleValue,
  formatAssetValue,
  NO_ASSET_VALUES,
} from "./asset-value.ts";

const L = "L1";

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

/** Both markets priced, so a test can tell which column was read. */
const both = (dynasty: number | null, redraft: number | null) => ({
  dynasty,
  redraft,
});

test("a pick's key is its identity, not the roster trading it", () => {
  // Same season and round, different original owner: two different assets.
  assert.notEqual(
    assetKey(L, pick("2026", 1, 3)),
    assetKey(L, pick("2026", 1, 7)),
  );
  assert.equal(assetKey(L, pick("2026", 1, 3)), assetKey(L, pick("2026", 1, 3)));
  // A player id and a pick can never collide.
  assert.notEqual(assetKey(L, "4034"), assetKey(L, pick("2026", 1, 3)));
});

// The bug an unscoped key would cause is silent: one league's first quietly
// priced as another's, on a board that mixes hundreds of leagues.
test("the same asset in two leagues is two keys", () => {
  assert.notEqual(assetKey("L1", pick("2026", 1, 3)), assetKey("L2", pick("2026", 1, 3)));
  assert.notEqual(assetKey("L1", "4034"), assetKey("L2", "4034"));
});

test("an unpriceable asset is null, never zero", () => {
  assert.equal(assetValue(L, "4034", NO_ASSET_VALUES, "dynasty"), null);
  assert.equal(
    assetValue(L, pick("2026", 1, 3), NO_ASSET_VALUES, "redraft"),
    null,
  );
});

// A kicker is on the redraft board and nowhere near the dynasty one, so an
// asset can legitimately be priced on one market and absent from the other.
test("a market with no price for an asset answers null on its own", () => {
  const values = { [assetKey(L, "K1")]: both(null, 140) };
  assert.equal(assetValue(L, "K1", values, "redraft"), 140);
  assert.equal(assetValue(L, "K1", values, "dynasty"), null);
});

test("the market chooses the column, on players and picks alike", () => {
  const values = {
    [assetKey(L, "4034")]: both(8120, 6400),
    [assetKey(L, pick("2027", 1, 5))]: both(5592, 900),
  };
  assert.equal(assetValue(L, "4034", values, "dynasty"), 8120);
  assert.equal(assetValue(L, "4034", values, "redraft"), 6400);
  assert.equal(bundleValue(L, bundle(["4034"], [pick("2027", 1, 5)]), values, "dynasty"), 13712);
  assert.equal(bundleValue(L, bundle(["4034"], [pick("2027", 1, 5)]), values, "redraft"), 7300);
});

test("a side with nothing priced totals null, never 0", () => {
  // The rule the module exists for: `0` would claim the side received nothing
  // of value, where the truth is that nothing here can price it.
  const empty = bundle(["4034"], [pick("2026", 1, 3)]);
  assert.equal(bundleValue(L, empty, NO_ASSET_VALUES, "dynasty"), null);
  assert.equal(bundleValue(L, bundle([], [], 42), NO_ASSET_VALUES, "dynasty"), null);
  assert.equal(bundleValue(L, bundle(), NO_ASSET_VALUES, "dynasty"), null);
});

test("a side sums what it can price and ignores what it cannot", () => {
  const values = {
    [assetKey(L, "4034")]: both(8120, 8120),
    [assetKey(L, pick("2027", 2, 5))]: both(1720, 1720),
  };

  // The unpriced player is absent from the sum rather than counted as zero.
  assert.equal(bundleValue(L, bundle(["4034", "9999"]), values, "dynasty"), 8120);
  assert.equal(
    bundleValue(
      L,
      bundle(["4034"], [pick("2027", 2, 5), pick("2028", 1, 5)]),
      values,
      "dynasty",
    ),
    9840,
  );
});

// A market the payload could not read leaves a null on that side of every
// pair, which must read as "no answer" rather than dragging a total down.
test("a null on the chosen market falls out of the sum like an absence", () => {
  const values = { [assetKey(L, "4034")]: both(8120, null) };
  assert.equal(bundleValue(L, bundle(["4034"]), values, "redraft"), null);
  assert.equal(bundleValue(L, bundle(["4034"]), values, "dynasty"), 8120);
});

test("FAAB never contributes to a total, and never suppresses one", () => {
  const values = { [assetKey(L, "4034")]: both(8120, 8120) };
  // In the league's own currency, which no market prices — but a side that
  // received a priced player alongside it still has a real total.
  assert.equal(bundleValue(L, bundle(["4034"], [], 42), values, "dynasty"), 8120);
  assert.equal(bundleValue(L, bundle([], [], 42), values, "dynasty"), null);
});

test("a value prints grouped, an absent one prints a dash", () => {
  assert.equal(formatAssetValue(null), "—");
  assert.equal(formatAssetValue(8120), (8120).toLocaleString());
  // Zero is a real price and must not read as "no answer".
  assert.equal(formatAssetValue(0), "0");
});
