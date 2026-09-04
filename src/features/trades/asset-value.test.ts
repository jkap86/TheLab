import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assetKey,
  assetRank,
  assetValue,
  bundleValue,
  formatAssetValue,
  NO_ASSET_VALUES,
  TRADE_BASIS_UNITS,
  type ValueLens,
} from "./asset-value.ts";

const L = "L1";

/** The two KeepTradeCut lenses, which is where most of these rules live. */
const DYNASTY: ValueLens = { basis: "ktc", format: "dynasty" };
const REDRAFT: ValueLens = { basis: "ktc", format: "redraft" };
const CAPITAL: ValueLens = { basis: "capital", format: "dynasty" };
const ROS: ValueLens = { basis: "ros", format: "dynasty" };

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

/** A figure with no place — the shape a league of one priced asset ships. */
const at = (value: number | null) => (value === null ? null : { value, rank: null });

/**
 * Both KeepTradeCut markets priced, so a test can tell which column was read.
 * The other two bases are absent unless a test names them.
 */
const both = (dynasty: number | null, redraft: number | null) => ({
  capital: null,
  ros: null,
  ktc: { dynasty: at(dynasty), redraft: at(redraft) },
});

/** One entry with a figure on each of the three bases. */
const across = (
  capital: number | null,
  ktc: number | null,
  ros: number | null,
) => ({
  capital: at(capital),
  ros: at(ros),
  ktc: { dynasty: at(ktc), redraft: at(ktc) },
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
  assert.equal(assetValue(L, "4034", NO_ASSET_VALUES, DYNASTY), null);
  assert.equal(
    assetValue(L, pick("2026", 1, 3), NO_ASSET_VALUES, REDRAFT),
    null,
  );
});

// A kicker is on the redraft board and nowhere near the dynasty one, so an
// asset can legitimately be priced on one market and absent from the other.
test("a market with no price for an asset answers null on its own", () => {
  const values = { [assetKey(L, "K1")]: both(null, 140) };
  assert.equal(assetValue(L, "K1", values, REDRAFT), 140);
  assert.equal(assetValue(L, "K1", values, DYNASTY), null);
});

test("the market chooses the column, on players and picks alike", () => {
  const values = {
    [assetKey(L, "4034")]: both(8120, 6400),
    [assetKey(L, pick("2027", 1, 5))]: both(5592, 900),
  };
  assert.equal(assetValue(L, "4034", values, DYNASTY), 8120);
  assert.equal(assetValue(L, "4034", values, REDRAFT), 6400);
  assert.equal(bundleValue(L, bundle(["4034"], [pick("2027", 1, 5)]), values, DYNASTY), 13712);
  assert.equal(bundleValue(L, bundle(["4034"], [pick("2027", 1, 5)]), values, REDRAFT), 7300);
});

test("a side with nothing priced totals null, never 0", () => {
  // The rule the module exists for: `0` would claim the side received nothing
  // of value, where the truth is that nothing here can price it.
  const empty = bundle(["4034"], [pick("2026", 1, 3)]);
  assert.equal(bundleValue(L, empty, NO_ASSET_VALUES, DYNASTY), null);
  assert.equal(bundleValue(L, bundle([], [], 42), NO_ASSET_VALUES, DYNASTY), null);
  assert.equal(bundleValue(L, bundle(), NO_ASSET_VALUES, DYNASTY), null);
});

test("a side sums what it can price and ignores what it cannot", () => {
  const values = {
    [assetKey(L, "4034")]: both(8120, 8120),
    [assetKey(L, pick("2027", 2, 5))]: both(1720, 1720),
  };

  // The unpriced player is absent from the sum rather than counted as zero.
  assert.equal(bundleValue(L, bundle(["4034", "9999"]), values, DYNASTY), 8120);
  assert.equal(
    bundleValue(
      L,
      bundle(["4034"], [pick("2027", 2, 5), pick("2028", 1, 5)]),
      values,
      DYNASTY,
    ),
    9840,
  );
});

// A market the payload could not read leaves a null on that side of every
// pair, which must read as "no answer" rather than dragging a total down.
test("a null on the chosen market falls out of the sum like an absence", () => {
  const values = { [assetKey(L, "4034")]: both(8120, null) };
  assert.equal(bundleValue(L, bundle(["4034"]), values, REDRAFT), null);
  assert.equal(bundleValue(L, bundle(["4034"]), values, DYNASTY), 8120);
});

test("FAAB never contributes to a total, and never suppresses one", () => {
  const values = { [assetKey(L, "4034")]: both(8120, 8120) };
  // In the league's own currency, which no market prices — but a side that
  // received a priced player alongside it still has a real total.
  assert.equal(bundleValue(L, bundle(["4034"], [], 42), values, DYNASTY), 8120);
  assert.equal(bundleValue(L, bundle([], [], 42), values, DYNASTY), null);
});

test("a value prints grouped, an absent one prints a dash", () => {
  assert.equal(formatAssetValue(null), "—");
  assert.equal(formatAssetValue(8120), (8120).toLocaleString());
  // Zero is a real price and must not read as "no answer".
  assert.equal(formatAssetValue(0), "0");
});

// The colour on a card is taken from this rank, and the two cases it must
// answer null for are the ones that would otherwise paint a claim: a league
// with nothing to place a figure against, and an asset nothing prices.
test("a rank rides the price and is null where there is nothing to place", () => {
  const values = {
    [assetKey(L, "4034")]: {
      capital: null,
      ros: null,
      ktc: { dynasty: { value: 8120, rank: { rank: 2, of: 180 } }, redraft: at(6400) },
    },
  };
  assert.deepEqual(assetRank(L, "4034", values, DYNASTY), { rank: 2, of: 180 });
  // Priced, but the league had nothing to rank it against.
  assert.equal(assetRank(L, "4034", values, REDRAFT), null);
  // Not priced at all.
  assert.equal(assetRank(L, "9999", values, DYNASTY), null);
});

test("the basis picks the figure, and only KTC reads the market", () => {
  const values = { [assetKey(L, "4034")]: across(6900, 8120, 214.6) };
  assert.equal(assetValue(L, "4034", values, CAPITAL), 6900);
  assert.equal(assetValue(L, "4034", values, ROS), 214.6);
  assert.equal(assetValue(L, "4034", values, DYNASTY), 8120);
  // The format is carried on every lens and read on exactly one of them, so a
  // capital figure cannot come back different for a dynasty and a redraft
  // league.
  assert.equal(
    assetValue(L, "4034", values, { basis: "capital", format: "redraft" }),
    6900,
  );
});

// A pick is priced on KeepTradeCut alone: there is no ADP pick ladder here and
// a pick has no rest-of-season projection, so both are dashes rather than
// zeroes — and a side holding only picks has no total on those two bases.
test("a pick prices on KTC alone, and the other two bases dash", () => {
  const first = pick("2027", 1, 5);
  const values = {
    [assetKey(L, first)]: { capital: null, ros: null, ktc: { dynasty: at(5592), redraft: null } },
  };
  assert.equal(assetValue(L, first, values, DYNASTY), 5592);
  assert.equal(assetValue(L, first, values, CAPITAL), null);
  assert.equal(assetValue(L, first, values, ROS), null);
  assert.equal(bundleValue(L, bundle([], [first]), values, CAPITAL), null);
  assert.equal(bundleValue(L, bundle([], [first]), values, DYNASTY), 5592);
});

// A basis a league cannot anchor — no stored size for the capital curve, no
// stored scoring for the points one — leaves that side null while the others
// still answer. The total must fall out the same way an absent market does.
test("a basis with no figure for an asset falls out of the sum", () => {
  const values = {
    [assetKey(L, "4034")]: across(null, 8120, 214.6),
    [assetKey(L, "5045")]: across(3100, 2400, null),
  };
  assert.equal(bundleValue(L, bundle(["4034", "5045"]), values, CAPITAL), 3100);
  assert.equal(bundleValue(L, bundle(["4034", "5045"]), values, ROS), 214.6);
  assert.equal(bundleValue(L, bundle(["4034", "5045"]), values, DYNASTY), 10520);
});

// Three scales never share a column without a unit — the rule the side header
// prints one for. Exhaustive over the union, so a fourth basis breaks here
// before it reaches a card with no name for itself.
test("every basis has a unit to print", () => {
  assert.deepEqual(Object.keys(TRADE_BASIS_UNITS).sort(), [
    "capital",
    "ktc",
    "ros",
  ]);
  for (const unit of Object.values(TRADE_BASIS_UNITS)) {
    assert.match(unit, /^[A-Z]{3}$/);
  }
});
