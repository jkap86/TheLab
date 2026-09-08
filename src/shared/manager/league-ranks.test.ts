import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  LeagueLineup,
  LineupMetricId,
  LineupPosition,
  LineupSlot,
} from "@/shared/contract";

import { lineupColumnKey } from "../ktc/columns.ts";
import {
  capitalMetricTotals,
  lineupMetricTotals,
  rankLeagueLineups,
} from "./league-ranks.ts";
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
  return { player_id: id, stats, weeks: [1, 2], name: `Name ${id}`, positions, team: null };
}

function unprojected(id: string, positions: string[]): RosProjections[string] {
  return { player_id: id, stats: {}, weeks: [], name: `Name ${id}`, positions, team: null };
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
          team: null,
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
        team: null,
        points: 2.25,
        adp_value: null,
        ktc_value: 1500,
      },
      {
        player_id: "c",
        name: null,
        positions: [],
        team: null,
        points: null,
        adp_value: 40,
        ktc_value: null,
      },
    ],
    projected_points: 7.5,
    unknown_slots: [],
  };
}

/**
 * A lineup with a quarterback and two flex-eligible starters, one of whom
 * Sleeper files at two positions, plus a bench of one more quarterback, a
 * running back and a player the feed knows nothing about.
 *
 * Every figure is distinct across the three lenses so a narrowed total can only
 * be right for one reason.
 */
function narrowableFixture(): LeagueLineup {
  const player = (
    id: string,
    positions: string[],
    points: number | null,
    adp: number | null,
    ktc: number | null,
  ) => ({
    player_id: id,
    name: null,
    positions,
    team: null,
    points,
    adp_value: adp,
    ktc_value: ktc,
  });

  return {
    league_id: "L1",
    starters: [
      { slot: "QB", player: player("qb1", ["QB"], 18, 200, 5000) },
      { slot: "FLEX", player: player("wr1", ["WR"], 12, 150, 3000) },
      // Sleeper files this one at two positions, which is the case the
      // intersection rule exists for.
      { slot: "TE", player: player("te1", ["TE", "WR"], 9, 90, 2000) },
      { slot: "K", player: null },
    ],
    bench: [
      player("qb2", ["QB"], 6, 50, 1200),
      player("rb1", ["RB"], 4, 40, 800),
      // Positions unknown: he belongs to no narrowing at all.
      player("nobody", [], 3, 10, 100),
    ],
    projected_points: 39,
    unknown_slots: [],
  };
}

/** The three positions the fixture actually seats, for the "everyone" case. */
const EVERY_SEATED: LineupPosition[] = ["QB", "RB", "WR", "TE"];

describe("lineupMetricTotals — a position narrowing", () => {
  // The whole claim in one assertion: a narrowed total is the same solve summed
  // over fewer players, on every lens at once. `qb1` is seated and `qb2` is
  // not, so the starters/bench partition survives the narrowing rather than
  // being re-decided by it.
  test("counts only the players in the set, on every lens", () => {
    const totals = lineupMetricTotals(narrowableFixture(), 9000, ["QB"]);
    assert.deepEqual(totals, {
      ros_total: 24,
      ros_starters: 18,
      ros_bench: 6,
      capital_total: 250,
      capital_bench: 50,
      capital_starters: 200,
      ktc_total: 6200,
      ktc_starters: 5000,
      ktc_bench: 1200,
      ktc_picks: 0,
    });
  });

  // Sleeper lists more than one position for the players this matters most for,
  // so `te1` is in a TE column and a WR column alike — and **once** in a set
  // that names both. Double-counted he would read 7,000 here.
  test("a two-position player counts in either set, and once in a set naming both", () => {
    const lineup = narrowableFixture();
    assert.equal(lineupMetricTotals(lineup, 0, ["TE"]).ktc_starters, 2000);
    assert.equal(lineupMetricTotals(lineup, 0, ["WR"]).ktc_starters, 5000);
    assert.equal(lineupMetricTotals(lineup, 0, ["TE", "WR"]).ktc_starters, 5000);
    assert.equal(lineupMetricTotals(lineup, 0, ["TE", "WR"]).ros_starters, 21);
  });

  // A player the feed cannot place belongs nowhere, which is the honest reading:
  // guessing is how a roster's total quietly gains somebody nobody asked for.
  test("a player with no positions is in no narrowing", () => {
    const lineup = narrowableFixture();
    const rb = lineupMetricTotals(lineup, 0, ["RB"]);
    assert.equal(rb.ros_bench, 4);
    assert.equal(rb.ktc_bench, 800);
    // The unplaced bench player's 3 points and 100 of value are in the
    // un-narrowed bench and in none of the narrowed ones.
    assert.equal(lineupMetricTotals(lineup).ros_bench, 13);
  });

  // The regression that matters most: the axis must be free for everyone who
  // never touches it.
  test("an empty set is byte-identical to no narrowing at all", () => {
    assert.deepEqual(
      lineupMetricTotals(narrowableFixture(), 9000, []),
      lineupMetricTotals(narrowableFixture(), 9000),
    );
  });

  // The un-narrowed figure is read off `projected_points`; a narrowed one is
  // re-summed and must round on the same convention, or the two disagree at the
  // last decimal with nothing on screen saying which is wrong.
  test("a narrowed ros_starters rounds the way the solver already did", () => {
    const lineup = narrowableFixture();
    lineup.starters[1]!.player!.points = 0.1;
    lineup.starters[2]!.player!.points = 0.2;
    // 0.1 + 0.2 is 0.30000000000000004 unrounded.
    assert.equal(lineupMetricTotals(lineup, 0, ["WR"]).ros_starters, 0.3);
  });

  test("a set naming every seated position re-sums to the lineup's own figure", () => {
    const lineup = narrowableFixture();
    assert.equal(
      lineupMetricTotals(lineup, 0, EVERY_SEATED).ros_starters,
      lineup.projected_points,
    );
  });

  // A pick has no position, so a narrowed column cannot own one — and the four
  // metrics still have to add up, or the tiles stop being readable together.
  test("a narrowing drops the picks and the four KTC metrics still reconcile", () => {
    const whole = lineupMetricTotals(narrowableFixture(), 9000);
    const narrowed = lineupMetricTotals(narrowableFixture(), 9000, ["QB"]);

    assert.equal(whole.ktc_picks, 9000);
    assert.equal(narrowed.ktc_picks, 0);
    for (const totals of [whole, narrowed]) {
      assert.equal(
        totals.ktc_total,
        totals.ktc_starters + totals.ktc_bench + totals.ktc_picks,
      );
    }
    // Left in, the portfolio would be the whole of a QB column's figure.
    assert.equal(narrowed.ktc_total, 6200);
  });
});

describe("lineupMetricTotals", () => {
  test("sums each lens off one lineup, counting nulls as zero", () => {
    assert.deepEqual(lineupMetricTotals(lineupFixture(), 9000), {
      ros_total: 9.75,
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

  // Three figures on one scale, and a reader adding the two halves must land on
  // the whole — which is why `ros_total` is summed from the halves rather than
  // re-summed off the roster: that would round once where these round twice,
  // and disagree by a cent on a card showing all three.
  test("the three ROS metrics reconcile, whole and narrowed", () => {
    const whole = lineupMetricTotals(lineupFixture(), 9000);
    assert.equal(whole.ros_total, whole.ros_starters + whole.ros_bench);
    const narrowed = lineupMetricTotals(narrowableFixture(), 9000, ["QB"]);
    assert.equal(
      narrowed.ros_total,
      narrowed.ros_starters + narrowed.ros_bench,
    );
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
      ros_total: null,
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


/**
 * The per-roster totals a caller can carry out beside the ranks.
 *
 * **A rank is a statement about the manager and a total is a statement about a
 * roster**, and the standings pane reads the second: it prints one column for
 * every team in the league, on whatever pricing and narrowing that column
 * names. The numbers are the ranks' own — recorded as the loops pass rather
 * than summed again — so what these pin is that they are recorded, that only
 * what was asked for is, and that the one path with nobody to rank still
 * answers.
 */
describe("rankLeagueLineups — per-column team totals", () => {
  const board: RosProjections = {
    q1: projected("q1", ["QB"], { rec: 20 }),
    w1: projected("w1", ["WR"], { rec: 12 }),
    w2: projected("w2", ["WR"], { rec: 6 }),
  };

  test("a narrowed key is carried for every roster", () => {
    const l = league(
      [roster(1, "me", ["q1", "w1"]), roster(2, "t2", ["w2"])],
      { roster_positions: ["QB", "FLEX", "BN"] },
    );
    const key = "ros_starters:qb";
    const { rosters } = rankLeagueLineups(
      l,
      "me",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["QB"]],
      [],
      [],
      new Set([key]),
    );

    // Narrowed to quarterbacks, the manager's starters are the one QB and the
    // other roster's are nobody — which is the sum the rank was made from.
    assert.equal(rosters[0].columns[key], 20);
    assert.equal(rosters[1].columns[key], 0);
    // And the whole-roster totals are untouched beside it.
    assert.equal(rosters[0].totals.ros_starters, 32);
  });

  test("only the keys asked for are carried", () => {
    const l = league([roster(1, "me", ["w1"]), roster(2, "t2", ["w2"])]);
    const { rosters, ranks } = rankLeagueLineups(
      l,
      "me",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["WR"], ["QB"]],
      [],
      [],
      new Set(["ros_starters:wr"]),
    );

    // Both narrowings are *ranked* — the axes cross and the cost is a sum —
    // where only the named one is carried out per roster. That asymmetry is
    // the whole reason this is a set of keys rather than the cross product: a
    // dozen rosters times every cell is hundreds of numbers a league.
    //
    // `in` rather than truthiness: a narrowing nobody in this league has a
    // player for ranks *null*, which is the all-zero rule answering and is
    // still the key having been asked and filed.
    assert.deepEqual(ranks["ros_starters:wr"], { rank: 1, of: 2 });
    assert.ok("ros_starters:qb" in ranks);
    assert.deepEqual(Object.keys(rosters[0].columns), ["ros_starters:wr"]);
  });

  test("an un-narrowed column is answered by the ten and carried nowhere", () => {
    const l = league([roster(1, "me", ["w1"]), roster(2, "t2", ["w2"])]);
    const key = lineupColumnKey({
      metric: "ros_starters",
      format: "auto",
      lineup: "auto",
      positions: [],
      slots: [],
    });
    const { rosters } = rankLeagueLineups(
      l,
      "me",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [],
      [],
      [],
      new Set([key]),
    );

    // `auto` folds out of the key, so what the pane looks up is the bare metric
    // id — already one of the ten. Carrying it again would be the same number
    // twice, and a client that had to know which of the two to read would be a
    // second rule to get wrong.
    assert.equal(key, "ros_starters");
    assert.deepEqual(rosters[0].columns, {});
    assert.equal(rosters[0].totals.ros_starters, 12);
  });

  test("a forced market's totals are carried under that market's key", () => {
    const l = league([roster(1, "me", ["w1"]), roster(2, "t2", ["w2"])]);
    const forced = new Map([
      ["w1", 900],
      ["w2", 200],
    ]);
    const { rosters } = rankLeagueLineups(
      l,
      "me",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [{ key: "dynasty:sf", values: forced, pickValues: new Map() }],
      [],
      [],
      [],
      new Set(["ktc_total:dynasty:sf"]),
    );

    assert.equal(rosters[0].columns["ktc_total:dynasty:sf"], 900);
    assert.equal(rosters[1].columns["ktc_total:dynasty:sf"], 200);
  });

  /**
   * The regression the manager guard was restructured for.
   *
   * A league-scoped read — the trade card's — solves a league the reader may
   * hold no roster in, and this used to return above the loops the moment it
   * could not find one. That answered every keyed column with an absence on
   * exactly the path where the standings pane is the whole of what a reader
   * opened.
   */
  test("a league with nobody to rank still carries the totals", () => {
    const l = league([roster(1, "t1", ["w1"]), roster(2, "t2", ["w2"])]);
    const key = "ros_starters:wr";
    const { lineup, ranks, rosters } = rankLeagueLineups(
      l,
      "nobody",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["WR"]],
      [],
      [],
      new Set([key]),
    );

    assert.equal(lineup, null);
    // Named and unanswerable, which is a different thing from absent — and
    // what a card draws an em dash for either way.
    assert.equal(ranks[key], null);
    assert.equal(ranks.ros_starters, null);
    assert.equal(rosters[0].columns[key], 12);
    assert.equal(rosters[1].columns[key], 6);
  });

  test("carrying nothing is the default, so a caller that only ranks pays nothing", () => {
    const l = league([roster(1, "me", ["w1"])]);
    const { rosters } = rankLeagueLineups(l, "me", board, NO_ADP);
    assert.deepEqual(rosters[0].columns, {});
  });
});

/** The ten metric ids, so a stray key in the un-narrowed answer is visible. */
const TEN: LineupMetricId[] = [
  "ros_total",
  "ros_starters",
  "ros_bench",
  "capital_total",
  "capital_bench",
  "capital_starters",
  "ktc_total",
  "ktc_starters",
  "ktc_bench",
  "ktc_picks",
];

/**
 * The key a column of this shape is looked up by — asked of `lineupColumnKey`
 * itself rather than spelled here, because that is the claim these tests exist
 * to make: the server files a rank under the string the card reads it back by,
 * and a second spelling anywhere is an em dash where a number should be.
 */
function key(
  metric: LineupMetricId,
  positions: readonly LineupPosition[] = [],
  forced: { format: "dynasty" | "redraft"; lineup: "sf" | "oneqb" } | null = null,
  slots: readonly LineupSlot[] = [],
): string {
  return lineupColumnKey({
    metric,
    format: forced?.format ?? "auto",
    lineup: forced?.lineup ?? "auto",
    positions,
    slots,
  });
}

describe("capitalMetricTotals", () => {
  // The trio behind both entry points, so `capital_total` is the two halves on
  // the league's own board and on a forced one alike.
  test("re-prices one solve against a second board and still reconciles", () => {
    const totals = capitalMetricTotals(lineupFixture(), () => 7);
    assert.equal(totals.capital_starters + totals.capital_bench, totals.capital_total);
  });

  test("an unpriced player contributes nothing rather than breaking the sum", () => {
    // Null is not zero anywhere else on this wire, but a *sum* has to put
    // something there — and the all-zero rule is what catches the case where
    // that makes the whole metric meaningless.
    const totals = capitalMetricTotals(lineupFixture(), () => null);
    assert.equal(totals.capital_total, 0);
  });
});

/**
 * A forced ADP board, which is the KeepTradeCut variant's move one valuation
 * over — and the one place the "a forced board never re-seats" rule had to be
 * *held to* rather than merely observed: `adp_value` is a tiebreak inside the
 * solve, so a board handed to the solver would change who is on the card.
 */
describe("rankLeagueLineups — a forced ADP board", () => {
  test("is three more ranks under its own key, beside the base ten", () => {
    const board: RosProjections = {
      a: unprojected("a", ["QB"]),
      b: unprojected("b", ["QB"]),
      c: unprojected("c", ["QB"]),
      d: unprojected("d", ["QB"]),
    };
    // Two apiece, so a seat and a bench spot are both filled and all three
    // capital metrics have something to say.
    const l = league([roster(1, "me", ["a", "c"]), roster(2, "t2", ["b", "d"])], {
      roster_positions: ["QB", "BN"],
    });
    // On the league's own board the manager's players went late; on the forced
    // one they went first, so the two answers must differ and both must be
    // there.
    const own = new Map([
      ["a", full(40)],
      ["c", full(40)],
      ["b", full(1)],
      ["d", full(1)],
    ]);
    const forced = new Map([
      ["a", full(1)],
      ["c", full(1)],
      ["b", full(40)],
      ["d", full(40)],
    ]);
    const { ranks } = rankLeagueLineups(
      l,
      "me",
      board,
      own,
      new Map(),
      new Map(),
      [],
      [],
      [{ key: ":sf", adp: forced }],
    );

    assert.deepEqual(ranks.capital_total, { rank: 2, of: 2 });
    assert.deepEqual(ranks["capital_total:sf"], { rank: 1, of: 2 });
    assert.deepEqual(ranks["capital_bench:sf"], { rank: 1, of: 2 });
    assert.deepEqual(ranks["capital_starters:sf"], { rank: 1, of: 2 });
    // A board nobody is priced on has nothing to say, which is the all-zero
    // rule rather than a special case.
    assert.equal(
      rankLeagueLineups(l, "me", board, own, new Map(), new Map(), [], [], [
        { key: ":oneqb", adp: NO_ADP },
      ]).ranks["capital_total:oneqb"],
      null,
    );
  });

  test("prices the same lineup rather than seating a different one", () => {
    // The rule the KTC columns have always had, on the one axis that could
    // have broken it. `adp_value` is the solver's tiebreak among the
    // unprojected, so a forced board seated by it would rank the manager on a
    // lineup nobody fields — and the seats on the card beside the rank would be
    // a different roster's.
    const board: RosProjections = {
      a: unprojected("a", ["QB"]),
      b: unprojected("b", ["QB"]),
    };
    const l = league([roster(1, "me", ["a", "b"]), roster(2, "t2", [])], {
      roster_positions: ["QB", "BN"],
    });
    const own = new Map([
      ["a", full(1)],
      ["b", full(60)],
    ]);
    const forced = new Map([
      ["a", full(60)],
      ["b", full(1)],
    ]);
    const plain = rankLeagueLineups(l, "me", board, own);
    const withBoard = rankLeagueLineups(
      l,
      "me",
      board,
      own,
      new Map(),
      new Map(),
      [],
      [],
      [{ key: ":sf", adp: forced }],
    );

    assert.equal(
      withBoard.rosters[0]!.lineup.starters[0]?.player?.player_id,
      plain.rosters[0]!.lineup.starters[0]?.player?.player_id,
    );
    // …and every base rank and total is byte-identical, so a bay switching
    // costs the page nothing it already had.
    assert.deepEqual(withBoard.rosters[0]!.totals, plain.rosters[0]!.totals);
    assert.deepEqual(withBoard.ranks.capital_total, plain.ranks.capital_total);
  });

  test("crosses with a narrowing, and its own key is unmoved", () => {
    const board: RosProjections = {
      qb: unprojected("qb", ["QB"]),
      wr: unprojected("wr", ["WR"]),
    };
    const l = league([roster(1, "me", ["qb", "wr"]), roster(2, "t2", ["wr"])]);
    const forced = new Map([
      ["qb", full(1)],
      ["wr", full(40)],
    ]);
    const { ranks } = rankLeagueLineups(
      l,
      "me",
      board,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["QB"]],
      [{ key: ":sf", adp: forced }],
    );

    // The un-narrowed key keeps its bare form, and the crossed one is the
    // board's suffix then the set's — exactly what `lineupColumnKey` writes.
    assert.ok(ranks["capital_total:sf"]);
    assert.deepEqual(ranks["capital_total:sf:qb"], { rank: 1, of: 2 });
    // Asked of the card's own function rather than spelled here, which is the
    // claim: the server files a rank under the string the card reads it by.
    assert.equal(
      lineupColumnKey({
        metric: "capital_total",
        format: "auto",
        lineup: "sf",
        positions: ["QB"],
        slots: [],
      }),
      "capital_total:sf:qb",
    );
  });
});

describe("rankLeagueLineups — a position narrowing", () => {
  /** One QB seat and one flex, so a narrowing can disagree with the whole. */
  function narrowableLeague(): RankLeague {
    return league(
      [roster(1, "me", ["q1", "w1"]), roster(2, "t2", ["q2", "w2"])],
      { roster_positions: ["QB", "FLEX", "BN"] },
    );
  }

  const BOARD: RosProjections = {
    q1: projected("q1", ["QB"], { rec: 5 }),
    w1: projected("w1", ["WR"], { rec: 20 }),
    q2: projected("q2", ["QB"], { rec: 10 }),
    w2: projected("w2", ["WR"], { rec: 3 }),
  };

  // The manager's receiver carries their whole lineup, so on the roster as a
  // whole they lead and at quarterback alone they trail. A narrowing that could
  // not disagree with the base rank would not be worth a column.
  test("narrows the population and files the answer under the column's own key", () => {
    const { ranks } = rankLeagueLineups(
      narrowableLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["QB"], ["WR"]],
    );

    assert.deepEqual(ranks.ros_starters, { rank: 1, of: 2 });
    assert.deepEqual(ranks[key("ros_starters", ["QB"])], { rank: 2, of: 2 });
    assert.deepEqual(ranks[key("ros_starters", ["WR"])], { rank: 1, of: 2 });
  });

  // The regression that matters most. Every column on the page that has not
  // narrowed reads a bare metric id, so a set on the request must add keys and
  // never rename one — an `all` token on the ten would blank every card.
  test("the ten keep their bare names and their answers when sets are asked for", () => {
    const plain = rankLeagueLineups(narrowableLeague(), "me", BOARD, NO_ADP);
    const narrowed = rankLeagueLineups(
      narrowableLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["QB"], ["TE", "WR"]],
    );

    assert.deepEqual(Object.keys(plain.ranks).sort(), [...TEN].sort());
    for (const metric of TEN) {
      assert.deepEqual(narrowed.ranks[metric], plain.ranks[metric]);
    }
    // …and the sets that were asked for are all ten each, beside them.
    assert.deepEqual(
      Object.keys(narrowed.ranks).sort(),
      [
        ...TEN,
        ...TEN.map((metric) => key(metric, ["QB"])),
        ...TEN.map((metric) => key(metric, ["TE", "WR"])),
      ].sort(),
    );
  });

  // Nobody in this league rosters a defensive lineman, so every roster totals
  // zero on every lens — which is the all-zero rule's own case, and answering
  // "1st of 12" there would be a claim about a field nobody stood in.
  test("a position nobody plays ranks null rather than first", () => {
    const { ranks } = rankLeagueLineups(
      narrowableLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map([["q1", 100]]),
      new Map([[1, 5000]]),
      [],
      [["DL"]],
    );

    for (const metric of TEN) {
      assert.equal(ranks[key(metric, ["DL"])], null);
    }
    // The un-narrowed answers are untouched by the empty narrowing beside them.
    assert.deepEqual(ranks.ktc_starters, { rank: 1, of: 2 });
    assert.deepEqual(ranks.ktc_picks, { rank: 1, of: 2 });
  });

  // A pick has no position, so a narrowed `ktc_picks` has nothing to rank —
  // while the un-narrowed one, over the same rosters, does.
  test("picks rank whole and never under a narrowing", () => {
    const { ranks } = rankLeagueLineups(
      narrowableLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map([
        ["q1", 100],
        ["w1", 900],
        ["q2", 800],
        ["w2", 100],
      ]),
      new Map([[1, 5000]]),
      [],
      [["QB"]],
    );

    // 6,000 against 900 with the picks in, and 100 against 800 without them.
    assert.deepEqual(ranks.ktc_total, { rank: 1, of: 2 });
    assert.deepEqual(ranks[key("ktc_total", ["QB"])], { rank: 2, of: 2 });
    assert.deepEqual(ranks.ktc_picks, { rank: 1, of: 2 });
    assert.equal(ranks[key("ktc_picks", ["QB"])], null);
  });

  // Both axes at once: a forced board *and* a narrowing is still one re-total
  // of one solve, and the key is the triple plus the set.
  test("a forced board crosses with a set, and its own key is unmoved", () => {
    const { ranks } = rankLeagueLineups(
      narrowableLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map([
        ["q1", 100],
        ["w1", 900],
        ["q2", 800],
        ["w2", 100],
      ]),
      new Map(),
      [
        {
          key: "dynasty:sf",
          values: new Map([
            ["q1", 900],
            ["w1", 100],
            ["q2", 100],
            ["w2", 100],
          ]),
          pickValues: new Map([[1, 3000]]),
        },
      ],
      [["QB"]],
    );

    const sf = { format: "dynasty", lineup: "sf" } as const;
    // The variant's own four are exactly what they were before the axis landed.
    assert.deepEqual(ranks[key("ktc_total", [], sf)], { rank: 1, of: 2 });
    assert.deepEqual(ranks[key("ktc_starters", [], sf)], { rank: 1, of: 2 });
    // On the league's own board the manager's quarterback trails; on the forced
    // one he leads. Both are four ranks off the same two solves.
    assert.deepEqual(ranks[key("ktc_starters", ["QB"])], { rank: 2, of: 2 });
    assert.deepEqual(ranks[key("ktc_starters", ["QB"], sf)], { rank: 1, of: 2 });
    assert.equal(ranks[key("ktc_picks", ["QB"], sf)], null);
  });

  // The lineups the teams pane renders are the ones the manager fields —
  // narrowing decides what a rank counts, never who is seated.
  test("a narrowing changes no lineup and no team total", () => {
    const plain = rankLeagueLineups(narrowableLeague(), "me", BOARD, NO_ADP);
    const narrowed = rankLeagueLineups(
      narrowableLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["QB"]],
    );

    assert.deepEqual(narrowed.lineup, plain.lineup);
    assert.deepEqual(
      narrowed.rosters.map((one) => one.totals),
      plain.rosters.map((one) => one.totals),
    );
  });
});

describe("lineupMetricTotals — a slot narrowing", () => {
  test("counts the seats asked for and nothing else", () => {
    // The seats are the narrowing here, not the players in them: the flex seat's
    // receiver counts and the quarterback beside him does not, whichever
    // positions either is filed at.
    const totals = lineupMetricTotals(narrowableFixture(), 9000, [], ["FLEX"]);
    assert.equal(totals.ros_starters, 12);
    assert.equal(totals.capital_starters, 150);
    assert.equal(totals.ktc_starters, 3000);
  });

  test("an empty seat contributes nothing and is not an error", () => {
    // `K` is a real seat of this lineup that the solver could not fill.
    const totals = lineupMetricTotals(narrowableFixture(), 9000, [], ["K"]);
    assert.equal(totals.ros_starters, 0);
    assert.equal(totals.ktc_starters, 0);
  });

  test("a seat the league does not run counts nobody", () => {
    // Which is the honest answer and needs no rule of its own — the picker never
    // offers such a seat, having built its keys from these very leagues.
    assert.equal(
      lineupMetricTotals(narrowableFixture(), 9000, [], ["SUPER_FLEX"])
        .ros_starters,
      0,
    );
  });

  test("the bench is empty under a seat narrowing, never left whole", () => {
    // A bench player occupies no seat, so there is no share of a bench a `FLEX`
    // column could honestly claim. Left whole it would put every unseated player
    // into `ros_total:@flex`, which a reader adding the tiles up would find
    // exceeds its own two halves.
    const totals = lineupMetricTotals(narrowableFixture(), 9000, [], ["FLEX"]);
    assert.equal(totals.ros_bench, 0);
    assert.equal(totals.capital_bench, 0);
    assert.equal(totals.ktc_bench, 0);
  });

  test("a pick is not sitting anywhere, so a narrowed portfolio is zero", () => {
    // `countedPicks`' rule said of seats. The quartet still reconciles, which is
    // the reading it is arranged to make possible.
    const totals = lineupMetricTotals(narrowableFixture(), 9000, [], ["FLEX"]);
    assert.equal(totals.ktc_picks, 0);
    assert.equal(
      totals.ktc_total,
      totals.ktc_starters + totals.ktc_bench + totals.ktc_picks,
    );
  });

  test("the three families still reconcile under a narrowing", () => {
    const totals = lineupMetricTotals(narrowableFixture(), 9000, [], ["QB"]);
    assert.equal(totals.ros_total, totals.ros_starters + totals.ros_bench);
    assert.equal(
      totals.capital_total,
      totals.capital_starters + totals.capital_bench,
    );
  });

  test("the seats are picked first and the players in them second", () => {
    // The intersection, which is what makes the two axes worth having as two: a
    // receiver in the flex seat counts, the same receiver on the bench does not,
    // and a quarterback in a flex seat would not either.
    const lineup = narrowableFixture();
    assert.equal(
      lineupMetricTotals(lineup, 0, ["WR"], ["FLEX"]).ros_starters,
      12,
    );
    assert.equal(
      lineupMetricTotals(lineup, 0, ["QB"], ["FLEX"]).ros_starters,
      0,
    );
    // The dual-eligible tight end sits in `TE` and is counted by a `WR` column
    // narrowed to that seat — the intersection rule, unchanged by the seat.
    assert.equal(lineupMetricTotals(lineup, 0, ["WR"], ["TE"]).ros_starters, 9);
  });

  test("no seat asked for is byte-identical to the answer before the axis", () => {
    assert.deepEqual(
      lineupMetricTotals(narrowableFixture(), 9000, [], []),
      lineupMetricTotals(narrowableFixture(), 9000),
    );
  });

  test("a narrowed starters figure is rounded the way the whole one is", () => {
    // The un-narrowed figure is read off `projected_points`, which the solver
    // has already rounded; a narrowed one has no such field and takes the same
    // `round`, or the two would part company at the last decimal on a card that
    // shows both.
    const lineup = narrowableFixture();
    lineup.starters[1].player!.points = 0.1 + 0.2;
    assert.equal(lineupMetricTotals(lineup, 0, [], ["FLEX"]).ros_starters, 0.3);
  });
});

describe("rankLeagueLineups — a slot narrowing", () => {
  /** A QB seat and a flex, so the seat a column counts can disagree with the
   * whole lineup. */
  function seatedLeague(): RankLeague {
    return league(
      [roster(1, "me", ["q1", "w1"]), roster(2, "t2", ["q2", "w2"])],
      { roster_positions: ["QB", "FLEX", "BN"] },
    );
  }

  const BOARD: RosProjections = {
    q1: projected("q1", ["QB"], { rec: 5 }),
    w1: projected("w1", ["WR"], { rec: 20 }),
    q2: projected("q2", ["QB"], { rec: 10 }),
    w2: projected("w2", ["WR"], { rec: 3 }),
  };

  test("ranks the seat and files it under the column's own key", () => {
    const { ranks } = rankLeagueLineups(
      seatedLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [],
      [],
      [["QB"], ["FLEX"]],
    );

    // The manager's receiver carries their lineup, so they lead the whole and
    // trail at the quarterback seat — which is the disagreement a column has to
    // be able to show for the axis to be worth a track.
    assert.deepEqual(ranks.ros_starters, { rank: 1, of: 2 });
    assert.deepEqual(ranks[key("ros_starters", [], null, ["QB"])], {
      rank: 2,
      of: 2,
    });
    assert.deepEqual(ranks[key("ros_starters", [], null, ["FLEX"])], {
      rank: 1,
      of: 2,
    });
  });

  test("the ten keep their bare names when seats are asked for", () => {
    // The regression that matters most, one axis over: every column that has not
    // narrowed reads a bare metric id, so a set on the request must add keys and
    // never rename one.
    const plain = rankLeagueLineups(seatedLeague(), "me", BOARD, NO_ADP);
    const narrowed = rankLeagueLineups(
      seatedLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [],
      [],
      [["FLEX"]],
    );
    for (const metric of TEN) {
      assert.deepEqual(narrowed.ranks[metric], plain.ranks[metric]);
    }
    assert.deepEqual(
      Object.keys(narrowed.ranks).sort(),
      [...TEN, ...TEN.map((metric) => key(metric, [], null, ["FLEX"]))].sort(),
    );
  });

  test("the two narrowings cross, and the key is what the card writes", () => {
    const { ranks } = rankLeagueLineups(
      seatedLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [["WR"]],
      [],
      [["FLEX"]],
    );

    // Four narrowings from two axes of one each — the un-narrowed pair, each
    // alone, and the crossed one — which is what keeps adding a tile free of a
    // round trip.
    assert.ok(ranks[key("ros_starters", ["WR"], null, ["FLEX"])]);
    assert.ok(ranks[key("ros_starters", ["WR"])]);
    assert.ok(ranks[key("ros_starters", [], null, ["FLEX"])]);
    // Asked of the card's own function rather than spelled here, which is the
    // claim these tests exist to make: the seats come before the players, and a
    // second spelling anywhere is an em dash where a number should be.
    assert.equal(
      lineupColumnKey({
        metric: "ros_starters",
        format: "auto",
        lineup: "auto",
        positions: ["WR"],
        slots: ["FLEX"],
      }),
      "ros_starters:@flex:wr",
    );
  });

  test("the bench metrics rank null under a seat, not first of two", () => {
    // Zero on every roster in the league, which the all-zero rule reads as
    // nothing to rank — the honest state for a question the bench cannot answer.
    const { ranks } = rankLeagueLineups(
      seatedLeague(),
      "me",
      BOARD,
      NO_ADP,
      new Map(),
      new Map(),
      [],
      [],
      [],
      [["FLEX"]],
    );
    assert.equal(ranks[key("ros_bench", [], null, ["FLEX"])], null);
    assert.equal(ranks[key("ktc_picks", [], null, ["FLEX"])], null);
  });
});

/**
 * The reused ranking column, which is the one thing an ordinary rank test
 * cannot see.
 *
 * **Every rank is now a pass over one `Float64Array` that every metric, every
 * narrowing and every forced board refills in turn.** A fill that stopped short
 * would leave the previous column's figures in the tail — so a metric would be
 * ranked partly on its own numbers and partly on the last one's, which is a
 * plausible rank with nothing on screen saying it is the wrong question's. The
 * assertions below are the same ranks computed one column at a time and
 * compared to the ranks computed all at once, over a league whose metrics
 * genuinely disagree about the order.
 */
describe("rankLeagueLineups — the reused column", () => {
  test("every metric is ranked on its own figures, whatever precedes it", () => {
    // Points and capital order these rosters *oppositely*: `w1` is the best
    // projection and the worst ADP, so a column left carrying the previous
    // metric's numbers would rank the manager the wrong way round on one of
    // them and both readings are plausible.
    const board: RosProjections = {
      w1: projected("w1", ["WR"], { rec: 30 }),
      w2: projected("w2", ["WR"], { rec: 20 }),
      w3: projected("w3", ["WR"], { rec: 10 }),
    };
    // Adjacent picks, deliberately: the ADP curve is an exponential decay
    // anchored to the league's startable pool, so a three-team, one-slot
    // fixture drives anything past a handful of picks to the same near-zero
    // and the two columns would tie rather than disagree.
    const adp = new Map<string, AdpEntry>([
      ["w1", full(3)],
      ["w2", full(2)],
      ["w3", full(1)],
    ]);
    const l = league([
      roster(1, "me", ["w1"]),
      roster(2, "t2", ["w2"]),
      roster(3, "t3", ["w3"]),
    ]);

    const { ranks } = rankLeagueLineups(l, "me", board, adp);
    assert.deepEqual(ranks.ros_starters, { rank: 1, of: 3 });
    assert.deepEqual(ranks.capital_starters, { rank: 3, of: 3 });
    assert.deepEqual(ranks.ros_total, { rank: 1, of: 3 });
    assert.deepEqual(ranks.capital_total, { rank: 3, of: 3 });
  });

  test("a narrowed column and a forced board rank on their own numbers", () => {
    // Four columns off one solve: the base ten, one position narrowing, one
    // forced market and one forced draft board — all of them filling the same
    // buffer in turn. Each is checked against what it alone should say.
    const board: RosProjections = {
      qb: projected("qb", ["QB"], { rec: 5 }),
      wr: projected("wr", ["WR"], { rec: 30 }),
      wr2: projected("wr2", ["WR"], { rec: 1 }),
    };
    const l = league([roster(1, "me", ["qb", "wr"]), roster(2, "t2", ["wr2"])], {
      roster_positions: ["QB", "WR", "BN"],
    });
    const { ranks } = rankLeagueLineups(
      l,
      "me",
      board,
      new Map<string, AdpEntry>([["qb", full(1)], ["wr", full(200)], ["wr2", full(2)]]),
      new Map([["wr", 9000]]),
      new Map(),
      [
        {
          key: "dynasty:sf",
          values: new Map([["wr2", 9999]]),
          pickValues: new Map(),
        },
      ],
      [["QB"]],
      [{ key: ":sf", adp: new Map<string, AdpEntry>([["qb", full(1)]]) }],
    );

    // The whole roster on points: the manager is ahead.
    assert.deepEqual(ranks.ros_starters, { rank: 1, of: 2 });
    // Narrowed to quarterbacks, the other roster has none at all — so its total
    // is zero and the manager is still ahead, on a genuinely different column.
    assert.deepEqual(ranks["ros_starters:qb"], { rank: 1, of: 2 });
    // On the league's own KTC board the manager holds the only priced player…
    assert.deepEqual(ranks.ktc_starters, { rank: 1, of: 2 });
    // …and on the forced one, the other roster does.
    assert.deepEqual(ranks["ktc_starters:dynasty:sf"], { rank: 2, of: 2 });
  });
});
