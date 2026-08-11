import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { scoreStatLine, unprojectedScoring } from "./score.ts";

/**
 * The whole point of scoring a projection ourselves is that Sleeper's `pts_ppr`
 * is wrong for any league that isn't vanilla PPR — so the cases that matter are
 * the ones where a league's settings diverge, and the ones where a stat or a
 * setting is present but shouldn't count.
 */

/** Ja'Marr Chase's stored week 1 projection, verbatim. */
const receiver = {
  gp: 1,
  fum: 0.07,
  rec: 6.36,
  rec_fd: 9.94,
  rec_td: 0.67,
  rec_yd: 99.43,
  rec_2pt: 0.02,
  rec_40p: 0.64,
  rec_tgt: 10.61,
  rush_td: 0,
  rush_yd: 0.86,
  rush_2pt: 0,
  fum_lost: 0.03,
  bonus_rec_wr: 6.36,
  pts_std: 14,
  pts_half_ppr: 17.18,
  pts_ppr: 20.36,
  adp_dd_ppr: 1,
};

/** Sleeper's default PPR weights for the categories above. */
const ppr = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  fum_lost: -2,
  bonus_rec_wr: 0,
};

describe("scoreStatLine", () => {
  test("agrees with Sleeper's own PPR total for the same stat line", () => {
    // 20.39 against the 20.36 Sleeper published — measured across 206 real skill
    // projections, this agreement holds to 0.019 points on average, so a larger
    // gap on a real line means a weight is wrong, not that the numbers round.
    const points = scoreStatLine(receiver, ppr);
    assert.equal(points, 20.39);
    // Rounded before comparing: the subtraction itself carries float noise
    // (20.39 - 20.36 is 0.030000000000001 in binary).
    assert.ok(Math.round(Math.abs(points - receiver.pts_ppr) * 100) / 100 <= 0.03);
  });

  test("half PPR and standard fall out of the same dot product", () => {
    assert.equal(scoreStatLine(receiver, { ...ppr, rec: 0.5 }), 17.21);
    assert.equal(scoreStatLine(receiver, { ...ppr, rec: 0 }), 14.03);
  });

  test("a reception bonus changes the total — the reason this exists", () => {
    // A WR-bonus league pays 0.25 a catch on top of PPR: 20.39 + 1.59.
    assert.equal(scoreStatLine(receiver, { ...ppr, bonus_rec_wr: 0.25 }), 21.98);
  });

  test("never scores Sleeper's own totals, even if a league lists them", () => {
    // Scoring `pts_ppr` would add the whole projection to itself, silently.
    assert.equal(scoreStatLine(receiver, { ...ppr, pts_ppr: 1 }), 20.39);
    assert.equal(scoreStatLine(receiver, { ...ppr, adp_dd_ppr: 1 }), 20.39);
  });

  test("ignores stats the league doesn't score", () => {
    // `rec_tgt`, `rec_fd` and `gp` are in every stat line; settings decide what
    // counts, and most leagues score none of the three.
    assert.equal(scoreStatLine(receiver, { rec: 1 }), 6.36);
  });

  test("ignores categories the league scores but the projection lacks", () => {
    assert.equal(scoreStatLine(receiver, { ...ppr, tkl_solo: 1, punt_ret_yd: 0.1 }), 20.39);
  });

  test("a quarterback under real league scoring is nothing like pts_ppr", () => {
    // Lamar Jackson's stored week 1 line. Sleeper ships pts_ppr = 25.07, but it
    // computes passing yards at 0.05 a yard — the rate its own leagues default to
    // is 0.04. Measured across 32 QB projections, that one difference puts pts_ppr
    // ~2.3 points above what a default-scoring league actually pays, before any
    // league quirk. It is the reason `pts_ppr` can't stand in for league scoring.
    const qb = {
      gp: 1, fum: 0.67, fum_lost: 0.29, pass_2pt: 0.08, pass_att: 28.32,
      pass_cmp: 18.97, pass_fd: 22.83, pass_int: 0.73, pass_sack: 1.92,
      pass_td: 1.82, pass_yd: 228.3, rush_2pt: 0.01, rush_att: 9.38,
      rush_fd: 5.96, rush_td: 0.27, rush_yd: 59.63,
      pts_std: 25.07, pts_half_ppr: 25.07, pts_ppr: 25.07, adp_dd_ppr: 22,
    };
    const league = {
      pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
      rush_yd: 0.1, rush_td: 6, rush_2pt: 2, fum_lost: -2,
    };

    assert.equal(scoreStatLine(qb, league), 22.87);
    assert.equal(scoreStatLine(qb, { ...league, pass_yd: 0.05 }), 25.15);
    // Six-point passing touchdowns, a common house rule, move him again.
    assert.equal(scoreStatLine(qb, { ...league, pass_td: 6 }), 26.51);
  });

  test("applies negative weights", () => {
    const fumbler = { rush_yd: 50, fum: 0.8, fum_lost: 0.4 };
    // 5 - 0.8 - 0.8: Sleeper scores the fumble and the loss as separate events.
    assert.equal(scoreStatLine(fumbler, { rush_yd: 0.1, fum: -1, fum_lost: -2 }), 3.4);
  });

  test("scores a defense from its own categories", () => {
    const dst = { sack: 2.57, int: 0.8, ff: 0.97, def_td: 0.17, pts_allow_21_27: 1 };
    assert.equal(
      scoreStatLine(dst, { sack: 1, int: 2, def_td: 6, pts_allow_21_27: 1, ff: 0 }),
      6.19,
    );
  });

  test("scores the first downs and the reception splits like any other key", () => {
    // Sleeper populates these itself rather than modelling them, which is its
    // business and not this function's: the league pays for the category and the
    // line carries it, so it scores. 20.39 + 9.94.
    assert.equal(scoreStatLine(receiver, { ...ppr, rec_fd: 1 }), 30.33);
    // 20.39 + 0.64 * 1.5.
    assert.equal(scoreStatLine(receiver, { ...ppr, rec_40p: 1.5 }), 21.35);
  });

  test("scores the yardage bonuses too", () => {
    assert.equal(scoreStatLine({ rush_40p: 0.19 }, { rush_40p: 2 }), 0.38);
    assert.equal(scoreStatLine({ pass_cmp_40p: 0.4 }, { pass_cmp_40p: 1 }), 0.4);
  });

  test("rounds to two decimals rather than leaking float noise", () => {
    // 0.1 * 3 is 0.30000000000000004 in binary floating point.
    assert.equal(scoreStatLine({ rush_yd: 3 }, { rush_yd: 0.1 }), 0.3);
  });

  test("empty, missing and malformed inputs score zero, not NaN", () => {
    assert.equal(scoreStatLine(null, ppr), 0);
    assert.equal(scoreStatLine(receiver, null), 0);
    assert.equal(scoreStatLine({}, ppr), 0);
    assert.equal(scoreStatLine(receiver, {}), 0);
    assert.equal(
      scoreStatLine({ rec: "6" as unknown as number }, { rec: 1 }),
      0,
    );
    assert.equal(
      scoreStatLine({ rec: 6 }, { rec: NaN as unknown as number }),
      0,
    );
  });
});

describe("unprojectedScoring", () => {
  const available = Object.keys(receiver);

  test("names the scored categories projections can't supply", () => {
    assert.deepEqual(
      unprojectedScoring({ rec: 1, tkl_solo: 1, punt_ret_yd: 0.1 }, available),
      ["punt_ret_yd", "tkl_solo"],
    );
  });

  test("ignores disabled categories", () => {
    // Sleeper writes out its whole template, so a league carries dozens of zeroed
    // keys that are switched off rather than unavailable.
    assert.deepEqual(unprojectedScoring({ tkl_solo: 0, blk_kick: 0 }, available), []);
  });

  test("says nothing is missing when the league is fully covered", () => {
    assert.deepEqual(unprojectedScoring(ppr, available), []);
  });

  test("never reports the non-scorable keys as gaps", () => {
    assert.deepEqual(unprojectedScoring({ pts_ppr: 1, adp_dd_ppr: 1 }, []), []);
  });

  test("never reports a category the line carries, however it got there", () => {
    // `rec_fd` is in every stat line Sleeper publishes, so a league scoring it
    // has no gap to be told about.
    assert.deepEqual(unprojectedScoring({ rec_fd: 1, tkl_solo: 1 }, available), [
      "tkl_solo",
    ]);
  });

  test("handles missing settings", () => {
    assert.deepEqual(unprojectedScoring(null, available), []);
  });
});

describe("scoreStatLine on a played week", () => {
  test("scores a real first-down count off the same dot product", () => {
    const line = { gp: 1, rush_yd: 100, rush_fd: 6, rush_td: 1 };
    const scoring = { rush_yd: 0.1, rush_fd: 0.5, rush_td: 6 };

    assert.equal(scoreStatLine(line, scoring), 19);
  });

  test("the reception splits score as buckets", () => {
    const line = { gp: 1, rec: 6, rec_40p: 1 };
    assert.equal(scoreStatLine(line, { rec: 1, rec_40p: 2 }), 8);
  });

  test("it still refuses to score Sleeper's own totals", () => {
    // Scoring `pts_ppr` would add the whole line to itself — the one exclusion
    // that survives, because those keys restate the answer rather than naming an
    // event.
    assert.equal(scoreStatLine({ pts_ppr: 24, rec: 4 }, { pts_ppr: 1, rec: 1 }), 4);
  });

  test("a missing line or missing settings is zero, not a throw", () => {
    assert.equal(scoreStatLine(null, ppr), 0);
    assert.equal(scoreStatLine({ rec: 4 }, null), 0);
  });
});
