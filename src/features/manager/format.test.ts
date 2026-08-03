import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  countdownSegments,
  formatCountdown,
  formatPoints,
  formatRecord,
  formatValue,
  formatWeekRange,
  formatWinPct,
  shortPlayerName,
} from "./format.ts";

describe("formatRecord", () => {
  test("omits ties when there are none", () => {
    assert.equal(formatRecord({ wins: 9, losses: 4, ties: 0 }), "9-4");
  });

  test("includes ties when there are any", () => {
    assert.equal(formatRecord({ wins: 9, losses: 4, ties: 1 }), "9-4-1");
  });

  test("handles an unplayed season", () => {
    assert.equal(formatRecord({ wins: 0, losses: 0, ties: 0 }), "0-0");
  });
});

describe("formatWinPct", () => {
  test("drops the leading zero, as a standings page does", () => {
    assert.equal(formatWinPct(0.537), ".537");
    assert.equal(formatWinPct(0.5), ".500");
    assert.equal(formatWinPct(0), ".000");
  });

  test("keeps the leading digit of a perfect record", () => {
    assert.equal(formatWinPct(1), "1.000");
  });

  test("shows nothing played as an em dash, not as zero", () => {
    assert.equal(formatWinPct(null), "—");
  });
});

describe("formatCountdown", () => {
  test("reads in days with the trailing units padded in place", () => {
    const ms = ((37 * 24 + 4) * 3600 + 12 * 60 + 45) * 1000;
    assert.equal(formatCountdown(ms), "37d 04h 12m 45s");
  });

  test("drops units the countdown has outgrown", () => {
    assert.equal(formatCountdown((4 * 3600 + 9 * 60) * 1000), "4h 09m 00s");
    assert.equal(formatCountdown((12 * 60 + 3) * 1000), "12m 03s");
    assert.equal(formatCountdown(41 * 1000), "41s");
  });

  test("an instant already passed clamps to zero rather than negative", () => {
    assert.equal(formatCountdown(0), "0s");
    assert.equal(formatCountdown(-5000), "0s");
  });

  test("floors a partial second so the last tick reads 0s, not 1s", () => {
    assert.equal(formatCountdown(999), "0s");
  });
});

describe("countdownSegments", () => {
  const digits = (ms: number) =>
    countdownSegments(ms).map((s) => `${s.value}${s.short}`);

  test("gives each unit its own cell, padded after the leading one", () => {
    const ms = ((37 * 24 + 4) * 3600 + 12 * 60 + 45) * 1000;
    assert.deepEqual(digits(ms), ["37d", "04h", "12m", "45s"]);
  });

  test("drops units the countdown has outgrown, so the row narrows", () => {
    assert.deepEqual(digits((4 * 3600 + 9 * 60) * 1000), ["4h", "09m", "00s"]);
    assert.deepEqual(digits((12 * 60 + 3) * 1000), ["12m", "03s"]);
    assert.deepEqual(digits(41 * 1000), ["41s"]);
  });

  test("keeps the seconds cell when everything is zero, rather than none", () => {
    assert.deepEqual(digits(0), ["0s"]);
    assert.deepEqual(digits(-5000), ["0s"]);
  });

  test("carries a spelled unit for the label under each cell", () => {
    assert.deepEqual(
      countdownSegments(90_000).map((s) => s.unit),
      ["min", "sec"],
    );
  });

  test("is the same reading the accessible string gives", () => {
    const ms = ((37 * 24 + 4) * 3600 + 12 * 60 + 45) * 1000;
    assert.equal(digits(ms).join(" "), formatCountdown(ms));
  });
});

describe("formatPoints", () => {
  test("always shows two decimals so columns stay aligned", () => {
    assert.equal(formatPoints(1234.5), "1,234.50");
    assert.equal(formatPoints(0), "0.00");
  });

  test("rounds to two decimals", () => {
    assert.equal(formatPoints(99.999), "100.00");
  });
});

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
