import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DRAFT_CAPITAL_HALF_LIFE,
  DRAFT_CAPITAL_PEAK,
  NFL_DRAFT_LAST_PICK,
  UNDRAFTED_SLOT,
  draftCapital,
  draftPickLabel,
  pickCapital,
} from "./capital.ts";

import type { NflDraftPick } from "./types.ts";

const drafted = (overall: number, round = 1, slot = 1): NflDraftPick => ({
  playerId: "p",
  season: "2020",
  round,
  slot,
  overall,
});

const undrafted: NflDraftPick = {
  playerId: "u",
  season: "2020",
  round: null,
  slot: null,
  overall: null,
};

describe("pickCapital", () => {
  test("the first overall pick is the peak exactly", () => {
    assert.equal(pickCapital(1), DRAFT_CAPITAL_PEAK);
  });

  test("capital halves every half-life picks", () => {
    assert.equal(pickCapital(1 + DRAFT_CAPITAL_HALF_LIFE), DRAFT_CAPITAL_PEAK / 2);
    assert.equal(
      pickCapital(1 + 2 * DRAFT_CAPITAL_HALF_LIFE),
      DRAFT_CAPITAL_PEAK / 4,
    );
  });

  /**
   * Never *rising* is the property that has to hold everywhere — a later pick
   * worth more than an earlier one would be incoherent. Strictly falling is
   * only true while the curve is above the rounding floor: values are rounded
   * whole (`adpValue`'s own choice), so deep in round 7 adjacent picks tie.
   * That is the honest behaviour rather than a defect — pick 251 and pick 252
   * are not different draft capital — and stating it here is what stops
   * somebody "fixing" it by dropping the rounding.
   */
  test("it never rises across the whole draft", () => {
    for (let pick = 2; pick <= NFL_DRAFT_LAST_PICK; pick++) {
      assert.ok(
        pickCapital(pick) <= pickCapital(pick - 1),
        `pick ${pick} must not be worth more than ${pick - 1}`,
      );
    }
  });

  test("it falls strictly through the picks that carry real separation", () => {
    for (let pick = 2; pick <= 100; pick++) {
      assert.ok(
        pickCapital(pick) < pickCapital(pick - 1),
        `pick ${pick} should be worth less than ${pick - 1}`,
      );
    }
  });

  test("junk and out-of-range picks clamp to the peak rather than exceeding it", () => {
    for (const junk of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.ok(pickCapital(junk) <= DRAFT_CAPITAL_PEAK);
    }
    assert.equal(pickCapital(1), DRAFT_CAPITAL_PEAK);
  });

  test("a zero or negative half-life falls back rather than dividing by zero", () => {
    assert.equal(pickCapital(33, 0), pickCapital(33));
    assert.equal(pickCapital(33, -1), pickCapital(33));
  });

  /**
   * The property the whole module exists for. On the raw pick number these two
   * gaps are identical (19 picks each); the curve is what makes the first the
   * difference between a franchise quarterback and a late first, and the second
   * two Day 3 fliers nobody could tell apart.
   */
  test("early-pick gaps dwarf equal-sized late-pick gaps", () => {
    const early = pickCapital(1) - pickCapital(20);
    const late = pickCapital(200) - pickCapital(219);
    assert.ok(
      early > late * 50,
      `early gap ${early} should dwarf late gap ${late}`,
    );
  });
});

describe("draftCapital", () => {
  test("a drafted player is worth his pick", () => {
    assert.equal(draftCapital(drafted(1)), DRAFT_CAPITAL_PEAK);
    assert.equal(draftCapital(drafted(33)), pickCapital(33));
  });

  test("undrafted is a value, and the same one for everybody", () => {
    const other: NflDraftPick = { ...undrafted, playerId: "u2", season: "2014" };
    assert.equal(draftCapital(undrafted), pickCapital(UNDRAFTED_SLOT));
    assert.equal(draftCapital(undrafted), draftCapital(other));
  });

  test("undrafted sits just below the last pick, not at zero", () => {
    const last = draftCapital(drafted(NFL_DRAFT_LAST_PICK, 7, 44));
    const udfa = draftCapital(undrafted);
    assert.ok(udfa !== null && last !== null);
    assert.ok(udfa < last, "an undrafted player is worth less than the last pick");
    assert.ok(udfa > 0, "undrafted is a real value, never zero");
  });

  /**
   * The distinction the whole feature rests on. Null here excludes a player
   * from any comparison weighting draft capital; the undrafted value includes
   * him. Collapsing the two would sweep every player the crosswalk has never
   * heard of into the undrafted cluster.
   */
  test("unknown is null, and is not the undrafted value", () => {
    assert.equal(draftCapital(null), null);
    assert.equal(draftCapital(undefined), null);
    assert.notEqual(draftCapital(undrafted), null);
  });
});

describe("draftPickLabel", () => {
  test("a placed pick reads round-dot-slot, zero-padded", () => {
    assert.equal(draftPickLabel(drafted(5, 1, 5)), "1.05");
    assert.equal(draftPickLabel(drafted(249, 7, 33)), "7.33");
  });

  test("undrafted says so", () => {
    assert.equal(draftPickLabel(undrafted), "UDFA");
  });

  test("unknown has no label at all", () => {
    assert.equal(draftPickLabel(null), null);
  });

  test("a round with no slot names the round rather than inventing one", () => {
    assert.equal(
      draftPickLabel({ ...drafted(40), round: 2, slot: null }),
      "Rd 2",
    );
  });

  test("a pick with no round at all falls back to the overall number", () => {
    assert.equal(
      draftPickLabel({ ...drafted(40), round: null, slot: null }),
      "#40",
    );
  });
});
