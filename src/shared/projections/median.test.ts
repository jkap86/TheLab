import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { medianLineups, medianScore } from "./median.ts";

describe("medianScore", () => {
  test("an even population averages the two middle scores", () => {
    // The rule the whole feature rests on: taking either middle instead would
    // hand a twelve-team league seven wins and five losses every week.
    assert.equal(medianScore([100, 110, 120, 130]), 115);
  });

  test("an odd population is the middle score itself", () => {
    assert.equal(medianScore([100, 110, 130]), 110);
  });

  test("the answer need not be anybody's score", () => {
    // A manager can lose to a median nobody posted, which is what Sleeper does.
    const median = medianScore([90, 100]);
    assert.equal(median, 95);
  });

  test("the order it arrives in does not matter", () => {
    assert.equal(medianScore([130, 100, 120, 110]), 115);
  });

  test("it does not sort the caller's array", () => {
    // The caller reads the same array again — sorting it under them is the
    // in-place edit a shared answer must never make.
    const scores = [130, 100, 120, 110];
    medianScore(scores);
    assert.deepEqual(scores, [130, 100, 120, 110]);
  });

  test("one score is no median, and neither is none", () => {
    // Its own middle, so every such league would tie against itself — a result
    // invented out of a league the crawler has only half-stored.
    assert.equal(medianScore([100]), null);
    assert.equal(medianScore([]), null);
  });

  test("zeros are real scores, not missing ones", () => {
    // An undrafted league projects nothing and its median is nothing, which is
    // a median rather than an absence.
    assert.equal(medianScore([0, 0, 0, 0]), 0);
  });

  test("it sorts numerically, not as text", () => {
    // The trap in a bare `.sort()`: 9 sorts after 100 as a string, which puts
    // the middle in the wrong place on any league scoring into three digits.
    assert.equal(medianScore([9, 100, 120, 9]), 54.5);
  });
});

describe("medianLineups", () => {
  const team = (optimal: number, current: number) => ({ optimal, current });

  test("folds both readings of the same week", () => {
    assert.deepEqual(
      medianLineups([
        team(130, 120),
        team(120, 118),
        team(110, 100),
        team(100, 90),
      ]),
      { optimal: 115, current: 109 },
    );
  });

  test("the two are taken independently and may name different teams", () => {
    // Correct rather than an artefact: the team in the middle of the league by
    // best lineup need not be the one in the middle by what it has set. Here
    // the optimal middle is the second team's 120 and the current middle is the
    // *third* team's 105 — so ranking on one reading would report the other
    // one's number off the wrong roster.
    assert.deepEqual(
      medianLineups([team(200, 100), team(120, 190), team(110, 105)]),
      { optimal: 120, current: 105 },
    );
  });

  test("one reading is never derived from the other", () => {
    // A median is not linear, so `optimal` cannot be reached by adding anything
    // league-wide to `current`. The three gaps here are 0, 40 and 0 — their own
    // median is 0 — while the two medians are 40 apart. Whichever the caller
    // needs has to be folded, not adjusted.
    const teams = [team(100, 100), team(140, 100), team(160, 160)];

    assert.deepEqual(medianLineups(teams), { optimal: 140, current: 100 });
    assert.equal(medianScore(teams.map((t) => t.optimal - t.current)), 0);
  });

  test("fewer than two teams has no median, in either reading", () => {
    assert.equal(medianLineups([team(120, 110)]), null);
    assert.equal(medianLineups([]), null);
  });

  test("a week that has one reading has both", () => {
    // The refusal is the same condition for each half — fewer than two teams —
    // so a caller never has to draw half a bar.
    const median = medianLineups([team(120, 110), team(100, 90)]);
    assert.ok(median !== null && median.optimal !== null && median.current !== null);
  });
});
