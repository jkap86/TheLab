import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectionRow } from "./parse.ts";
import {
  validateWeekProjections,
  PROJECTIONS_MIN_ROWS,
  PROJECTIONS_MAX_SHRINK,
} from "./validate.ts";

const row = (id: number, overrides: Partial<ProjectionRow> = {}): ProjectionRow => ({
  season: "2026",
  week: 1,
  player_id: String(id),
  company: "rotowire",
  team: "SF",
  opponent: "SEA",
  game_id: `2026-1-SF-SEA`,
  game_date: "2026-09-10",
  pts_std: 10,
  pts_half_ppr: 12,
  pts_ppr: 14,
  stats: { rec: 4, rec_yd: 55 },
  source_updated_at: null,
  ...overrides,
});

const week = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => row(from + i));

test("a complete week is accepted", () => {
  const result = validateWeekProjections(week(810), 800);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.rows.length, 810);
});

test("an empty payload is rejected without mutation", () => {
  const result = validateWeekProjections([], 800);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.valid, 0);
});

test("a small non-empty partial is rejected — the case that empties a week", () => {
  const result = validateWeekProjections(week(40), 800);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /below the .* minimum/);
  assert.equal(result.ok === false && result.previous, 800);
});

test("duplicate player ids are rejected", () => {
  const duplicated = [...week(400), row(1), row(2)];
  const result = validateWeekProjections(duplicated, 400);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /duplicate player id/);
});

test("a bye-week-sized change is accepted", () => {
  // Six teams idle is ~19% of the slate; that must not read as a partial payload.
  assert.equal(validateWeekProjections(week(650), 800).ok, true);
});

test("an excessive shrink is rejected even above the absolute minimum", () => {
  const shrunk = Math.floor(2000 * (1 - PROJECTIONS_MAX_SHRINK)) - 100;
  assert.ok(shrunk > PROJECTIONS_MIN_ROWS, "the floor must not be what rejects this");
  const result = validateWeekProjections(week(shrunk), 2000);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /below the 2000 stored/);
});

test("the first sync of a week has nothing to shrink against", () => {
  assert.equal(validateWeekProjections(week(PROJECTIONS_MIN_ROWS), 0).ok, true);
  assert.equal(validateWeekProjections(week(PROJECTIONS_MIN_ROWS - 1), 0).ok, false);
});

test("rows with no game, no player or an empty stat line are dropped as invalid", () => {
  const junk = [
    row(9001, { game_id: null }),
    row(9002, { player_id: "  " }),
    row(9003, { stats: {} }),
  ];
  const result = validateWeekProjections([...week(400), ...junk], 400);
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.rows.length, 400);
  assert.equal(result.ok === true && result.rejected, 3);
});
