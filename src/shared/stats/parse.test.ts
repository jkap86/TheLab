import assert from "node:assert/strict";
import { test } from "node:test";

import type { SleeperProjection } from "@/shared/sleeper";

import { hasStatLine, toStatRows } from "./parse.ts";

function entry(over: Partial<SleeperProjection> = {}): SleeperProjection {
  return {
    player_id: "4034",
    season: "2026",
    week: 5,
    season_type: "regular",
    category: "stat",
    company: null,
    team: "BUF",
    opponent: "MIA",
    game_id: "2026-10-04-MIA-BUF",
    date: "2026-10-04",
    last_modified: 1_760_000_000_000,
    stats: { gp: 1, rush_yd: 100, rush_td: 1 },
    player: null,
    ...over,
  };
}

test("a placeholder carrying only ADP keys is not a stat line", () => {
  assert.equal(
    hasStatLine(entry({ game_id: null, stats: { adp_dd_ppr: 42 } })),
    false,
  );
  assert.equal(hasStatLine(entry({ stats: { adp_dd_ppr: 42 } })), false);
  assert.equal(hasStatLine(entry({ stats: null })), false);
  assert.equal(hasStatLine(entry({ game_id: null })), false);
});

test("a player who dressed and did nothing still has a line", () => {
  // The distinction the whole points-per-game denominator rests on: `gp` alone
  // is a game played and scored nothing, which is not the same as not playing.
  assert.equal(hasStatLine(entry({ stats: { gp: 1 } })), true);
});

test("season and week come from the caller, never from the payload", () => {
  // Sleeper echoes an unknown week back verbatim rather than erroring, so
  // trusting the body files junk under a week that looks real.
  const [row] = toStatRows([entry({ season: "1999", week: 99 })], "2026", 5);

  assert.equal(row.season, "2026");
  assert.equal(row.week, 5);
});

test("a revised line wins over the one it corrects", () => {
  const original = entry({
    last_modified: 1_000,
    stats: { gp: 1, rush_yd: 80 },
  });
  const corrected = entry({
    last_modified: 2_000,
    stats: { gp: 1, rush_yd: 100 },
  });

  assert.equal(toStatRows([original, corrected], "2026", 5)[0].stats.rush_yd, 100);
  // Either order — a correction is exactly a second entry for a player already
  // in the response, and two rows would collide on the primary key mid-INSERT.
  assert.equal(toStatRows([corrected, original], "2026", 5)[0].stats.rush_yd, 100);
  assert.equal(toStatRows([corrected, original], "2026", 5).length, 1);
});

test("the promoted points columns are read off the stat line", () => {
  const [row] = toStatRows(
    [entry({ stats: { gp: 1, pts_ppr: 24.5, pts_std: 18.5 } })],
    "2026",
    5,
  );

  assert.equal(row.pts_ppr, 24.5);
  assert.equal(row.pts_std, 18.5);
  assert.equal(row.pts_half_ppr, null);
});

test("placeholders are dropped rather than stored as rows of nulls", () => {
  const rows = toStatRows(
    [entry(), entry({ player_id: "9999", game_id: null, stats: null })],
    "2026",
    5,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_id, "4034");
});
