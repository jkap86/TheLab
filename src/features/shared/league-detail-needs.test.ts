import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  leagueDetailNeeds,
  type LeagueDataset,
  type LeagueDetailNeeds,
} from "./league-detail-needs.ts";
import {
  DEFAULT_PLAYER_COLUMNS,
  DEFAULT_WEEK_PLAYER_COLUMNS,
  PLAYER_METRICS,
  type PlayerMetricContext,
} from "./roster-metrics.ts";
import {
  DEFAULT_TEAM_COLUMNS,
  DEFAULT_WEEK_TEAM_COLUMNS,
  TEAM_METRICS,
  type TeamMetricContext,
} from "./standings-metrics.ts";
import type { LeagueTeamPayload } from "@/shared/contract";
import type { PlayerOutlook, PlayerSplit, TeamOutlook } from "@/shared/projections";

/**
 * Which of the panel's three enrichment reads a view actually makes.
 *
 * Getting this wrong is silent in **both** directions, which is why it is a pure
 * function with a test rather than a condition inside a hook. Over-declared, a
 * lineup checker opened on one Sunday runs a season-long lineup solve per team
 * and prices a KTC/ADP board, draws neither, and makes both compete with the week
 * read it was opened for. Under-declared, a column the reader has *selected* sits
 * at an em dash because nothing asked for its data — which on screen reads as
 * "nothing priced" rather than as "not fetched".
 */

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
} as unknown as LeagueTeamPayload;

const teamOutlook = {
  roster_id: 1,
  weekly_optimal_points: 1875.4,
  weekly_bench_points: 512.3,
  optimal_points: 1790.25,
  weekly_split: {},
} as unknown as TeamOutlook;

/**
 * A team context every field of which says something — a *week* panel's, so the
 * week metric answers with a number rather than with "not asked for". A base that
 * left any field empty would make its dataset look unread by every metric.
 */
const teamCtx = (over: Partial<TeamMetricContext> = {}): TeamMetricContext => ({
  team,
  outlook: teamOutlook,
  ktcTotal: 41320,
  adpTotal: 38400,
  superflex: true,
  draftCount: 37,
  week: 4,
  weekProjection: { optimal: 128.4, current: 119.2, points_left: 9.2 },
  ...over,
});

const playerCtx = (
  over: Partial<PlayerMetricContext> = {},
): PlayerMetricContext => ({
  outlook: { points: 210.5, weeks: 12 } as unknown as PlayerOutlook,
  split: {
    starting_points: 180.2,
    starting_weeks: 10,
    bench_points: 30.3,
    bench_weeks: 2,
  } as unknown as PlayerSplit,
  horizon: 13,
  ktc: 6200,
  adp: 4100,
  adpPosition: 18.4,
  superflex: true,
  draftCount: 37,
  week: 4,
  weekProjection: 17.6,
  ...over,
});

/**
 * What each read supplies, as its absence looks to a cell.
 *
 * The week's entry withholds `weekProjection` and **not** `week`: the number is
 * the panel's own prop and says which question is being asked, where the payload
 * is what answers it. Zeroing both would make `week_proj` change for the wrong
 * reason and prove nothing.
 */
const TEAM_FIELDS: Record<LeagueDataset, Partial<TeamMetricContext>> = {
  values: { ktcTotal: null, adpTotal: null, superflex: false, draftCount: 0 },
  outlook: { outlook: null },
  week: { weekProjection: null },
};

const PLAYER_FIELDS: Record<LeagueDataset, Partial<PlayerMetricContext>> = {
  values: { ktc: null, adp: null, adpPosition: null, superflex: false, draftCount: 0 },
  outlook: { outlook: undefined, split: undefined, horizon: 0 },
  week: { weekProjection: null },
};

const DATASETS = Object.keys(TEAM_FIELDS) as LeagueDataset[];

/** Both selections at once, since one function answers over the pair. */
const needs = (
  week: number | null,
  teamColumns: readonly string[],
  playerColumns: readonly string[],
): LeagueDetailNeeds => leagueDetailNeeds({ week, teamColumns, playerColumns });

describe("what each metric declares it reads", () => {
  test("every team metric declares exactly the reads its cell depends on", () => {
    // The agreement no type can carry: `reads` decides whether a request is made,
    // and the cell is what would silently blank without it.
    for (const metric of TEAM_METRICS) {
      const full = JSON.stringify(metric.cell(teamCtx()));
      for (const dataset of DATASETS) {
        const without = JSON.stringify(metric.cell(teamCtx(TEAM_FIELDS[dataset])));
        if (metric.reads.includes(dataset)) {
          assert.notEqual(
            without,
            full,
            `${metric.key} declares it reads ${dataset} but does not use it`,
          );
        } else {
          assert.equal(
            without,
            full,
            `${metric.key} reads ${dataset} without declaring it`,
          );
        }
      }
    }
  });

  test("every player metric declares exactly the reads its cell depends on", () => {
    for (const metric of PLAYER_METRICS) {
      const full = JSON.stringify(metric.cell(playerCtx()));
      for (const dataset of DATASETS) {
        const without = JSON.stringify(metric.cell(playerCtx(PLAYER_FIELDS[dataset])));
        if (metric.reads.includes(dataset)) {
          assert.notEqual(
            without,
            full,
            `${metric.key} declares it reads ${dataset} but does not use it`,
          );
        } else {
          assert.equal(
            without,
            full,
            `${metric.key} reads ${dataset} without declaring it`,
          );
        }
      }
    }
  });

  test("the points-for column costs no request at all", () => {
    // The one metric in either catalogue already answered by the core payload,
    // and the case that proves an empty `reads` is a real declaration rather than
    // a metric that forgot: a standings board of records fetches nothing.
    assert.deepEqual(needs(null, ["pf", "pf"], ["start"]).values, false);
    assert.deepEqual(needs(4, ["pf"], ["week_proj"]), {
      values: false,
      outlook: false,
      week: true,
    });
  });
});

describe("leagueDetailNeeds", () => {
  test("a season panel's defaults ask for the outlook and nothing else", () => {
    // The case the leagues list and the trades board open on, and the one worth
    // most: the two tables show projections, so the KTC/ADP board they never
    // price anything against is not fetched.
    assert.deepEqual(needs(null, DEFAULT_TEAM_COLUMNS, DEFAULT_PLAYER_COLUMNS), {
      values: false,
      outlook: true,
      week: false,
    });
  });

  test("a week panel's defaults ask for the week and nothing else", () => {
    // The lineup checker. It used to run the rest-of-season solve and the pricing
    // beside the one read it was opened for, both of which it drew nothing from.
    assert.deepEqual(
      needs(4, DEFAULT_WEEK_TEAM_COLUMNS, DEFAULT_WEEK_PLAYER_COLUMNS),
      { values: false, outlook: false, week: true },
    );
  });

  test("a season panel needs the outlook whatever its columns say", () => {
    // Not a derivation, and the one rule here that is a fact about the *panel*
    // rather than about the catalogues: the roster halves list `optimal` as their
    // starters, the bench under it is ordered on the season's projected points,
    // and the standings rows are ranked by `weekly_optimal_points`. No column
    // controls any of that, so a board aimed entirely away from the projections
    // still needs the read behind them.
    assert.equal(needs(null, ["ktc", "adp"], ["ktc", "adp"]).outlook, true);
    assert.equal(needs(null, ["pf"], []).outlook, true);
    assert.equal(needs(null, [], []).outlook, true);
  });

  test("a week panel needs the outlook only when a column reads it", () => {
    // The catalogue is one catalogue, so a rest-of-season column can be aimed at
    // a week panel — and then it has to be answered.
    for (const key of ["proj", "bench", "optimal"]) {
      assert.equal(needs(4, [key], ["week_proj"]).outlook, true, key);
    }
    for (const key of ["start", "bench", "proj"]) {
      assert.equal(needs(4, ["week_proj"], [key]).outlook, true, key);
    }
    assert.equal(needs(4, ["week_proj"], ["week_proj"]).outlook, false);
  });

  test("needs the values only when a column is showing a price", () => {
    for (const key of ["ktc", "adp"]) {
      assert.equal(needs(null, [key], ["start"]).values, true, `team ${key}`);
      assert.equal(needs(null, ["proj"], [key]).values, true, `player ${key}`);
      assert.equal(needs(4, ["week_proj"], [key]).values, true, `week ${key}`);
    }
    assert.equal(needs(null, ["proj", "bench"], ["start", "bench"]).values, false);
  });

  test("a week column on a season panel asks for no week", () => {
    // There is nothing to ask for — the request line carries a week number and a
    // season panel has none — which is what that cell says in words rather than
    // drawing a number it could not have.
    assert.equal(needs(null, ["week_proj"], ["week_proj"]).week, false);
  });

  test("a season column on a week panel does not turn the week read off", () => {
    // The week is the panel's subject rather than one of its columns: the lineup
    // each half lists, the start/sit marks on it and the median bar in the head
    // all come off that payload whatever the slots are aimed at.
    assert.equal(needs(4, ["proj"], ["ktc"]).week, true);
  });

  test("re-aiming a slot back onto a metric asks for its read again", () => {
    // What re-enabling a query looks like from here: the requirement follows the
    // selection with no state of its own, so React Query re-enables against the
    // same key and answers from cache while that key is still fresh.
    assert.equal(needs(null, ["proj", "bench"], ["start", "bench"]).values, false);
    assert.equal(needs(null, ["ktc", "bench"], ["start", "bench"]).values, true);
    assert.equal(needs(null, ["proj", "bench"], ["start", "bench"]).values, false);
  });

  test("a key naming no metric requires nothing", () => {
    // A selection stored by an older build: `resolveColumns` falls that slot back
    // per slot, and a slot that cannot be drawn should not be a slot that fetches.
    assert.deepEqual(needs(4, ["retired_metric"], ["gone_too"]), {
      values: false,
      outlook: false,
      week: true,
    });
  });

  test("every catalogue key is answerable by some read", () => {
    // A metric declaring `reads` this function cannot turn into a request would
    // be a column that draws an em dash forever. `pf` is the deliberate exception
    // and is checked above.
    for (const metric of [...TEAM_METRICS, ...PLAYER_METRICS]) {
      if (metric.key === "pf") continue;
      const asked = needs(4, [metric.key], [metric.key]);
      assert.ok(
        metric.reads.every((dataset) => asked[dataset]),
        `${metric.key} declares a read nothing enables`,
      );
    }
  });
});
