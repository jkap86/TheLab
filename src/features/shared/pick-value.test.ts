import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ktcPickKey } from "../../shared/ktc/picks.ts";
import type { KtcPickPrice } from "../../shared/ktc/picks.ts";
import { adpValue } from "../../shared/manager/adp-value.ts";
import {
  middleSlot,
  pickAdpValue,
  pickEstimated,
  rookieLadder,
  rookiePickNumber,
} from "./pick-value.ts";
import type {
  PickAdpMatch,
  PickAdpResult,
  RookieLadderRung,
} from "./pick-value.ts";
import type { AdpPlayerPayload } from "@/shared/contract";
import type { AdpBoardType } from "@/shared/manager";

/**
 * The rookie ladder and what a pick reads off it.
 *
 * What is worth pinning here is the set of claims the column rests on that
 * neither the type system nor a render can hold — every one of them is silent
 * when wrong, because every card still draws a plausible number:
 *
 * - **The ordering and the price come off different boards.** The rookie drafts
 *   say which rookie a pick takes; the startups say what he is worth. Feeding a
 *   rookie-draft ADP to the value curve makes the 1.01 the most valuable asset
 *   in dynasty football, which is what the whole file exists to prevent.
 * - **The ladder is an ordering, so it never compresses.** A rookie the startup
 *   board can't price keeps his rung and is interpolated across; dropping him
 *   would quietly renumber every pick below him.
 * - **A future pick is the same rung scaled by a *like-for-like* KTC ratio**,
 *   never by two rows describing different picks.
 * - **The three assumptions are three flags.** A pick whose slot is known and
 *   whose KTC row fell back must not be reported as an unplaced pick.
 */

const stats = (adp: number, picks = 20) => ({
  adp,
  picks,
  min_pick: 1,
  max_pick: 100,
  stdev: 3,
});

/** One board row: a player with an average on exactly one of the two markets. */
function row(
  id: string,
  adp: number,
  { market = "dynasty" as AdpBoardType, rookie = true, picks = 20 } = {},
): AdpPlayerPayload {
  const board = stats(adp, picks);
  return {
    player_id: id,
    name: id,
    position: "WR",
    team: "SF",
    rookie,
    redraft: market === "redraft" ? board : null,
    dynasty: market === "dynasty" ? board : null,
    // The ladder is built from ADP alone — KTC is asked only what *waiting*
    // costs, which `ktcPicks` carries separately.
    ktc: null,
  };
}

/** A rookie-draft board — the ordering half. Its ADPs place, they don't price. */
const ordering = (
  entries: readonly (readonly [string, number])[],
  market: AdpBoardType = "dynasty",
): AdpPlayerPayload[] =>
  entries.map(([id, adp]) => row(id, adp, { market, rookie: true }));

/**
 * A startup board — the pricing half. `rookie` is false throughout on purpose:
 * nothing about the pricing board's rows is filtered by it, and a fixture that
 * set it would hide a regression where this half started filtering too.
 */
const pricing = (
  entries: readonly (readonly [string, number])[],
  market: AdpBoardType = "dynasty",
): AdpPlayerPayload[] =>
  entries.map(([id, adp]) => row(id, adp, { market, rookie: false }));

/**
 * A 12-team league starting nine — a pool of 108, on which the default four
 * halvings make value `10000 · 2^(−(adp−1)/27)`. The startup ADPs below are the
 * picks that land on exact powers of two, so an expected number is checkable
 * rather than a rounding to trust.
 */
const POOL = 108;
const STEEPNESS = 4;

/**
 * Twenty-four rookies, ordered 1…24 by the rookie drafts and priced 1, 28, 55…
 * by the startups. The two scales are deliberately nothing like each other —
 * that gap is the whole subject of this file, and a fixture where rookie #3 also
 * had startup ADP 3 would pass whichever board the code read.
 */
const LADDER_IDS = Array.from({ length: 24 }, (_, i) => `R${i + 1}`);
const ROOKIE_ADPS = LADDER_IDS.map((id, i) => [id, i + 1] as const);
const STARTUP_ADPS = LADDER_IDS.map((id, i) => [id, 1 + 27 * i] as const);
const ladder = rookieLadder(
  ordering(ROOKIE_ADPS),
  pricing(STARTUP_ADPS),
  "dynasty",
);

/**
 * KTC prices 2027 and 2028 firsts. 2028 has only an untiered row, which is the
 * common shape and the one the like-for-like rule is about: the 2028 generic
 * belongs over the *2027 generic*, never over the 2027 early row beside it.
 */
const ktcPicks: Record<string, KtcPickPrice> = {
  [ktcPickKey("2027", 1, "early")]: { sf: 6000, oneqb: 5400 },
  [ktcPickKey("2027", 1, null)]: { sf: 5000, oneqb: 4500 },
  [ktcPickKey("2028", 1, null)]: { sf: 3000, oneqb: 2700 },
};

const price = (over: Partial<Parameters<typeof pickAdpValue>[0]> = {}) =>
  pickAdpValue({
    ladder,
    pick: { season: "2027", round: 1 },
    slot: null,
    teams: 12,
    pool: POOL,
    steepness: STEEPNESS,
    ktcPicks,
    superflex: true,
    ...over,
  });

/**
 * Assert a pick priced, and hand the match back narrowed.
 *
 * The result is a union with a `reason` on the refusal side, which is the whole
 * point of it — but a test that has already said which side it expects should
 * not go on re-proving it field by field.
 */
function priced(result: PickAdpResult): PickAdpMatch {
  assert.notEqual(result.value, null, `unpriced: ${result.reason}`);
  return result as PickAdpMatch;
}

/** What the curve pays for an ADP under the fixture's own pool and steepness. */
const valueOf = (adp: number) => adpValue(adp, POOL, STEEPNESS);

describe("rookieLadder", () => {
  test("the order is the rookie drafts' own, not the startup market's", () => {
    // The two boards disagree completely: the rookie drafts take A, B, C in that
    // order, the startup market prices them in reverse. The ladder is the rookie
    // drafts' answer — which rookie a pick *takes* is not a question about what
    // the startup market thinks of him.
    const rungs = rookieLadder(
      ordering([
        ["A", 1.2],
        ["B", 2.0],
        ["C", 3.1],
      ]),
      pricing([
        ["A", 31],
        ["B", 22],
        ["C", 14],
      ]),
      "dynasty",
    );
    assert.deepEqual(
      rungs.map((r) => r.player_id),
      ["A", "B", "C"],
    );
    // And each rung carries the *startup* number, so the 1.01 is priced at what
    // the startup market pays for A rather than at his rookie-draft ADP of 1.2.
    assert.deepEqual(
      rungs.map((r) => r.startupAdp),
      [31, 22, 14],
    );
    assert.deepEqual(
      rungs.map((r) => r.rookieAdp),
      [1.2, 2.0, 3.1],
    );
  });

  test("only rookies the rookie drafts averaged are rungs", () => {
    const board = [
      // A veteran taken in a rookie/FA draft: not a rung, whatever his ADP.
      row("vet", 1, { rookie: false }),
      ...ordering([
        ["r1", 2],
        ["r2", 3],
      ]),
      // A rookie those drafts never took: a place invented for him would shift
      // every pick below him by one, which is the one error here that spreads.
      row("r3", 0, { rookie: true }),
    ];
    board[board.length - 1] = {
      ...board[board.length - 1],
      dynasty: null,
      redraft: null,
    };
    assert.deepEqual(
      rookieLadder(board, pricing([["r1", 10]]), "dynasty").map(
        (r) => r.player_id,
      ),
      ["r1", "r2"],
    );
  });

  test("the two markets are two different queues", () => {
    const board = [
      row("early-in-dynasty", 1, { market: "dynasty" }),
      row("early-in-redraft", 1, { market: "redraft" }),
    ];
    assert.deepEqual(
      rookieLadder(board, [], "dynasty").map((r) => r.player_id),
      ["early-in-dynasty"],
    );
    assert.deepEqual(
      rookieLadder(board, [], "redraft").map((r) => r.player_id),
      ["early-in-redraft"],
    );
  });

  test("a board with no rookies has no ladder rather than a short one", () => {
    assert.deepEqual(
      rookieLadder([row("vet", 1, { rookie: false })], pricing([["vet", 1]]), "dynasty"),
      [],
    );
  });

  // The failure this split was built to fix: dropping an unpriced rookie
  // renumbers everyone under him, so the 1.03 quietly becomes the fourth rookie.
  test("a rookie the startup board can't price keeps his rung", () => {
    const rungs = rookieLadder(
      ordering([
        ["A", 1],
        ["B", 2],
        ["C", 3],
      ]),
      pricing([
        ["A", 15],
        ["C", 27],
      ]),
      "dynasty",
    );
    assert.deepEqual(
      rungs.map((r) => r.player_id),
      ["A", "B", "C"],
    );
    // Interpolated between the rookies either side of him, in rank space.
    assert.equal(rungs[1].startupAdp, 21);
    assert.equal(rungs[1].startupSource, "interpolated");
    // And the estimate says so rather than passing as an average: there is no
    // sample behind it, where the two beside it carry theirs.
    assert.equal(rungs[1].startupPicks, null);
    assert.equal(rungs[0].startupPicks, 20);
  });

  test("interpolation spans however many rungs are missing", () => {
    const rungs = rookieLadder(
      ordering([
        ["A", 1],
        ["B", 2],
        ["C", 3],
        ["D", 4],
        ["E", 5],
      ]),
      pricing([
        ["A", 10],
        ["E", 50],
      ]),
      "dynasty",
    );
    assert.deepEqual(
      rungs.map((r) => r.startupAdp),
      [10, 20, 30, 40, 50],
    );
    assert.deepEqual(
      rungs.map((r) => r.startupSource),
      ["observed", "interpolated", "interpolated", "interpolated", "observed"],
    );
  });

  // At an end there is nothing to interpolate between, so the nearest priced
  // rookie stands in — unadjusted, because nudging it would invent a gap the
  // board never measured. The flag is what keeps that honest.
  test("a rookie past either end takes the nearest priced one", () => {
    const rungs = rookieLadder(
      ordering([
        ["A", 1],
        ["B", 2],
        ["C", 3],
      ]),
      pricing([["B", 20]]),
      "dynasty",
    );
    assert.deepEqual(
      rungs.map((r) => r.startupAdp),
      [20, 20, 20],
    );
    assert.deepEqual(
      rungs.map((r) => r.startupSource),
      ["nearest", "observed", "nearest"],
    );
  });

  test("a startup board that prices nobody leaves every rung unpriced", () => {
    const rungs = rookieLadder(
      ordering([
        ["A", 1],
        ["B", 2],
      ]),
      [],
      "dynasty",
    );
    assert.deepEqual(
      rungs.map((r) => r.startupAdp),
      [null, null],
    );
    assert.deepEqual(
      rungs.map((r) => r.startupSource),
      ["none", "none"],
    );
  });

  test("a duplicated row is one rung, and the order is total", () => {
    // Two rookies drafted at exactly the same average, plus a repeat of one of
    // them. The repeat can't add a rung — an extra rung is a pick nobody can see
    // — and the tie has to break the same way on every render, or two readers of
    // one board disagree about who the 1.01 is.
    const rungs = rookieLadder(
      [...ordering([["B", 4]]), ...ordering([["A", 4]]), ...ordering([["B", 4]])],
      pricing([
        ["A", 10],
        ["B", 20],
      ]),
      "dynasty",
    );
    assert.deepEqual(
      rungs.map((r) => r.player_id),
      ["A", "B"],
    );
  });

  test("a broken average is not a rung and not a price", () => {
    const broken = row("nan", Number.NaN, { rookie: true });
    assert.deepEqual(rookieLadder([broken], pricing([["nan", 5]]), "dynasty"), []);
    // The same value on the pricing side is no price rather than a NaN one,
    // which would reach the curve and take a whole haul's total with it.
    const rungs = rookieLadder(ordering([["A", 1]]), [broken], "dynasty");
    assert.equal(rungs[0].startupAdp, null);
  });
});

describe("rookiePickNumber", () => {
  test("a pick is its place in the whole draft, not in its round", () => {
    assert.equal(rookiePickNumber(1, 5, 12), 5);
    assert.equal(rookiePickNumber(2, 1, 12), 13);
    // The league's size is what makes the same 2.01 a different rung.
    assert.equal(rookiePickNumber(2, 1, 10), 11);
  });

  test("an unplaced pick takes the middle of its round", () => {
    assert.equal(middleSlot(12), 6);
    assert.equal(middleSlot(10), 5);
    assert.equal(middleSlot(14), 7);
  });
});

describe("pickAdpValue — which rookie a pick takes", () => {
  const at = (round: number, slot: number | null, teams = 12) =>
    priced(price({ pick: { season: "2027", round }, slot, teams }));

  test("a placed pick in a 12-team draft is the rung its slot lands on", () => {
    assert.equal(at(1, 1).overall, 1);
    assert.equal(at(1, 1).player, "R1");
    assert.equal(at(1, 6).overall, 6);
    assert.equal(at(1, 6).player, "R6");
    assert.equal(at(1, 12).overall, 12);
    assert.equal(at(1, 12).player, "R12");
    assert.equal(at(2, 1).overall, 13);
    assert.equal(at(2, 1).player, "R13");
    assert.equal(at(2, 6).overall, 18);
    assert.equal(at(2, 6).player, "R18");
  });

  test("an unplaced pick takes the middle of its round and says so", () => {
    const first = at(1, null);
    assert.equal(first.overall, 6);
    assert.equal(first.slotEstimated, true);
    const second = at(2, null);
    assert.equal(second.overall, 18);
    assert.equal(second.slotEstimated, true);
    // And a placed one is not reported as a guess about its own slot.
    assert.equal(at(1, 6).slotEstimated, false);
  });

  test("the league's size decides the rung, everywhere it is read", () => {
    // Round, slot and the unknown-slot fallback all scale with the field.
    assert.equal(at(2, 1, 10).overall, 11);
    assert.equal(at(2, 1, 14).overall, 15);
    assert.equal(at(1, null, 10).overall, 5);
    assert.equal(at(1, null, 14).overall, 7);
    assert.equal(at(2, null, 10).overall, 15);
    assert.equal(at(2, null, 14).overall, 21);
  });

  test("twelve stands in where the league list hasn't answered", () => {
    assert.equal(priced(price({ slot: 3, teams: null })).overall, 3);
    // A slot is still a slot when the size isn't known, so this is not reported
    // as an unplaced pick — only the field it is placed in was assumed.
    assert.equal(priced(price({ slot: 3, teams: null })).slotEstimated, false);
  });
});

describe("pickAdpValue — what that rookie is worth", () => {
  /**
   * The heart of it. The fixture's rookie #1 has rookie-draft ADP 1 and startup
   * ADP 1, which is the one pair that *would* pass either way — so these use
   * rungs where the two boards say very different things.
   */
  test("the value is the curve over the rookie's startup ADP", () => {
    // Rookie #2: rookie-draft ADP 2, startup ADP 28.
    const second = priced(price({ slot: 2 }));
    assert.equal(second.startupAdp, 28);
    assert.equal(second.rookieAdp, 2);
    assert.equal(second.value, valueOf(28));
    assert.equal(second.value, 5000);
  });

  test("a rookie-draft ADP is never fed to the value curve", () => {
    // The regression this file exists for: read off the rookie board, the 1.02
    // is ADP 2 and comes out at essentially the peak — the most valuable asset
    // in dynasty football, for the second pick of a rookie draft.
    const second = priced(price({ slot: 2 }));
    assert.notEqual(second.value, valueOf(second.rookieAdp));
    assert.ok(second.value < 9000, `1.02 priced at ${second.value}`);

    // Stated as the spec's own example: rookie ADP 1/2/3 against startup ADP
    // 12/20/31, where every pick must read the second list.
    const spec = rookieLadder(
      ordering([
        ["A", 1],
        ["B", 2],
        ["C", 3],
      ]),
      pricing([
        ["A", 12],
        ["B", 20],
        ["C", 31],
      ]),
      "dynasty",
    );
    const rookiePick = (slot: number) =>
      priced(price({ ladder: spec, slot })).value;
    assert.equal(rookiePick(1), valueOf(12));
    assert.equal(rookiePick(2), valueOf(20));
    assert.equal(rookiePick(3), valueOf(31));
    assert.notEqual(rookiePick(1), valueOf(1));
    assert.notEqual(rookiePick(2), valueOf(2));
    assert.notEqual(rookiePick(3), valueOf(3));
  });

  test("an interpolated rookie is priced and flagged, not dropped", () => {
    const gapped = rookieLadder(
      ordering([
        ["A", 1],
        ["B", 2],
        ["C", 3],
      ]),
      pricing([
        ["A", 15],
        ["C", 27],
      ]),
      "dynasty",
    );
    const second = priced(price({ ladder: gapped, slot: 2 }));
    // B is still the 1.02 — the ladder did not compress onto C.
    assert.equal(second.player, "B");
    assert.equal(second.startupAdp, 21);
    assert.equal(second.value, valueOf(21));
    assert.equal(second.startupAdpEstimated, true);
    assert.equal(second.startupSource, "interpolated");
    // And its neighbours, which were observed, are not flagged.
    assert.equal(priced(price({ ladder: gapped, slot: 1 })).startupAdpEstimated, false);
    assert.equal(priced(price({ ladder: gapped, slot: 3 })).startupAdpEstimated, false);
  });

  test("the panel's curve reaches a pick as it reaches a player", () => {
    assert.equal(price({ slot: 2, steepness: 4 }).value, 5000);
    assert.equal(price({ slot: 2, steepness: 8 }).value, 2500);
  });

  test("steepness moves the value and nothing else", () => {
    const flat = priced(price({ slot: 4, steepness: 2 }));
    const steep = priced(price({ slot: 4, steepness: 8 }));
    assert.notEqual(flat.value, steep.value);
    // Not the ordering: the same rookie is the same rung on any curve.
    assert.equal(flat.player, steep.player);
    assert.equal(flat.overall, steep.overall);
    assert.equal(flat.startupAdp, steep.startupAdp);
    // Not the KTC ratio either — the curve prices a pick, it doesn't discount it.
    const later = { pick: { season: "2028", round: 1 } as const, slot: 4 };
    assert.equal(
      priced(price({ ...later, steepness: 2 })).discount,
      priced(price({ ...later, steepness: 8 })).discount,
    );
  });

  test("the same inputs always produce the same number", () => {
    const once = priced(price({ slot: 5 }));
    const twice = priced(price({ slot: 5 }));
    assert.deepEqual(once, twice);
  });
});

describe("pickAdpValue — what waiting costs", () => {
  // The one thing KTC is asked for under this column, and the reason it is a
  // ratio: a ratio is dimensionless, so it crosses between the boards where a
  // sum of their values would not.
  test("a future pick is the same rung scaled by KTC's own ratio", () => {
    const now = priced(price({ slot: 1 }));
    assert.equal(now.value, 10000);
    assert.equal(now.discount, 1);
    assert.equal(now.base, null);

    // Both ends on the generic row: 3,000 over 5,000. It is emphatically *not*
    // 3,000 over the 6,000 early row sitting beside it, which is what an
    // independent fallback per end used to produce.
    const later = priced(price({ pick: { season: "2028", round: 1 }, slot: 1 }));
    assert.equal(later.discount, 0.6);
    assert.equal(later.base, "2027");
    assert.equal(later.value, 6000);
    assert.equal(later.discountTier, null);
  });

  test("a pick at or before the nearest priced season is undiscounted", () => {
    // A season KTC has dropped — its draft has happened — is the ladder's own
    // class, so there is nothing to discount it by.
    const past = priced(price({ pick: { season: "2026", round: 1 }, slot: 2 }));
    assert.equal(past.discount, 1);
    assert.equal(past.value, 5000);
    assert.equal(past.discountEstimated, false);
  });

  /**
   * `ladderSeason` is the caller saying "this pick is the class the ladder
   * describes", and the case it exists for is the board being *gone*.
   *
   * With no rows at all there is no anchor, so every pick refuses as
   * `no-discount` — right for a 2032 4th, which must stay blank rather than be
   * quoted at a nearby pick's price, and wrong for a pick being spent now,
   * which needs nothing from KTC. A caller that enumerates a class knows the
   * difference; one that reads picks off leagues does not, so it passes nothing
   * and every pick goes through the board as before.
   */
  test("a claim about the ladder's own class survives KTC being gone", () => {
    const gone = { ktcPicks: {}, pick: { season: "2026", round: 1 }, slot: 2 };
    assert.equal(price(gone).value, null);
    assert.equal(price({ ...gone, ladderSeason: "2026" }).value, 5000);
    // The claim reaches only as far as it is made: a later season is still
    // unpriced, which is the whole reason the null is worth keeping.
    assert.equal(
      price({ ...gone, pick: { season: "2028", round: 1 }, ladderSeason: "2026" })
        .value,
      null,
    );
  });

  // It short-circuits the board rather than overriding it: where KTC *can*
  // answer, the two agree, so passing it changes no number that was already
  // right.
  test("it says what the board would have said anyway", () => {
    const own = { pick: { season: "2026", round: 1 }, slot: 2 };
    assert.deepEqual(price(own), price({ ...own, ladderSeason: "2026" }));
  });
});

describe("pickAdpValue — the three assumptions are three flags", () => {
  test("nothing assumed reports nothing assumed", () => {
    // Placed, observed startup ADP, and a 2027 pick needs no discount at all.
    const clean = priced(price({ slot: 1 }));
    assert.deepEqual(
      [clean.slotEstimated, clean.startupAdpEstimated, clean.discountEstimated],
      [false, false, false],
    );
    assert.equal(pickEstimated(clean), false);
  });

  /**
   * The bug the split was for: this pick's slot is known — the league set its
   * draft order — and only KTC's row fell back. Under one boolean the card told
   * the reader "(draft order not set)", which is a claim about their own league
   * and simply false.
   */
  test("a KTC fallback does not report the draft order as unknown", () => {
    const placed = priced(price({ pick: { season: "2028", round: 1 }, slot: 1 }));
    assert.equal(placed.slotEstimated, false);
    assert.equal(placed.startupAdpEstimated, false);
    assert.equal(placed.discountEstimated, true);
    assert.equal(pickEstimated(placed), true);
  });

  /**
   * And the converse: an unplaced pick reads the untiered row on *both* ends,
   * which is the right row for a pick with no place — so the slot is the
   * assumption and the discount is not.
   */
  test("an unplaced pick reports its slot and not its discount", () => {
    const unplaced = priced(price({ pick: { season: "2028", round: 1 } }));
    assert.equal(unplaced.slotEstimated, true);
    assert.equal(unplaced.discountEstimated, false);
    assert.equal(unplaced.discountTier, null);
  });
});

describe("pickAdpValue — the ways it runs out", () => {
  test("each refusal is its own answer", () => {
    assert.equal(price({ ladder: [], slot: 1 }).reason, "no-ladder");
    // Deeper than the class this board priced: rung 25 of a 24-rung ladder.
    assert.equal(
      price({ pick: { season: "2027", round: 3 }, slot: 1 }).reason,
      "past-ladder",
    );
    // Far enough out that KTC prices no row for it — left blank rather than
    // quoted at the nearest draft's price.
    assert.equal(
      price({ pick: { season: "2032", round: 1 }, slot: 1 }).reason,
      "no-discount",
    );
    // A board whose startup half priced nobody at all: every rung is a place
    // with no price, which is a different gap from having no places.
    const unpriced = rookieLadder(ordering([["A", 1]]), [], "dynasty");
    assert.equal(price({ ladder: unpriced, slot: 1 }).reason, "no-startup");
  });

  test("no like-for-like KTC pair is no discount, never a mismatched one", () => {
    // 2028 prices only an early row and 2027 only a generic one, so there is no
    // shared row: the honest answer is a blank cell, not 4,400/5,000.
    const mismatched: Record<string, KtcPickPrice> = {
      [ktcPickKey("2027", 1, null)]: { sf: 5000, oneqb: 4500 },
      [ktcPickKey("2028", 1, "early")]: { sf: 4400, oneqb: 4000 },
    };
    assert.equal(
      price({ pick: { season: "2028", round: 1 }, slot: 1, ktcPicks: mismatched })
        .reason,
      "no-discount",
    );
  });

  test("a pick that doesn't name a slot is refused rather than computed", () => {
    for (const round of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(
        price({ pick: { season: "2027", round }, slot: 1 }).reason,
        "bad-pick",
        `round ${round}`,
      );
    }
  });
});

describe("pickAdpValue — junk in, no junk out", () => {
  /**
   * Everything here arrives off Sleeper's loosely-typed blobs or off a scrape,
   * so the guard is that a bad input is an explicit refusal or a documented
   * stand-in — never a number carrying NaN, Infinity or a negative into a total
   * that is summed across a whole haul.
   */
  const finite = (result: PickAdpResult) => {
    if (result.value === null) return;
    assert.ok(
      Number.isFinite(result.value) && result.value >= 0,
      `bad value ${result.value}`,
    );
  };

  test("a nonsense team count falls back rather than dividing by it", () => {
    for (const teams of [0, -12, Number.NaN]) {
      const result = price({ teams, slot: null });
      finite(result);
      // The fallback is the same twelve the curve's own pool assumes, so an
      // unknown field and a broken one read alike.
      assert.equal(priced(result).overall, 6, `teams ${teams}`);
    }
  });

  test("a slot outside the field is unplaced, not out of bounds", () => {
    for (const slot of [0, -3, 13, 1.5, Number.NaN]) {
      const result = price({ slot, teams: 12 });
      finite(result);
      assert.equal(priced(result).slotEstimated, true, `slot ${slot}`);
      assert.equal(priced(result).overall, 6);
    }
  });

  test("a pool of zero is the curve's problem, and it has an answer", () => {
    const result = price({ slot: 2, pool: 0 });
    finite(result);
  });

  test("a KTC board of zeroes or negatives yields no ratio", () => {
    for (const sf of [0, -100]) {
      const board: Record<string, KtcPickPrice> = {
        [ktcPickKey("2027", 1, null)]: { sf, oneqb: sf },
        [ktcPickKey("2028", 1, null)]: { sf: 3000, oneqb: 2700 },
      };
      const result = price({
        pick: { season: "2028", round: 1 },
        slot: null,
        ktcPicks: board,
      });
      finite(result);
      assert.equal(result.reason, "no-discount", `anchor ${sf}`);
    }
  });

  test("an empty KTC board leaves a pick unpriced rather than undiscounted", () => {
    assert.equal(price({ slot: 1, ktcPicks: {} }).reason, "no-discount");
  });
});

describe("the ladder is a fact about the boards, not about a pick", () => {
  /**
   * The performance claim in one assertion: the ladder is built once, and a
   * pick is a lookup into it. Nothing in `pickAdpValue` fetches, scans a board,
   * or costs anything per rookie — which is what makes forty thousand cards
   * affordable.
   */
  test("pricing a pick reads one rung", () => {
    let reads = 0;
    const counted: RookieLadderRung[] = ladder.map((rung, i) =>
      Object.defineProperties({ ...rung }, {
        startupAdp: {
          get() {
            reads += 1;
            return ladder[i].startupAdp;
          },
        },
      }),
    );
    priced(price({ ladder: counted, slot: 4 }));
    // Twice: the null check and the value. Never once per rung on the ladder.
    assert.ok(reads <= 3, `read startupAdp ${reads} times`);
  });
});
