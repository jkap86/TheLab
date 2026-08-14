import assert from "node:assert/strict";
import { test } from "node:test";

import { LAST_REGULAR_WEEK } from "../projections/weeks.ts";
import {
  archiveSeasons,
  liveWeeks,
  playedWeeks,
  previousSeason,
  settledWeeks,
} from "./weeks.ts";

const state = (week: number, season_type: string) => ({ week, season_type });

test("the preseason has played no regular-season weeks", () => {
  // The trap this gate exists for: Sleeper counts preseason weeks in `week`, so
  // reading it alone would claim regular weeks 1–3 were played and send the sync
  // after stat lines that cannot exist.
  assert.deepEqual(playedWeeks(state(3, "pre")), []);
  assert.deepEqual(playedWeeks(state(0, "off")), []);
  assert.deepEqual(playedWeeks(null), []);
});

test("the week being played is included, part-played as it is", () => {
  assert.deepEqual(playedWeeks(state(5, "regular")), [1, 2, 3, 4, 5]);
});

test("the playoffs clamp to the last regular week", () => {
  assert.deepEqual(playedWeeks(state(22, "post")).at(-1), LAST_REGULAR_WEEK);
  assert.equal(playedWeeks(state(22, "post")).length, LAST_REGULAR_WEEK);
});

test("the live window is the current week and the one still being corrected", () => {
  assert.deepEqual(liveWeeks(state(6, "regular")), [5, 6]);
});

test("the two tiers partition the played weeks, with no week in both", () => {
  const s = state(6, "regular");
  const live = liveWeeks(s);
  const settled = settledWeeks(s);

  assert.deepEqual([...live, ...settled].sort((a, b) => a - b), playedWeeks(s));
  assert.equal(live.some((w) => settled.includes(w)), false);
});

test("settled weeks run newest first, so a cold backfill fills recent form first", () => {
  assert.deepEqual(settledWeeks(state(6, "regular")), [4, 3, 2, 1]);
});

test("early in the season there is nothing settled to back off to", () => {
  assert.deepEqual(liveWeeks(state(1, "regular")), [1]);
  assert.deepEqual(settledWeeks(state(1, "regular")), []);
});

test("the previous season is the year before, and only when it is a year", () => {
  assert.equal(previousSeason("2026"), "2025");
  assert.equal(previousSeason("not-a-year"), null);
  assert.equal(previousSeason(""), null);
});

test("the archive starts behind the previous season and runs newest first", () => {
  // The previous season is its own tier (the PPG fallback, on the monthly
  // clock), so the archive must never overlap it — a week in two tiers is a
  // week gated by whichever TTL was asked about first.
  assert.deepEqual(archiveSeasons("2026", 3), ["2024", "2023", "2022"]);
  assert.ok(!archiveSeasons("2026", 5).includes(previousSeason("2026")!));
});

test("an empty or junk archive request is empty, never a throw", () => {
  assert.deepEqual(archiveSeasons("2026", 0), []);
  assert.deepEqual(archiveSeasons("not-a-year", 3), []);
});
