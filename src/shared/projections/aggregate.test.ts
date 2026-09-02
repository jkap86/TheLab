import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { aggregateWeeklyStats } from "./aggregate.ts";
import { scoreStatLine } from "./score.ts";

/**
 * The property the whole rest-of-season path rests on is linearity: summing stat
 * lines and scoring once has to equal scoring each week and summing. If that ever
 * stops holding, every aggregate total is quietly wrong, so it is tested directly
 * against real stat lines rather than asserted in a comment.
 */

/** Two weeks of a real receiver projection, trimmed to the scoring keys. */
const week1 = { rec: 6.36, rec_yd: 99.43, rec_td: 0.67, fum_lost: 0.03 };
const week2 = { rec: 5.11, rec_yd: 71.2, rec_td: 0.41, fum_lost: 0.02 };

const tePremium = { rec: 1, rec_yd: 0.1, rec_td: 6, fum_lost: -2, bonus_rec_te: 0.5 };

describe("aggregateWeeklyStats", () => {
  test("sums a player's stat lines and records which weeks contributed", () => {
    const out = aggregateWeeklyStats([
      { player_id: "1", week: 5, stats: week1 },
      { player_id: "1", week: 6, stats: week2 },
    ]);

    assert.deepEqual(out["1"].weeks, [5, 6]);
    assert.equal(out["1"].stats.rec, 6.36 + 5.11);
    assert.equal(out["1"].stats.rec_yd, 99.43 + 71.2);
  });

  test("keeps players apart and reports a partial horizon", () => {
    const out = aggregateWeeklyStats([
      { player_id: "1", week: 5, stats: week1 },
      { player_id: "2", week: 6, stats: week2 },
    ]);

    assert.deepEqual(Object.keys(out).sort(), ["1", "2"]);
    // A bye or an unpublished week leaves a player short of the horizon; that is
    // the signal a caller needs to tell "not projected" from "projected zero".
    assert.deepEqual(out["1"].weeks, [5]);
    assert.deepEqual(out["2"].weeks, [6]);
  });

  test("a week counts once even if the row appears twice", () => {
    const out = aggregateWeeklyStats([
      { player_id: "1", week: 5, stats: week1 },
      { player_id: "1", week: 5, stats: week1 },
    ]);

    assert.deepEqual(out["1"].weeks, [5]);
    assert.equal(out["1"].stats.rec, 6.36);
  });

  test("drops non-numeric and non-finite values instead of poisoning the sum", () => {
    const out = aggregateWeeklyStats([
      { player_id: "1", week: 5, stats: week1 },
      {
        player_id: "1",
        week: 6,
        stats: { rec: "3" as unknown as number, rec_yd: Number.NaN, rec_td: 0.5 },
      },
    ]);

    assert.equal(out["1"].stats.rec, 6.36);
    assert.equal(out["1"].stats.rec_yd, 99.43);
    assert.equal(out["1"].stats.rec_td, 0.67 + 0.5);
  });

  test("a missing or empty stat line still counts as a projected week", () => {
    const out = aggregateWeeklyStats([
      { player_id: "1", week: 5, stats: null },
      { player_id: "1", week: 6, stats: {} },
    ]);

    assert.deepEqual(out["1"].weeks, [5, 6]);
    assert.deepEqual(out["1"].stats, {});
  });

  test("no rows is an empty map, not a throw", () => {
    assert.deepEqual(aggregateWeeklyStats([]), {});
  });
});

describe("scoring the aggregate", () => {
  test("summing then scoring equals scoring then summing", () => {
    const out = aggregateWeeklyStats([
      { player_id: "1", week: 5, stats: week1 },
      { player_id: "1", week: 6, stats: week2 },
    ]);

    const perWeek = scoreStatLine(week1, tePremium) + scoreStatLine(week2, tePremium);
    const aggregate = scoreStatLine(out["1"].stats, tePremium);

    // Equal to the cent: both sides round to two decimals, and the aggregate does
    // it once, so anything beyond a cent apart means the dot product isn't linear.
    assert.ok(
      Math.abs(perWeek - aggregate) <= 0.01,
      `per-week ${perWeek} vs aggregate ${aggregate}`,
    );
  });
});
