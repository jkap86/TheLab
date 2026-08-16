import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { medianScore } from "./median.ts";

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
