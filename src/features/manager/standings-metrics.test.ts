import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_TEAM_COLUMNS,
  rosterValueTotal,
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
  ktcTotal: 41320,
  adpTotal: 38400,
  superflex: true,
  draftCount: 37,
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

describe("roster value totals", () => {
  test("sum a roster's board values, deduped, unpriced ids skipped", () => {
    const values = { a: 100, b: 250, c: 400 };
    // `d` is unpriced and the duplicate `a` must not be counted twice.
    assert.equal(rosterValueTotal(["a", "b", "a", "d"], values), 350);
  });

  test("are null, not zero, when nothing on the roster is priced", () => {
    assert.equal(rosterValueTotal(["x", "0", ""], { a: 100 }), null);
  });
});

describe("value-total metrics", () => {
  test("KTC and ADP print the roster total, not a rank", () => {
    assert.equal(cell("ktc").text, "41,320");
    assert.equal(cell("adp").text, "38,400");
  });

  test("are an em dash when nothing on the roster is priced", () => {
    assert.equal(cell("ktc", { ktcTotal: null }).text, null);
    assert.equal(cell("adp", { adpTotal: null }).text, null);
  });
});
