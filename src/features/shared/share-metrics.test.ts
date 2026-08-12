import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { metricPreview } from "./metric-cell.ts";
import {
  DEFAULT_LEAGUEMATE_COLUMNS,
  DEFAULT_PLAYER_COLUMNS,
  LEAGUEMATE_SHARE_METRICS,
  PLAYER_SHARE_METRICS,
  type ShareMetricContext,
} from "./share-metrics.ts";
import type { AdpPlayerPayload } from "@/shared/contract";
import type { ManagerLeague } from "@/shared/manager";

/** A league with the settings a metric reads, and nothing it doesn't. */
function league(
  id: string,
  extra: Partial<ManagerLeague> = {},
): ManagerLeague {
  return {
    league_id: id,
    name: `League ${id}`,
    season: "2026",
    status: "in_season",
    total_rosters: 12,
    avatar: null,
    record: { wins: 6, losses: 4, ties: 0 },
    settings: null,
    roster_positions: null,
    scoring_settings: null,
    ...extra,
  };
}

const adp: AdpPlayerPayload = {
  player_id: "4046",
  name: "Patrick Mahomes",
  position: "QB",
  team: "KC",
  rookie: false,
  redraft: { adp: 34.2, min_pick: 18, max_pick: 60, picks: 41, stdev: 8.1 },
  dynasty: { adp: 14.6, min_pick: 3, max_pick: 41, picks: 88, stdev: 6.4 },
};

/** Priced on one board only — a rookie no redraft has taken, typically. */
const dynastyOnly: AdpPlayerPayload = {
  ...adp,
  redraft: null,
};

const base: ShareMetricContext = {
  leagues: [league("a"), league("b", { settings: { type: 2 } })],
  leagueCount: 10,
  adp: null,
};

function cell(key: string, ctx: Partial<ShareMetricContext> = {}) {
  const metric = PLAYER_SHARE_METRICS.find((m) => m.key === key);
  assert.ok(metric, `no metric ${key}`);
  return metric.cell({ ...base, ...ctx });
}

/** A value metric's printed text — null being the em dash every view shows. */
function text(key: string, ctx: Partial<ShareMetricContext> = {}) {
  const read = cell(key, ctx);
  assert.equal(read.kind, "value");
  return read.kind === "value" ? read.text : undefined;
}

describe("share metric catalogue", () => {
  test("every default column names a metric the list offers", () => {
    for (const key of DEFAULT_PLAYER_COLUMNS) {
      assert.ok(
        PLAYER_SHARE_METRICS.some((m) => m.key === key),
        `player default ${key} is not in the catalogue`,
      );
    }
    for (const key of DEFAULT_LEAGUEMATE_COLUMNS) {
      assert.ok(
        LEAGUEMATE_SHARE_METRICS.some((m) => m.key === key),
        `leaguemate default ${key} is not in the catalogue`,
      );
    }
  });

  test("keys are unique — a column's stored selection resolves to one metric", () => {
    const keys = PLAYER_SHARE_METRICS.map((m) => m.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("the leaguemate menu offers nothing that prices a player", () => {
    // The ADP metrics read a board entry a person can never have, so the menu
    // that can't answer them must not list them.
    assert.ok(!LEAGUEMATE_SHARE_METRICS.some((m) => m.key.startsWith("adp")));
  });
});

describe("exposure metrics", () => {
  test("the count is held out of the leagues counted, not the leagues held", () => {
    const held = cell("leagues");
    assert.equal(held.kind, "share");
    assert.equal(held.kind === "share" && held.held, 2);
    assert.equal(held.kind === "share" && held.of, 10);
    assert.equal(metricPreview(held), "2");
  });

  test("the share restates that count as a percentage of the same denominator", () => {
    assert.equal(text("share"), "20%");
  });

  test("a denominator of zero has no share to state", () => {
    assert.equal(text("share", { leagues: [], leagueCount: 0 }), null);
  });
});

describe("record metrics", () => {
  test("sum the manager's record across the leagues behind the row", () => {
    assert.equal(text("record"), "12-8");
  });

  test("a played record is a win percentage", () => {
    assert.equal(text("win_pct"), ".600");
  });

  test("no games played is an em dash, never 0-0 or .000", () => {
    const leagues = [league("a", { record: { wins: 0, losses: 0, ties: 0 } })];
    assert.equal(text("record", { leagues }), null);
    assert.equal(text("win_pct", { leagues }), null);
  });

  test("leagues carrying no record are left out of the denominator", () => {
    // Membership without a roster arrives as `record: null` — the same Sleeper
    // quirk the header's readout counts around.
    const leagues = [league("a"), league("b", { record: null })];
    assert.equal(text("record", { leagues }), "6-4");
    assert.match(cell("record", { leagues }).title, /across 1 of these leagues/);
  });
});

describe("league-type metrics", () => {
  test("count the row's own leagues, not the ones counted", () => {
    const dynasty = cell("dynasty");
    assert.equal(dynasty.kind === "share" && dynasty.held, 1);
    assert.equal(dynasty.kind === "share" && dynasty.of, 2);
  });

  test("a missing Sleeper type reads as redraft", () => {
    // Sleeper omits `type` on a standard redraft league — the same fallback
    // `matchesFilters` and `/api/adp` take.
    const redraft = cell("redraft");
    assert.equal(redraft.kind === "share" && redraft.held, 1);
  });

  test("none of a kind is a zero, since the population is known", () => {
    const dynasty = cell("dynasty", { leagues: [league("a")] });
    assert.equal(dynasty.kind === "share" && dynasty.held, 0);
    assert.equal(metricPreview(dynasty), "0");
  });
});

describe("player ADP metrics", () => {
  test("each board's column prints its own average and spread", () => {
    // The fetch answers both markets; one column must never read the other's
    // number, or a rookie's dynasty price would pass as a redraft one.
    assert.equal(text("adp_redraft", { adp }), "34.2");
    assert.equal(text("adp_dynasty", { adp }), "14.6");
    assert.equal(text("adp_spread_redraft", { adp }), "18–60");
    assert.equal(text("adp_spread_dynasty", { adp }), "3–41");
  });

  test("a player one board can't average is an em dash there and a number here", () => {
    assert.equal(text("adp_redraft", { adp: dynastyOnly }), null);
    assert.equal(text("adp_dynasty", { adp: dynastyOnly }), "14.6");
    assert.match(
      cell("adp_redraft", { adp: dynastyOnly }).title,
      /not priced on the redraft board/,
    );
  });

  test("an unpriced player is an em dash, not a zero", () => {
    assert.equal(text("adp_redraft"), null);
    assert.equal(metricPreview(cell("adp_dynasty")), "—");
  });
});
