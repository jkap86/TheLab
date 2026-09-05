import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LeagueLineup } from "@/shared/contract";

import { lineupMetricTotals, rankLeagueLineups } from "./league-ranks.ts";
import type { LeagueRosterRow, RankLeague } from "./league-ranks.ts";
import type { RosProjections } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";

/** A one-starter league, so a roster's total is its best player's points. */
function league(
  rosters: readonly LeagueRosterRow[],
  overrides: Partial<RankLeague> = {},
): RankLeague {
  return {
    league_id: "L1",
    total_rosters: rosters.length,
    roster_positions: ["FLEX", "BN"],
    scoring_settings: { rec: 1 },
    rosters,
    ...overrides,
  };
}

function roster(
  roster_id: number,
  owner_id: string | null,
  players: string[],
): LeagueRosterRow {
  return { roster_id, owner_id, players };
}

function projected(
  id: string,
  positions: string[],
  stats: Record<string, number>,
): RosProjections[string] {
  return { player_id: id, stats, weeks: [1, 2], name: `Name ${id}`, positions };
}

function unprojected(id: string, positions: string[]): RosProjections[string] {
  return { player_id: id, stats: {}, weeks: [], name: `Name ${id}`, positions };
}

const NO_ADP = new Map<string, AdpEntry>();

/** An average pick off a full draft — the board a startup or a redraft measures. */
const full = (adp: number): AdpEntry => ({ board: "full", adp });
const NO_PROJECTIONS: RosProjections = {};

/** A lineup with one seated starter, an empty seat and two on the bench. */
function lineupFixture(): LeagueLineup {
  return {
    league_id: "L1",
    starters: [
      {
        slot: "FLEX",
        player: {
          player_id: "a",
          name: null,
          positions: ["WR"],
          points: 7.5,
          adp_value: 100,
          ktc_value: 6000,
        },
      },
      { slot: "QB", player: null },
    ],
    bench: [
      {
        player_id: "b",
        name: null,
        positions: [],
        points: 2.25,
        adp_value: null,
        ktc_value: 1500,
      },
      {
        player_id: "c",
        name: null,
        positions: [],
        points: null,
        adp_value: 40,
        ktc_value: null,
      },
    ],
    projected_points: 7.5,
    unknown_slots: [],
  };
}

describe("lineupMetricTotals", () => {
  test("sums each lens off one lineup, counting nulls as zero", () => {
    assert.deepEqual(lineupMetricTotals(lineupFixture(), 9000), {
      ros_starters: 7.5,
      ros_bench: 2.25,
      capital_total: 140,
      capital_bench: 40,
      capital_starters: 100,
      ktc_total: 16500,
      ktc_starters: 6000,
      ktc_bench: 1500,
      ktc_picks: 9000,
    });
  });

  // The reason the four KTC metrics are arranged the way they are: a reader
  // can see where a roster's worth sits, and the parts add up to the whole.
  // Capital deliberately does not include picks, so it must not start.
  test("the four KTC metrics reconcile and capital is unmoved by picks", () => {
    const totals = lineupMetricTotals(lineupFixture(), 9000);
    assert.equal(
      totals.ktc_total,
      totals.ktc_starters + totals.ktc_bench + totals.ktc_picks,
    );
    assert.equal(totals.capital_total, lineupMetricTotals(lineupFixture()).capital_total);
  });

  // An unpriced player is off KTC's board, which is a different claim from
  // being worth nothing — but a *sum* has to put something there, and zero is
  // the only value that leaves the other rosters' totals comparable.
  test("an unpriced player contributes nothing rather than breaking the sum", () => {
    const lineup = lineupFixture();
    lineup.starters[0]!.player!.ktc_value = null;
    lineup.bench[0]!.ktc_value = null;
    const totals = lineupMetricTotals(lineup);
    assert.equal(totals.ktc_starters, 0);
    assert.equal(totals.ktc_bench, 0);
    assert.equal(totals.ktc_total, 0);
  });

  // No pick argument at all is the state every non-dynasty league is in, and
  // every league when the board could not be read.
  test("picks default to nothing rather than to undefined arithmetic", () => {
    assert.equal(lineupMetricTotals(lineupFixture()).ktc_picks, 0);
    assert.equal(lineupMetricTotals(lineupFixture()).ktc_total, 7500);
  });
});

describe("rankLeagueLineups", () => {
  test("ranks the manager's starters among every stored roster", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 20 }),
      w2: projected("w2", ["WR"], { rec: 10 }),
      w3: projected("w3", ["WR"], { rec: 5 }),
    };
    const l = league([
      roster(1, "t1", ["w1"]),
      roster(2, "me", ["w2"]),
      roster(3, "t3", ["w3"]),
    ]);
    const { lineup, ranks } = rankLeagueLineups(l, "me", board, NO_ADP);

    // The lineup that ships is the manager's own, not the league's best.
    assert.equal(lineup?.starters[0]?.player?.player_id, "w2");
    assert.deepEqual(ranks.ros_starters, { rank: 2, of: 3 });
  });

  test("ties share the better rank and the next total skips", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 20 }),
      w2: projected("w2", ["WR"], { rec: 10 }),
      w3: projected("w3", ["WR"], { rec: 10 }),
      w4: projected("w4", ["WR"], { rec: 5 }),
    };
    const l = league([
      roster(1, "t1", ["w1"]),
      roster(2, "t2", ["w2"]),
      roster(3, "t3", ["w3"]),
      roster(4, "me", ["w4"]),
    ]);

    // One of the tied pair reads 2nd…
    const tied = rankLeagueLineups(l, "t2", board, NO_ADP);
    assert.deepEqual(tied.ranks.ros_starters, { rank: 2, of: 4 });
    // …and the manager behind both of them reads 4th, not 3rd.
    const behind = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(behind.ranks.ros_starters, { rank: 4, of: 4 });
  });

  test("an unprojected bench player counts zero toward the bench total", () => {
    const board: RosProjections = {
      s1: projected("s1", ["WR"], { rec: 9 }),
      b1: projected("b1", ["WR"], { rec: 5 }),
      s2: projected("s2", ["WR"], { rec: 9 }),
      b2: projected("b2", ["WR"], { rec: 7 }),
    };
    // "gh" is unknown to the feed entirely: null points, worth nothing here.
    const l = league([
      roster(1, "me", ["s1", "b1", "gh"]),
      roster(2, "t2", ["s2", "b2"]),
    ]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(ranks.ros_bench, { rank: 2, of: 2 });
  });

  test("capital ranks read the same whether or not the players have points", () => {
    const adp = new Map([
      ["a", full(1)],
      ["b", full(30)],
    ]);
    // Same identities both times; only the points differ. The truly absent
    // feed ({}) is a different degradation — see the next test.
    const pointed: RosProjections = {
      a: projected("a", ["WR"], { rec: 1 }),
      b: projected("b", ["WR"], { rec: 20 }),
    };
    const pointless: RosProjections = {
      a: unprojected("a", ["WR"]),
      b: unprojected("b", ["WR"]),
    };
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);

    const withPoints = rankLeagueLineups(l, "me", pointed, adp);
    const without = rankLeagueLineups(l, "me", pointless, adp);
    assert.deepEqual(withPoints.ranks.capital_total, { rank: 1, of: 2 });
    for (const metric of ["capital_total", "capital_bench", "capital_starters"] as const) {
      assert.deepEqual(without.ranks[metric], withPoints.ranks[metric]);
    }
    assert.equal(without.ranks.ros_starters, null);
  });

  test("with no feed at all, capital_total still answers but the split cannot", () => {
    const adp = new Map([
      ["a", full(1)],
      ["b", full(30)],
    ]);
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);
    // An empty feed knows no positions, so nobody can be seated: the whole
    // roster's capital lands on the bench, and the starters/bench split is
    // degenerate while the total keeps ranking.
    const { ranks } = rankLeagueLineups(l, "me", NO_PROJECTIONS, adp);

    assert.equal(ranks.ros_starters, null);
    assert.equal(ranks.ros_bench, null);
    assert.deepEqual(ranks.capital_total, { rank: 1, of: 2 });
    assert.deepEqual(ranks.capital_bench, { rank: 1, of: 2 });
    assert.equal(ranks.capital_starters, null);
  });

  test("with no ADP board the capital ranks are null while ROS still answers", () => {
    const board: RosProjections = {
      a: projected("a", ["WR"], { rec: 5 }),
      b: projected("b", ["WR"], { rec: 3 }),
    };
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP);

    assert.deepEqual(ranks.ros_starters, { rank: 1, of: 2 });
    assert.equal(ranks.capital_total, null);
    assert.equal(ranks.capital_bench, null);
    assert.equal(ranks.capital_starters, null);
  });

  test("orphan and empty rosters are ranked and counted, behind the scorers", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 5 }),
      w2: projected("w2", ["WR"], { rec: 8 }),
    };
    const l = league([
      roster(1, "me", ["w1"]),
      roster(2, null, ["w2"]), // an orphan team still beats the manager
      roster(3, "t3", []), // an empty roster still widens the field
    ]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(ranks.ros_starters, { rank: 2, of: 3 });
    // Every bench is empty, so the bench metric has nothing to say.
    assert.equal(ranks.ros_bench, null);
  });

  test("every roster's solve comes back with its totals, in roster order", () => {
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 20 }),
      w2: projected("w2", ["WR"], { rec: 10 }),
    };
    const l = league([roster(1, "t1", ["w1"]), roster(2, "me", ["w2"])]);
    const { rosters } = rankLeagueLineups(l, "me", board, NO_ADP);

    // The teams pane renders from these, so nobody's solve is discarded.
    assert.deepEqual(
      rosters.map((r) => [
        r.roster.roster_id,
        r.lineup.starters[0]?.player?.player_id,
        r.totals.ros_starters,
      ]),
      [
        [1, "w1", 20],
        [2, "w2", 10],
      ],
    );
  });

  test("a forced board is four more ranks under its own keys", () => {
    // The same nine rosters re-totalled on a second price table. The base ranks
    // must stay exactly what the league's own board said — a variant is a
    // column beside them, never a replacement for them.
    const board: RosProjections = {
      a: projected("a", ["WR"], { rec: 5 }),
      b: projected("b", ["WR"], { rec: 3 }),
    };
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", ["b"])]);
    // On the league's own board the manager is worth less; on the forced one,
    // more — so the two ranks disagree, which is the whole reason a column
    // names its market.
    const own = new Map([
      ["a", 100],
      ["b", 400],
    ]);
    const forced = new Map([
      ["a", 900],
      ["b", 200],
    ]);
    const { ranks } = rankLeagueLineups(l, "me", board, NO_ADP, own, new Map(), [
      { key: "dynasty:sf", values: forced, pickValues: new Map() },
    ]);

    assert.deepEqual(ranks.ktc_total, { rank: 2, of: 2 });
    assert.deepEqual(ranks["ktc_total:dynasty:sf"], { rank: 1, of: 2 });
    assert.deepEqual(ranks["ktc_starters:dynasty:sf"], { rank: 1, of: 2 });
    // Nobody owns a pick on either board, so the picks metric has nothing to
    // say under the variant's key either — the all-zero rule, unchanged.
    assert.equal(ranks["ktc_picks:dynasty:sf"], null);
  });

  test("a variant's picks ride its own board, and reconcile with its total", () => {
    const board: RosProjections = { a: projected("a", ["WR"], { rec: 5 }) };
    const l = league([roster(1, "me", ["a"]), roster(2, "t2", [])]);
    const { rosters, ranks } = rankLeagueLineups(
      l,
      "me",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [
        {
          key: "dynasty:auto",
          values: new Map([["a", 300]]),
          pickValues: new Map([[2, 5000]]),
        },
      ],
    );

    // The other roster owns nothing but 5,000 of picks, which on this board is
    // enough to beat a 300-point player — so `ktc_total` includes the picks and
    // the rank moves with them.
    assert.deepEqual(ranks["ktc_total:dynasty:auto"], { rank: 2, of: 2 });
    assert.deepEqual(ranks["ktc_picks:dynasty:auto"], { rank: 2, of: 2 });
    // …while the base ranks, priced on a board nothing was read from, stay null.
    assert.equal(ranks.ktc_total, null);
    assert.equal(rosters.length, 2);
  });

  test("a manager holding no roster gets a null lineup and null ranks", () => {
    const board: RosProjections = { w1: projected("w1", ["WR"], { rec: 5 }) };
    const l = league([roster(1, "t1", ["w1"])]);
    const result = rankLeagueLineups(l, "nobody", board, NO_ADP);

    assert.equal(result.lineup, null);
    assert.deepEqual(result.ranks, {
      ros_starters: null,
      ros_bench: null,
      capital_total: null,
      capital_bench: null,
      capital_starters: null,
      ktc_total: null,
      ktc_starters: null,
      ktc_bench: null,
      ktc_picks: null,
    });
  });
});
