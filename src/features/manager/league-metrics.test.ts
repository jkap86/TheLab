import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_COLUMNS,
  LEAGUE_METRICS,
  LEAGUE_METRICS_BY_KEY,
  type MetricContext,
} from "./league-metrics.ts";
import { metricPreview } from "./metric-cell.ts";
import type {
  LeagueAdpEntry,
  LeagueKtcEntry,
  LeagueRankSet,
  ManagerLeague,
} from "./types.ts";

const league: ManagerLeague = {
  league_id: "a",
  name: "League a",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: { wins: 9, losses: 4, ties: 0 },
  settings: null,
  roster_positions: null,
  scoring_settings: null,
};

const ranks: LeagueRankSet = {
  standing: { rank: 3, of: 12 },
  points: { rank: 5, of: 12, pointsFor: 1234.56 },
  proj: { rank: 2, of: 12, points: 1875.4 },
  proj_bench: { rank: 7, of: 12, points: 512.3 },
};

const ktc: LeagueKtcEntry = {
  total: 41320,
  priced: 15,
  rostered: 16,
  split: { starters: 28900, bench: 12420 },
  superflex: true,
  starters_rank: { rank: 4, of: 12 },
};

const adp: LeagueAdpEntry = {
  total: 38400,
  priced: 14,
  rostered: 16,
  split: { starters: 26100, bench: 12300 },
  superflex: true,
  league_type: "dynasty",
  draft_count: 37,
  starters_rank: { rank: 5, of: 12 },
};

const ctx = (over: Partial<MetricContext> = {}): MetricContext => ({
  league,
  ranks,
  ktc,
  adp,
  weeks: [3, 4, 5],
  valuedAt: null,
  ...over,
});

const cell = (key: string, over: Partial<MetricContext> = {}) =>
  LEAGUE_METRICS_BY_KEY[key].cell(ctx(over));

describe("league metric catalogue", () => {
  test("every default column names a real metric", () => {
    for (const key of DEFAULT_COLUMNS) {
      assert.ok(LEAGUE_METRICS_BY_KEY[key], `unknown default column ${key}`);
    }
  });

  test("keys are unique", () => {
    const keys = LEAGUE_METRICS.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("rank metrics", () => {
  test("read the rank and place it", () => {
    const standing = cell("standing");
    assert.equal(standing.kind, "rank");
    assert.deepEqual(standing.kind === "rank" && standing.rank, {
      rank: 3,
      of: 12,
    });
  });

  test("are null, not a rank of nothing, before the data lands", () => {
    const standing = cell("standing", { ranks: null });
    assert.equal(standing.kind === "rank" && standing.rank, null);
    assert.equal(metricPreview(standing), "—");
  });

  test("projected bench ranks a roster by its depth", () => {
    const bench = cell("proj_bench");
    assert.equal(bench.kind, "rank");
    assert.equal(bench.kind === "rank" && bench.rank?.rank, 7);
    assert.equal(bench.kind === "rank" && bench.rank?.of, 12);
    assert.equal(metricPreview(bench), "#7");
  });

  test("projected bench is null before the projections land", () => {
    const bench = cell("proj_bench", { ranks: null });
    assert.equal(bench.kind === "rank" && bench.rank, null);
  });
});

describe("value metrics", () => {
  test("KTC bench prints the bench half of the split", () => {
    const bench = cell("ktc_bench");
    assert.equal(bench.kind, "value");
    assert.equal(bench.kind === "value" && bench.text, "12,420");
    assert.equal(metricPreview(bench), "12,420");
  });

  test("KTC total prints the whole priced value", () => {
    const total = cell("ktc_total");
    assert.equal(total.kind === "value" && total.text, "41,320");
  });

  test("points-for prints the season total behind the points rank", () => {
    const pf = cell("points_for");
    assert.equal(pf.kind === "value" && pf.text, "1,234.56");
  });

  test("projected bench points print the total behind the bench rank", () => {
    const pts = cell("proj_bench_pts");
    assert.equal(pts.kind, "value");
    assert.equal(pts.kind === "value" && pts.text, "512.30");
    assert.equal(metricPreview(pts), "512.30");
  });

  test("projected bench points are absent, not zero, before the data lands", () => {
    const pts = cell("proj_bench_pts", { ranks: null });
    assert.equal(pts.kind === "value" && pts.text, null);
    assert.equal(metricPreview(pts), "—");
  });

  test("KTC bench has no answer when the roster can't be split", () => {
    const bench = cell("ktc_bench", {
      ktc: { ...ktc, split: null },
    });
    assert.equal(bench.kind === "value" && bench.text, null);
    assert.equal(metricPreview(bench), "—");
  });

  test("KTC total is an em dash for an unpriced roster, not a zero", () => {
    const total = cell("ktc_total", {
      ktc: { ...ktc, total: 0, priced: 0, split: null },
    });
    assert.equal(total.kind === "value" && total.text, null);
  });

  test("ADP value prints the whole priced total", () => {
    const total = cell("adp_total");
    assert.equal(total.kind === "value" && total.text, "38,400");
  });

  test("ADP value is an em dash when nothing on the roster is priced", () => {
    const total = cell("adp_total", {
      adp: { ...adp, total: 0, priced: 0, split: null },
    });
    assert.equal(total.kind === "value" && total.text, null);
    assert.equal(metricPreview(total), "—");
  });
});

describe("ADP rank metric", () => {
  test("places the roster by its starter value", () => {
    const rank = cell("adp_rank");
    assert.equal(rank.kind, "rank");
    assert.equal(rank.kind === "rank" && rank.rank?.rank, 5);
    assert.equal(metricPreview(rank), "#5");
  });

  test("is null before the ADP values land", () => {
    const rank = cell("adp_rank", { adp: null });
    assert.equal(rank.kind === "rank" && rank.rank, null);
  });
});
