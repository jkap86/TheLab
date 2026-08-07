import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ktcPickBaseSeason,
  ktcPickBoardRows,
  ktcPickDiscount,
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

test("ktcPickBaseSeason", async (t) => {
  // The nearest priced draft, which is what a future pick is discounted
  // against. Read off the board rather than a calendar because *which* seasons
  // KTC carries moves through the year — a season's rows come off once its
  // draft has happened.
  await t.test("the earliest season the board prices", () => {
    assert.equal(
      ktcPickBaseSeason({
        [ktcPickKey("2029", 1, null)]: price(3000),
        [ktcPickKey("2027", 1, "mid")]: price(5000),
        [ktcPickKey("2028", 2, null)]: price(2000),
      }),
      "2027",
    );
  });

  // KTC unsynced, or a rename the parser hasn't learned: the one case where no
  // pick can be discounted at all, and the caller has to be able to see it.
  await t.test("a board with no rows has no base", () => {
    assert.equal(ktcPickBaseSeason({}), null);
  });
});

test("ktcPickDiscount", async (t) => {
  const board: Record<string, KtcPickPrice> = {
    [ktcPickKey("2027", 1, "early")]: price(6000),
    [ktcPickKey("2027", 1, "late")]: price(4000),
    [ktcPickKey("2027", 1, null)]: price(5000),
    [ktcPickKey("2028", 1, null)]: price(3000),
    [ktcPickKey("2029", 1, null)]: price(1500),
  };

  await t.test("a pick at the nearest season is undiscounted", () => {
    assert.deepEqual(ktcPickDiscount(board, { season: "2027", round: 1 }, null, true), {
      factor: 1,
      base: "2027",
      tier: null,
      exact: true,
    });
  });

  // A season KTC has dropped — its draft has happened — is the ladder's own
  // class, so there is nothing to discount it by rather than nothing to say.
  await t.test("a pick before the nearest season is undiscounted too", () => {
    assert.deepEqual(
      ktcPickDiscount(board, { season: "2026", round: 1 }, null, true),
      { factor: 1, base: "2027", tier: null, exact: true },
    );
  });

  await t.test("a future pick is its own row over the nearest season's", () => {
    assert.equal(
      ktcPickDiscount(board, { season: "2028", round: 1 }, null, true)?.factor,
      3000 / 5000,
    );
    assert.equal(
      ktcPickDiscount(board, { season: "2029", round: 1 }, null, true)?.factor,
      1500 / 5000,
    );
  });

  /**
   * The like-for-like rule, which is the whole correctness argument here.
   *
   * A ratio between two different kinds of pick is not a discount — and the
   * mismatch was the *common* case rather than a corner, because KTC drops the
   * tiered rows for the seasons it has less of an opinion about. So each of
   * these fixes both ends on one row and refuses rather than crossing them.
   */
  await t.test("an exact tier on both sides is used on both sides", () => {
    const tiered: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, "early")]: price(6000),
      [ktcPickKey("2027", 1, "mid")]: price(5000),
      [ktcPickKey("2027", 1, "late")]: price(4000),
      [ktcPickKey("2027", 1, null)]: price(5000),
      [ktcPickKey("2028", 1, "early")]: price(4200),
      [ktcPickKey("2028", 1, "mid")]: price(3500),
      [ktcPickKey("2028", 1, "late")]: price(2800),
      [ktcPickKey("2028", 1, null)]: price(3000),
    };
    const of = (tier: "early" | "mid" | "late") =>
      ktcPickDiscount(tiered, { season: "2028", round: 1 }, tier, true);

    assert.equal(of("early")?.factor, 4200 / 6000);
    assert.equal(of("mid")?.factor, 3500 / 5000);
    assert.equal(of("late")?.factor, 2800 / 4000);
    for (const tier of ["early", "mid", "late"] as const) {
      assert.equal(of(tier)?.tier, tier);
      assert.equal(of(tier)?.exact, true);
    }
  });

  /**
   * The bug this replaced, in the numbers it produced. 2028 carries no early
   * row, so resolving each end on its own gave `2028 generic / 2027 Early` —
   * 3,000/6,000 — where the like-for-like answer is 3,000/5,000. A 20% error on
   * the most-traded asset on the board, always understating a future first, and
   * nothing about the number looked wrong.
   */
  await t.test("a tier missing on one side drops *both* sides to generic", () => {
    const early = ktcPickDiscount(board, { season: "2028", round: 1 }, "early", true);
    assert.equal(early?.factor, 3000 / 5000);
    assert.notEqual(early?.factor, 3000 / 6000);
    // Still a real answer, on a broader row than the pick's own — which is a
    // different thing from the draft order being unknown, so it is said as
    // "estimated from the generic row" and not as an unplaced pick.
    assert.equal(early?.tier, null);
    assert.equal(early?.exact, false);
  });

  await t.test("it is the *base* side missing the tier too", () => {
    // The mirror image: the future season carries the tier and the base doesn't.
    // Crossing them would be `2028 Early / 2027 generic`, which flatters the
    // future pick exactly as the other direction understates it.
    const oneSided: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, null)]: price(5000),
      [ktcPickKey("2028", 1, "early")]: price(4400),
      [ktcPickKey("2028", 1, null)]: price(3600),
    };
    const early = ktcPickDiscount(oneSided, { season: "2028", round: 1 }, "early", true);
    assert.equal(early?.factor, 3600 / 5000);
    assert.notEqual(early?.factor, 4400 / 5000);
    assert.equal(early?.exact, false);
  });

  await t.test("both sides missing the tier is still like-for-like", () => {
    const late = ktcPickDiscount(board, { season: "2029", round: 1 }, "late", true);
    assert.equal(late?.factor, 1500 / 5000);
    assert.equal(late?.tier, null);
    assert.equal(late?.exact, false);
  });

  /**
   * No shared row is no discount. Inventing a pair to avoid the null would be
   * the same mistake wearing a number — which is why this case, where each
   * season prices exactly the row the other doesn't, has to come back empty.
   */
  await t.test("no comparable pair is no discount rather than a crossed one", () => {
    const disjoint: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, "early")]: price(6000),
      [ktcPickKey("2028", 1, "late")]: price(2800),
    };
    assert.equal(
      ktcPickDiscount(disjoint, { season: "2028", round: 1 }, "early", true),
      null,
    );
    assert.equal(
      ktcPickDiscount(disjoint, { season: "2028", round: 1 }, "late", true),
      null,
    );
    assert.equal(
      ktcPickDiscount(disjoint, { season: "2028", round: 1 }, null, true),
      null,
    );
  });

  /**
   * An unplaced pick prefers the untiered row — that row *is* the price of a
   * pick with no place, so reading it is exact rather than a stand-in — and
   * falls to mid on both ends where there isn't one.
   */
  await t.test("an unplaced pick reads the untiered row on both ends", () => {
    const generic = ktcPickDiscount(board, { season: "2028", round: 1 }, null, true);
    assert.equal(generic?.tier, null);
    assert.equal(generic?.exact, true);

    const midOnly: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, "mid")]: price(5000),
      [ktcPickKey("2027", 1, "early")]: price(6000),
      [ktcPickKey("2028", 1, "mid")]: price(3200),
    };
    const stood = ktcPickDiscount(midOnly, { season: "2028", round: 1 }, null, true);
    assert.equal(stood?.factor, 3200 / 5000);
    assert.equal(stood?.tier, "mid");
    assert.equal(stood?.exact, false);
  });

  /**
   * The arithmetic guards. These are scraped numbers, so a zero anchor or a
   * negative price has to leave the row unusable rather than propagate an
   * Infinity or a negative multiplier into every pick's value.
   */
  await t.test("a zero or negative price is not a ratio", () => {
    const zeroed: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, null)]: price(0),
      [ktcPickKey("2028", 1, null)]: price(3000),
    };
    assert.equal(
      ktcPickDiscount(zeroed, { season: "2028", round: 1 }, null, true),
      null,
    );

    const negative: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, null)]: price(5000),
      [ktcPickKey("2028", 1, null)]: { sf: -100, oneqb: -100 },
    };
    assert.equal(
      ktcPickDiscount(negative, { season: "2028", round: 1 }, null, true),
      null,
    );

    // A board with a row present and unpriced on this league's board falls
    // through to the next row rather than reading null as zero.
    const halfPriced: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, "early")]: price(6000),
      [ktcPickKey("2027", 1, null)]: price(5000),
      [ktcPickKey("2028", 1, "early")]: { sf: null, oneqb: 4000 },
      [ktcPickKey("2028", 1, null)]: price(3000),
    };
    assert.equal(
      ktcPickDiscount(halfPriced, { season: "2028", round: 1 }, "early", true)
        ?.factor,
      3000 / 5000,
    );
  });

  await t.test("the ratio is read on the league's own board", () => {
    // `price` puts the 1QB number 200 below the superflex one, so the two
    // boards give different ratios for the same pick — which is why this takes
    // the league's answer rather than picking one.
    const sf = ktcPickDiscount(board, { season: "2028", round: 1 }, null, true);
    const oneqb = ktcPickDiscount(board, { season: "2028", round: 1 }, null, false);
    assert.notEqual(sf?.factor, oneqb?.factor);
    assert.equal(oneqb?.factor, 2800 / 4800);
  });

  // Null is what leaves a far-future pick unpriced rather than quoted at the
  // nearest draft's price — the one wrong answer that would look like a
  // working one.
  await t.test("no row on either end is no discount, never a guess", () => {
    assert.equal(ktcPickDiscount({}, { season: "2029", round: 1 }, null, true), null);
    // KTC prices no 2029 second at all.
    assert.equal(
      ktcPickDiscount(board, { season: "2029", round: 2 }, null, true),
      null,
    );
    // A round the *base* season doesn't carry has nothing to measure against.
    assert.equal(
      ktcPickDiscount(
        { ...board, [ktcPickKey("2029", 3, null)]: price(400) },
        { season: "2029", round: 3 },
        null,
        true,
      ),
      null,
    );
  });
});

test("ktcPickBoardRows", async (t) => {
  // What it is *for*: the ADP board enumerates its future pick rows from this,
  // so the answer has to be which `(season, round)` the board has an opinion
  // about — not how many rows it stores about each of them.
  await t.test("collapses the three tiers of a round to one row", () => {
    const board = {
      [ktcPickKey("2027", 1, "early")]: price(6000),
      [ktcPickKey("2027", 1, "mid")]: price(5000),
      [ktcPickKey("2027", 1, "late")]: price(4000),
      [ktcPickKey("2027", 2, null)]: price(2000),
    };
    assert.deepEqual(ktcPickBoardRows(board), [
      { season: "2027", round: 1 },
      { season: "2027", round: 2 },
    ]);
  });

  // Seasons are four-digit years, so a string compare is the numeric one — and
  // the order is what decides which future seasons a board lists first.
  await t.test("orders by season then round", () => {
    const board = {
      [ktcPickKey("2029", 1, null)]: price(1000),
      [ktcPickKey("2028", 3, null)]: price(800),
      [ktcPickKey("2028", 1, null)]: price(3000),
    };
    assert.deepEqual(ktcPickBoardRows(board), [
      { season: "2028", round: 1 },
      { season: "2028", round: 3 },
      { season: "2029", round: 1 },
    ]);
  });

  await t.test("an empty board prices no picks at all", () => {
    assert.deepEqual(ktcPickBoardRows({}), []);
  });

  // A key `ktcPickKey` didn't write is skipped rather than guessed at, the same
  // call `parseKtcPickName` makes about a name it doesn't understand.
  await t.test("a key it doesn't understand is not a row", () => {
    const board = {
      "not a key": price(100),
      "2030|x|": price(100),
      [ktcPickKey("2030", 1, null)]: price(900),
    };
    assert.deepEqual(ktcPickBoardRows(board), [{ season: "2030", round: 1 }]);
  });
});
