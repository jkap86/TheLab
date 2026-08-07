import assert from "node:assert/strict";
import { test } from "node:test";

import type { StatRow } from "./parse.ts";
import {
  STATS_MAX_SHRINK,
  STATS_MIN_SETTLED_ROWS,
  validateWeekStats,
} from "./validate.ts";

function rows(count: number, from = 0): StatRow[] {
  return Array.from({ length: count }, (_, i) => ({
    season: "2026",
    week: 5,
    player_id: String(from + i + 1),
    company: "rotowire",
    team: "BUF",
    opponent: "MIA",
    game_id: "g1",
    game_date: "2026-10-04",
    pts_std: null,
    pts_half_ppr: null,
    pts_ppr: null,
    stats: { gp: 1 },
    source_updated_at: null,
  }));
}

const settled = { settled: true };
const live = { settled: false };

test("a full settled week passes on a first sync", () => {
  const result = validateWeekStats(rows(600), 0, settled);
  assert.equal(result.ok, true);
});

test("a fragment of a settled week is refused", () => {
  const result = validateWeekStats(rows(STATS_MIN_SETTLED_ROWS - 1), 0, settled);
  assert.equal(result.ok, false);
});

test("a live week is exempt from the floor — Thursday night is one game", () => {
  // The difference from the projections gate, and the reason it exists: a stats
  // week fills in over five days, so ~60 lines on a Thursday is correct and
  // complete-so-far, not a truncated response.
  const result = validateWeekStats(rows(60), 0, live);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.rows.length, 60);
});

test("a live week is still guarded against shrinking", () => {
  // Rows never legitimately leave a week in progress, so a fall against what is
  // stored is a bad response — this is the only guard the live tier has.
  const result = validateWeekStats(rows(300), 800, live);
  assert.equal(result.ok, false);
  assert.equal(
    result.ok === false && result.reason.includes("below the 800 stored"),
    true,
  );
});

test("growth through a live week is never a shrink", () => {
  assert.equal(validateWeekStats(rows(800), 60, live).ok, true);
});

test("a payload just inside the shrink bound passes", () => {
  const previous = 800;
  const allowed = Math.ceil(previous * (1 - STATS_MAX_SHRINK));
  assert.equal(validateWeekStats(rows(allowed), previous, settled).ok, true);
});

test("zero stored is a first sync, so only the floor applies", () => {
  // What lets a cold database backfill a season without the guard being turned
  // off — there is nothing to shrink against.
  assert.equal(validateWeekStats(rows(250), 0, settled).ok, true);
});

test("a duplicated player id refuses the whole week", () => {
  const duplicated = [...rows(400), ...rows(1)];
  const result = validateWeekStats(duplicated, 0, settled);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason.includes("duplicate"), true);
});

test("a row with no game or no stat line is dropped, not stored", () => {
  const good = rows(400);
  const bad: StatRow[] = [
    { ...rows(1, 900)[0], game_id: "" },
    { ...rows(1, 901)[0], stats: {} },
    { ...rows(1, 902)[0], player_id: "  " },
  ];

  const result = validateWeekStats([...good, ...bad], 0, settled);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.rows.length, 400);
  assert.equal(result.ok && result.rejected, 3);
});
