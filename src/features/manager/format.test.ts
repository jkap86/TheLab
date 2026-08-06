import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatValue,
  formatWeekRange,
  shortPlayerName,
  weekCount,
} from "./format.ts";

describe("formatValue", () => {
  test("groups thousands and drops the decimals points keep", () => {
    assert.equal(formatValue(41320), "41,320");
    assert.equal(formatValue(0), "0");
  });
});

describe("formatWeekRange", () => {
  test("collapses consecutive weeks into a range", () => {
    assert.equal(formatWeekRange([3, 4, 5]), "Wk 3–5");
  });

  test("names a single week without a range", () => {
    assert.equal(formatWeekRange([3]), "Wk 3");
  });

  test("keeps a gap visible rather than spanning it", () => {
    // A missing week in the middle is a hole in the total, not a shorter horizon.
    assert.equal(formatWeekRange([1, 3]), "Wk 1, 3");
    assert.equal(formatWeekRange([1, 2, 5, 6]), "Wk 1–2, 5–6");
  });

  test("sorts before ranging", () => {
    assert.equal(formatWeekRange([5, 3, 4]), "Wk 3–5");
  });

  test("says so when there are no weeks at all", () => {
    assert.equal(formatWeekRange([]), "no weeks");
  });
});

describe("shortPlayerName", () => {
  test("contracts the first name to an initial", () => {
    assert.equal(shortPlayerName("Christian McCaffrey", "RB"), "C. McCaffrey");
    assert.equal(shortPlayerName("Bijan Robinson", "RB"), "B. Robinson");
  });

  test("keeps everything after the first name, suffixes included", () => {
    // The identifying part is the surname and whatever qualifies it — dropping
    // the `Jr.` would merge a father and son who are both in the player pool.
    assert.equal(shortPlayerName("Michael Pittman Jr.", "WR"), "M. Pittman Jr.");
    assert.equal(shortPlayerName("Amon-Ra St. Brown", "WR"), "A. St. Brown");
    assert.equal(
      shortPlayerName("Jeremiah Owusu-Koramoah", "LB"),
      "J. Owusu-Koramoah",
    );
  });

  test("leaves a team defence whole", () => {
    // `Pittsburgh Steelers` is the team's name, not a person's — `P. Steelers`
    // is nothing.
    assert.equal(
      shortPlayerName("Pittsburgh Steelers", "DEF"),
      "Pittsburgh Steelers",
    );
  });

  test("returns a name with no first name as it came", () => {
    // The unfilled-slot placeholder and an unresolved player id both land here.
    assert.equal(shortPlayerName("Empty", null), "Empty");
    assert.equal(shortPlayerName("4034", null), "4034");
    assert.equal(shortPlayerName("", "RB"), "");
  });

  test("does not treat a leading space as a first name", () => {
    assert.equal(shortPlayerName(" McCaffrey", "RB"), " McCaffrey");
  });
});

describe("weekCount", () => {
  test("spells the count out, singular where it is one", () => {
    // For a tooltip, where the horizon is written in words beside the number it
    // qualifies rather than as the `Wk 3–5` the column heading uses.
    assert.equal(weekCount(1), "1 week");
    assert.equal(weekCount(3), "3 weeks");
    assert.equal(weekCount(18), "18 weeks");
  });

  test("no weeks is plural, since it is not one", () => {
    // The offseason case, and the one an `n > 1` test would get right by
    // accident — a projection covering nothing reads as "0 weeks".
    assert.equal(weekCount(0), "0 weeks");
  });
});
