import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  clampWeek,
  currentWeek,
  isPlausibleWeek,
  LAST_REGULAR_WEEK,
  parseRequestedWeek,
  restOfSeasonStart,
  seasonToDateThrough,
  stateWeek,
} from "./weeks.ts";

/** A state as Sleeper publishes one. `leg` and `display_week` may disagree. */
const state = (fields: {
  season?: string;
  week?: number;
  leg?: number | null;
  display_week?: number;
}) => ({
  season: "2026",
  week: 1,
  leg: 1,
  display_week: 1,
  ...fields,
});

describe("isPlausibleWeek", () => {
  test("accepts the whole regular season and nothing either side", () => {
    assert.equal(isPlausibleWeek(1), true);
    assert.equal(isPlausibleWeek(LAST_REGULAR_WEEK), true);
    assert.equal(isPlausibleWeek(0), false);
    assert.equal(isPlausibleWeek(LAST_REGULAR_WEEK + 1), false);
  });

  test("a week is a whole number", () => {
    assert.equal(isPlausibleWeek(7.5), false);
    assert.equal(isPlausibleWeek(NaN), false);
    assert.equal(isPlausibleWeek(Infinity), false);
  });
});

describe("parseRequestedWeek", () => {
  test("an absent parameter is null — 'not asked', not an error", () => {
    // The only state a caller may fill from a resolver. Everything else is an
    // answer the caller gave.
    assert.equal(parseRequestedWeek(null), null);
  });

  test("a blank parameter is also 'not asked'", () => {
    // `?week=` is a URL builder's artefact rather than anybody's question.
    assert.equal(parseRequestedWeek(""), null);
    assert.equal(parseRequestedWeek("   "), null);
  });

  test("a week reads back as itself", () => {
    assert.deepEqual(parseRequestedWeek("7"), { ok: true, week: 7 });
    assert.deepEqual(parseRequestedWeek(" 18 "), { ok: true, week: 18 });
  });

  test("a non-numeric week is refused, never folded to a default", () => {
    // The whole reason this returns three states: `?week=abc` quietly becoming
    // the current week shows one week's lineup under another week's heading.
    const parsed = parseRequestedWeek("abc");
    assert.equal(parsed?.ok, false);
  });

  test("weeks outside the regular season are refused", () => {
    assert.equal(parseRequestedWeek("0")?.ok, false);
    assert.equal(parseRequestedWeek("19")?.ok, false);
    assert.equal(parseRequestedWeek("-3")?.ok, false);
    assert.equal(parseRequestedWeek("7.5")?.ok, false);
  });
});

describe("clampWeek", () => {
  test("the preseason's week 0 becomes week 1", () => {
    // Sleeper's state answers 0 before the season; the season ahead is whole.
    assert.equal(clampWeek(0), 1);
  });

  test("the postseason folds back to the last regular week", () => {
    assert.equal(clampWeek(22), LAST_REGULAR_WEEK);
  });

  test("an unreadable week is the widest honest answer", () => {
    assert.equal(clampWeek(NaN), 1);
  });
});

describe("stateWeek", () => {
  test("`leg` is the week, not `week` and not `display_week`", () => {
    // The Tuesday this was written for: week 1's games are played, the week
    // being prepared for is 2, and Sleeper's UI hint still reads 1.
    assert.equal(stateWeek(state({ leg: 2, week: 2, display_week: 1 })), 2);
  });

  test("a preseason `week` cannot stand in for it", () => {
    // `week` counts the *season type's* weeks, so in August it names a
    // regular-season week that has not been played.
    assert.equal(stateWeek(state({ leg: 0, week: 3, display_week: 1 })), 0);
  });

  test("a `leg` of 0 is an answer, never a fall-through", () => {
    // The offseason says the season ahead is whole; every caller clamps that
    // to week 1. Read as absent it would answer `week` instead.
    assert.equal(stateWeek(state({ leg: 0, week: 17 })), 0);
  });

  test("a state carrying no `leg` degrades to `week`", () => {
    // A hand-built stub, or a Sleeper that stopped sending it. `display_week`
    // is deliberately not in the ladder — it is the reading that was wrong.
    assert.equal(stateWeek(state({ leg: undefined, week: 6, display_week: 9 })), 6);
    assert.equal(stateWeek(state({ leg: null, week: 6, display_week: 9 })), 6);
  });
});

describe("currentWeek", () => {
  const read = (value: ReturnType<typeof state> | null) => async () => value;

  test("answers the season's `leg`", async () => {
    assert.equal(
      await currentWeek("2026", read(state({ leg: 2, week: 2, display_week: 1 }))),
      2,
    );
  });

  test("the preseason is week 1, not the preseason's own week", async () => {
    assert.equal(await currentWeek("2026", read(state({ leg: 0, week: 3 }))), 1);
  });

  test("the postseason folds back to the last regular week", async () => {
    assert.equal(
      await currentWeek("2026", read(state({ leg: 21, week: 3 }))),
      LAST_REGULAR_WEEK,
    );
  });

  test("a season Sleeper has moved past has no week left", async () => {
    assert.equal(await currentWeek("2024", read(state({ season: "2026", leg: 2 }))), null);
  });

  test("a season ahead of Sleeper's is the widest honest window", async () => {
    assert.equal(await currentWeek("2027", read(state({ season: "2026", leg: 2 }))), 1);
  });

  test("a state that could not be read falls back to week 1", async () => {
    // Invisible in week 1 and the whole of the bug from week 2 on, which is
    // what `holdLastGood` and `week:doctor` exist for.
    assert.equal(await currentWeek("2026", read(null)), 1);
    assert.equal(
      await currentWeek("2026", () => Promise.reject(new Error("upstream"))),
      1,
    );
  });
});

describe("restOfSeasonStart", () => {
  const read = (value: ReturnType<typeof state> | null) => async () => value;

  test("starts at the week being played, off the same field", async () => {
    // One field and one clamp with `currentWeek`, so a page's heading and the
    // span it prices cannot name two different weeks.
    assert.equal(
      await restOfSeasonStart("2026", read(state({ leg: 2, week: 2, display_week: 1 }))),
      2,
    );
  });

  test("the whole season is ahead in the preseason", async () => {
    assert.equal(await restOfSeasonStart("2026", read(state({ leg: 0, week: 3 }))), 1);
  });

  test("an older season has no rest of season at all", async () => {
    assert.equal(
      await restOfSeasonStart("2024", read(state({ season: "2026", leg: 2 }))),
      null,
    );
  });

  test("an unreadable state does not fail the page", async () => {
    assert.equal(await restOfSeasonStart("2026", read(null)), 1);
  });
});

describe("seasonToDateThrough", () => {
  const read = (value: ReturnType<typeof state> | null) => async () => value;

  test("runs through the week being played, off the same field", async () => {
    // The projections span starts where this one ends, so a page in week 10
    // reads ten weeks of stats and nine of projections rather than eighteen of
    // either. One field and one reading, so the two cannot name two weeks.
    assert.equal(
      await seasonToDateThrough("2026", read(state({ leg: 10, week: 10, display_week: 9 }))),
      10,
    );
  });

  test("a finished season answers its whole total, where its mirror answers nothing", async () => {
    // The inversion, and the point of the function: `restOfSeasonStart` reads
    // null for a past page — correctly, there is no rest — and the very same
    // season has a complete total, which this is the only lens that answers.
    const older = read(state({ season: "2026", leg: 2 }));
    assert.equal(await restOfSeasonStart("2024", older), null);
    assert.equal(await seasonToDateThrough("2024", older), LAST_REGULAR_WEEK);
  });

  test("a season ahead of Sleeper's has been played none of", async () => {
    // Null rather than the widest window: nothing has been scored in it, and
    // reading the span would be eighteen empty round trips to fold to nothing.
    assert.equal(
      await seasonToDateThrough("2027", read(state({ season: "2026", leg: 2 }))),
      null,
    );
  });

  test("a week of 0 takes the whole season rather than week 1", async () => {
    // Sleeper reports 0 both before a regular season starts and in the months
    // after one ends, and the two are not distinguishable from the field. Read
    // as week 1 the second would answer a finished season's total with its
    // opening Sunday, where the first costs only a set of empty reads.
    assert.equal(
      await seasonToDateThrough("2026", read(state({ leg: 0, week: 3 }))),
      LAST_REGULAR_WEEK,
    );
  });

  test("the postseason folds back to the last regular week", async () => {
    assert.equal(
      await seasonToDateThrough("2026", read(state({ leg: 21, week: 3 }))),
      LAST_REGULAR_WEEK,
    );
  });

  test("an unreadable state takes the widest honest window", async () => {
    // Its mirror answers week 1 for the same instinct: each names the widest
    // window its span can claim, and an unplayed week carries no stat line, so
    // reaching past the present folds to exactly what has been played.
    assert.equal(await seasonToDateThrough("2026", read(null)), LAST_REGULAR_WEEK);
    assert.equal(
      await seasonToDateThrough(
        "2026",
        () => Promise.reject(new Error("upstream")),
      ),
      LAST_REGULAR_WEEK,
    );
  });
});
