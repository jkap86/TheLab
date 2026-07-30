import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_TEAM_COLUMNS,
  TEAM_METRICS,
  TEAM_METRICS_BY_KEY,
  type TeamMetricContext,
} from "./standings-metrics.ts";
import type { LeagueTeamView, TeamOutlook } from "./types.ts";

const team = {
  roster_id: 1,
  owner_id: "u1",
  manager: null,
  record: { wins: 9, losses: 4, ties: 0 },
  fpts: 1234.56,
  fpts_against: 1100,
  players: [],
  starters: [],
  reserve: [],
  taxi: [],
  picks: [],
} as unknown as LeagueTeamView;

const outlook = {
  roster_id: 1,
  weekly_optimal_points: 1875.4,
  weekly_bench_points: 512.3,
  optimal_points: 1790.25,
  weekly_split: {},
} as unknown as TeamOutlook;

const ctx = (over: Partial<TeamMetricContext> = {}): TeamMetricContext => ({
  team,
  outlook,
  ...over,
});

const cell = (key: string, over: Partial<TeamMetricContext> = {}) =>
  TEAM_METRICS_BY_KEY[key].cell(ctx(over));

describe("team metric catalogue", () => {
  test("every default column names a real metric", () => {
    for (const key of DEFAULT_TEAM_COLUMNS) {
      assert.ok(TEAM_METRICS_BY_KEY[key], `unknown default column ${key}`);
    }
  });

  test("keys are unique", () => {
    const keys = TEAM_METRICS.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("projection metrics", () => {
  test("proj reads the weekly optimal total", () => {
    assert.equal(cell("proj").text, "1,875.40");
  });

  test("bench reads what those lineups leave behind", () => {
    assert.equal(cell("bench").text, "512.30");
  });

  test("optimal reads the season-long lineup total, not the weekly one", () => {
    assert.equal(cell("optimal").text, "1,790.25");
  });

  test("are an em dash, not a zero, when the league has no outlook", () => {
    for (const key of ["proj", "bench", "optimal"]) {
      assert.equal(cell(key, { outlook: null }).text, null, key);
    }
  });
});

describe("points-for metric", () => {
  test("reads the team's actual points, with or without an outlook", () => {
    assert.equal(cell("pf").text, "1,234.56");
    assert.equal(cell("pf", { outlook: null }).text, "1,234.56");
  });
});
