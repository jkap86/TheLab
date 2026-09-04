import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ktcPickKey,
  ktcPickPrice,
  parseKtcPickName,
  pickTier,
} from "./picks.ts";
import type { KtcPickPrice } from "./picks.ts";

const price = (sf: number): KtcPickPrice => ({ sf, oneqb: sf - 200 });

test("parseKtcPickName", async (t) => {
  await t.test("reads season, round and tier off a tiered row", () => {
    assert.deepEqual(parseKtcPickName("2027 Mid 1st"), {
      season: "2027",
      round: 1,
      tier: "mid",
    });
    assert.deepEqual(parseKtcPickName("2028 Late 4th"), {
      season: "2028",
      round: 4,
      tier: "late",
    });
  });

  // A row with no tier is a real answer — "a 2029 1st", with no opinion about
  // where in the round — so it parses to a null tier rather than failing.
  await t.test("an untiered row keeps its round and says nothing more", () => {
    assert.deepEqual(parseKtcPickName("2029 1st"), {
      season: "2029",
      round: 1,
      tier: null,
    });
  });

  // The names are scraped off a page KTC can change whenever it likes, so the
  // orderings and filler words a redesign would plausibly introduce all read the
  // same three facts back out.
  await t.test("filler words and orderings survive", () => {
    const expected = { season: "2027", round: 1, tier: "early" as const };
    assert.deepEqual(parseKtcPickName("2027 Early 1st Round Pick"), expected);
    assert.deepEqual(parseKtcPickName("Early 2027 1st"), expected);
    assert.deepEqual(parseKtcPickName("2027 early round 1 pick"), expected);
    assert.deepEqual(parseKtcPickName("2027 Middle 2nd"), {
      season: "2027",
      round: 2,
      tier: "mid",
    });
  });

  // Filed under a pick it might not be is worse than left unpriced, so anything
  // this doesn't fully understand fails rather than being partly read.
  await t.test("anything it doesn't understand is not a pick", () => {
    for (const name of [
      "Ja'Marr Chase",
      "2027 Early",
      "1st",
      "2027 Early Compensatory 1st",
      "2027 2028 1st",
      "2027 Early Late 1st",
      "",
    ]) {
      assert.equal(parseKtcPickName(name), null, name);
    }
  });
});

test("pickTier", async (t) => {
  await t.test("splits a round into thirds", () => {
    assert.deepEqual(
      [1, 4, 5, 8, 9, 12].map((slot) => pickTier(slot, 12)),
      ["early", "early", "mid", "mid", "late", "late"],
    );
  });

  // A field that doesn't divide by three splits 3/4/3 rather than 4/3/3: the
  // ends stay equal and the spare pick lands in the middle, which is what
  // measuring from a slot's midpoint rather than its leading edge buys.
  await t.test("an odd field keeps its ends equal", () => {
    assert.deepEqual(
      Array.from({ length: 10 }, (_, i) => pickTier(i + 1, 10)),
      [
        "early", "early", "early",
        "mid", "mid", "mid", "mid",
        "late", "late", "late",
      ],
    );
  });

  // Null reads downstream exactly as an unset draft order does, which is the
  // honest answer for both: nothing here can say which third this is.
  await t.test("a slot the arithmetic can't place is null", () => {
    assert.equal(pickTier(0, 12), null);
    assert.equal(pickTier(13, 12), null);
    // Fewer teams than tiers would have "early" and "late" name one pick.
    assert.equal(pickTier(1, 2), null);
    assert.equal(pickTier(Number.NaN, 12), null);
  });
});

test("ktcPickPrice", async (t) => {
  const board = {
    [ktcPickKey("2027", 1, "early")]: price(6000),
    [ktcPickKey("2027", 1, "mid")]: price(5000),
    [ktcPickKey("2027", 1, "late")]: price(4000),
    [ktcPickKey("2029", 1, null)]: price(3000),
  };
  const pick = (season: string, round = 1) => ({ season, round });

  await t.test("a placed pick reads its own tier", () => {
    const match = ktcPickPrice(board, pick("2027"), "late");
    assert.deepEqual(match, { price: price(4000), tier: "late", exact: true });
  });

  // The common case on this board: most picks are seasons out, so the draft
  // doesn't exist and there is no order to place them in.
  await t.test("an unplaced pick takes the untiered row where there is one", () => {
    const match = ktcPickPrice(board, pick("2029"), null);
    assert.deepEqual(match, { price: price(3000), tier: null, exact: true });
  });

  await t.test("an unplaced pick falls back to mid, and says so", () => {
    const match = ktcPickPrice(board, pick("2027"), null);
    assert.deepEqual(match, { price: price(5000), tier: "mid", exact: false });
  });

  // Understated for a late 1st, and far less wrong than no number at all.
  await t.test("a placed pick falls back to the untiered row", () => {
    const match = ktcPickPrice(board, pick("2029"), "early");
    assert.deepEqual(match, { price: price(3000), tier: null, exact: false });
  });

  // A draft that has since happened, or one further out than KTC prices: a
  // genuine gap, and the caller draws it as one.
  await t.test("a season the board doesn't carry is null", () => {
    assert.equal(ktcPickPrice(board, pick("2024"), null), null);
    assert.equal(ktcPickPrice(board, pick("2027", 3), "early"), null);
  });
});
