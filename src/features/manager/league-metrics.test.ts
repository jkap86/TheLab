import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_COLUMNS,
  LEAGUE_COLUMN_PRESETS,
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
  superflex: true,
  board: "dynasty",
  rostered: 16,
  redraft: {
    total: 21800,
    priced: 11,
    split: { starters: 17400, bench: 4400 },
    draft_count: 512,
    starters_rank: { rank: 9, of: 12 },
  },
  dynasty: {
    total: 38400,
    priced: 14,
    split: { starters: 26100, bench: 12300 },
    draft_count: 37,
    starters_rank: { rank: 5, of: 12 },
  },
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

  test("every preset column names a real metric", () => {
    for (const preset of LEAGUE_COLUMN_PRESETS) {
      for (const key of preset.columns) {
        assert.ok(
          LEAGUE_METRICS_BY_KEY[key],
          `unknown column ${key} in preset ${preset.name}`,
        );
      }
    }
  });

  test("keys are unique", () => {
    const keys = LEAGUE_METRICS.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("rank metrics", () => {
  test("read the rank and place it", () => {
    const points = cell("points");
    assert.equal(points.kind, "rank");
    assert.deepEqual(points.kind === "rank" && points.rank, {
      rank: 5,
      of: 12,
      pointsFor: 1234.56,
    });
  });

  test("are null, not a rank of nothing, before the data lands", () => {
    const points = cell("points", { ranks: null });
    assert.equal(points.kind === "rank" && points.rank, null);
    assert.equal(metricPreview(points), "—");
  });

  // The standing is the card's record line, not a column — a slot pointed at it
  // would restate the line above the columns.
  test("the standing is not offered as a column", () => {
    assert.equal(LEAGUE_METRICS_BY_KEY["standing"], undefined);
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

  test("ADP value prints the whole priced total, per board", () => {
    const dynasty = cell("adp_total_dynasty");
    const redraft = cell("adp_total_redraft");
    assert.equal(dynasty.kind === "value" && dynasty.text, "38,400");
    assert.equal(redraft.kind === "value" && redraft.text, "21,800");
  });

  test("ADP value is an em dash when nothing on the roster is priced", () => {
    const total = cell("adp_total_redraft", {
      adp: {
        ...adp,
        redraft: { ...adp.redraft, total: 0, priced: 0, split: null },
      },
    });
    assert.equal(total.kind === "value" && total.text, null);
    assert.equal(metricPreview(total), "—");
  });
});

describe("ADP market metrics", () => {
  // The whole point of the split: one column per market, so a column scanned
  // down a list of dynasty and redraft leagues is one market's numbers.
  test("the two markets are separate columns and read separate boards", () => {
    for (const key of [
      "adp_total_redraft",
      "adp_total_dynasty",
      "adp_rank_redraft",
      "adp_rank_dynasty",
    ]) {
      assert.ok(LEAGUE_METRICS_BY_KEY[key], `missing ADP metric ${key}`);
    }
    // The pooled columns they replaced are gone, so a stored selection naming
    // one falls back per slot rather than reading a market it can't name.
    assert.equal(LEAGUE_METRICS_BY_KEY["adp_total"], undefined);
    assert.equal(LEAGUE_METRICS_BY_KEY["adp_rank"], undefined);
  });

  test("a rank places the roster by its starter value on that board", () => {
    const dynasty = cell("adp_rank_dynasty");
    assert.equal(dynasty.kind, "rank");
    assert.equal(dynasty.kind === "rank" && dynasty.rank?.rank, 5);
    assert.equal(metricPreview(dynasty), "#5");

    const redraft = cell("adp_rank_redraft");
    assert.equal(redraft.kind === "rank" && redraft.rank?.rank, 9);
  });

  test("both markets answer for a league that plays in only one of them", () => {
    // A dynasty league's redraft value is what a win-now market would pay for
    // the same players — a comparison, not a mistake, so it is never blanked.
    assert.equal(adp.board, "dynasty");
    const redraft = cell("adp_total_redraft");
    assert.equal(redraft.kind === "value" && redraft.text, "21,800");
    assert.match(redraft.title, /this league is a dynasty league/);
  });

  test("the native column doesn't say which market the league is in", () => {
    // It is the column's own market, so the line would be restating the heading.
    assert.doesNotMatch(cell("adp_total_dynasty").title, /this league is a/);
  });

  test("a board with no drafts behind it says so rather than reading as zero", () => {
    const empty = cell("adp_total_redraft", {
      adp: {
        ...adp,
        redraft: {
          total: 0,
          priced: 0,
          split: null,
          draft_count: 0,
          starters_rank: null,
        },
      },
    });
    assert.equal(empty.kind === "value" && empty.text, null);
    assert.match(empty.title, /0 crawled drafts/);
  });

  test("are null before the ADP values land", () => {
    const rank = cell("adp_rank_dynasty", { adp: null });
    const total = cell("adp_total_redraft", { adp: null });
    assert.equal(rank.kind === "rank" && rank.rank, null);
    assert.equal(total.kind === "value" && total.text, null);
  });
});
