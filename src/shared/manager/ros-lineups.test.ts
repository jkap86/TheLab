import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { solveLeagueLineup } from "./ros-lineups.ts";
import type { RosLineupLeague } from "./ros-lineups.ts";
import type { RosProjections, SeasonStats } from "../projections/ros.ts";
import type { AdpEntry } from "./adp-value.ts";

/** A 2-team league starting QB/RB/FLEX, so pools and seats stay countable. */
function league(players: string[], overrides: Partial<RosLineupLeague> = {}): RosLineupLeague {
  return {
    league_id: "L1",
    total_rosters: 2,
    roster_positions: ["QB", "RB", "FLEX", "BN"],
    scoring_settings: { rec: 1, rec_yd: 0.1 },
    players,
    ...overrides,
  };
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

describe("solveLeagueLineup", () => {
  test("seats by projected points under the league's own scoring", () => {
    const board: RosProjections = {
      wr1: projected("wr1", ["WR"], { rec: 10, rec_yd: 100 }), // 20 pts
      wr2: projected("wr2", ["WR"], { rec: 5, rec_yd: 50 }), // 10 pts
      qb: projected("qb", ["QB"], { rec: 1 }), // 1 pt
      rb: projected("rb", ["RB"], { rec: 2 }), // 2 pts
    };
    const result = solveLeagueLineup(league(["qb", "rb", "wr1", "wr2"]), board, NO_ADP);

    assert.deepEqual(
      result.starters.map((s) => [s.slot, s.player?.player_id]),
      [
        ["QB", "qb"],
        ["RB", "rb"],
        ["FLEX", "wr1"],
      ],
    );
    assert.deepEqual(
      result.bench.map((p) => p.player_id),
      ["wr2"],
    );
    assert.equal(result.projected_points, 23);
  });

  test("an unprojected player carries null points, never zero", () => {
    const board: RosProjections = { rb: unprojected("rb", ["RB"]) };
    const result = solveLeagueLineup(league(["rb"]), board, NO_ADP);
    const rb = result.starters.find((s) => s.slot === "RB")!.player!;
    assert.equal(rb.points, null);
    assert.equal(result.projected_points, 0);
  });

  test("draft capital decides only where projections say nothing", () => {
    // Two unprojected RBs: the earlier pick starts. A projected third RB with a
    // tiny score still outranks both for the other seat — one projected point
    // must never be outbid by any amount of draft capital.
    const board: RosProjections = {
      early: unprojected("early", ["RB"]),
      late: unprojected("late", ["RB"]),
      proj: projected("proj", ["RB"], { rec: 0.5 }), // 0.5 pts
    };
    const adp = new Map([
      ["early", full(1)],
      ["late", full(30)],
    ]);
    const result = solveLeagueLineup(
      league(["early", "late", "proj"], { roster_positions: ["RB", "FLEX", "BN"] }),
      board,
      adp,
    );

    assert.deepEqual(
      result.starters.map((s) => [s.slot, s.player?.player_id]),
      [
        ["RB", "proj"],
        ["FLEX", "early"],
      ],
    );
    assert.deepEqual(
      result.bench.map((p) => p.player_id),
      ["late"],
    );
  });

  test("with no projections at all the whole solve runs on draft capital", () => {
    const result = solveLeagueLineup(
      league(["a", "b"], { roster_positions: ["FLEX", "BN"] }),
      {
        a: unprojected("a", ["WR"]),
        b: unprojected("b", ["WR"]),
      },
      new Map([
        ["a", full(40)],
        ["b", full(2)],
      ]),
    );
    assert.equal(result.starters[0].player?.player_id, "b");
    assert.equal(result.projected_points, 0);
  });

  test("the payload carries real values, not the composite score", () => {
    const result = solveLeagueLineup(
      league(["a"], { roster_positions: ["FLEX", "BN"] }),
      { a: unprojected("a", ["WR"]) },
      new Map([["a", full(1)]]),
    );
    const seated = result.starters[0].player!;
    // adp 1 is the peak; the tiebreak epsilon must not leak into either field.
    assert.equal(seated.points, null);
    assert.equal(seated.adp_value, 10_000);
  });

  test("a player the feed doesn't know rides the bench with nothing to say", () => {
    const result = solveLeagueLineup(
      league(["ghost", "wr"], { roster_positions: ["FLEX", "BN"] }),
      { wr: projected("wr", ["WR"], { rec: 1 }) },
      NO_ADP,
    );
    assert.equal(result.starters[0].player?.player_id, "wr");
    const ghost = result.bench[0];
    assert.equal(ghost.player_id, "ghost");
    assert.equal(ghost.name, null);
    assert.deepEqual(ghost.positions, []);
    assert.equal(ghost.points, null);
  });

  test("padded roster entries are not players and unknown slots are named", () => {
    const result = solveLeagueLineup(
      league(["wr", "wr", "0", ""], { roster_positions: ["FLEX", "OP", "BN"] }),
      { wr: projected("wr", ["WR"], { rec: 1 }) },
      NO_ADP,
    );
    assert.equal(result.starters.length, 1);
    assert.deepEqual(result.unknown_slots, ["OP"]);
    assert.deepEqual(result.bench, []);
  });

  test("bench orders by the same key the solver seated by", () => {
    const board: RosProjections = {
      s1: projected("s1", ["WR"], { rec: 9 }),
      b1: projected("b1", ["WR"], { rec: 5 }),
      b2: unprojected("b2", ["WR"]),
      b3: unprojected("b3", ["WR"]),
    };
    const result = solveLeagueLineup(
      league(["b3", "b2", "b1", "s1"], { roster_positions: ["FLEX", "BN"] }),
      board,
      new Map([
        ["b2", full(5)],
        ["b3", full(90)],
      ]),
    );
    assert.deepEqual(
      result.bench.map((p) => p.player_id),
      ["b1", "b2", "b3"],
    );
  });
});

describe("solveLeagueLineup — season-to-date points", () => {
  /** A line off the stats feed: what he has already scored. */
  const played = (
    id: string,
    positions: string[],
    stats: Record<string, number>,
    weeks: number[] = [1, 2],
  ): SeasonStats[string] => ({
    player_id: id,
    stats,
    weeks,
    name: `Name ${id}`,
    positions,
    team: null,
  });

  test("is scored by the league's own settings, like the projection beside it", () => {
    // The whole claim in one assertion: two boards, one scoring table, two
    // fields on one player — which is what makes the two figures comparable
    // rather than merely adjacent.
    const board: RosProjections = {
      wr1: projected("wr1", ["WR"], { rec: 10, rec_yd: 100 }),
    };
    const season: SeasonStats = {
      wr1: played("wr1", ["WR"], { rec: 40, rec_yd: 500 }),
    };
    const result = solveLeagueLineup(
      league(["wr1"]),
      board,
      NO_ADP,
      new Map(),
      season,
    );
    const wr1 = result.starters.find((s) => s.player?.player_id === "wr1")!.player!;
    assert.equal(wr1.points, 20);
    assert.equal(wr1.season_points, 90);
  });

  test("a player with no stat line is null, and a scoreless one is zero", () => {
    // Null is not zero here more sharply than anywhere else on the wire: the
    // stats feed carries only players with a line, so a stashed rookie has no
    // row at all where a starter held scoreless has one summing to nothing.
    const board: RosProjections = {
      stash: projected("stash", ["WR"], { rec: 1 }),
      held: projected("held", ["WR"], { rec: 1 }),
      listed: projected("listed", ["WR"], { rec: 1 }),
    };
    const season: SeasonStats = {
      held: played("held", ["WR"], {}, [1, 2]),
      // **On the board with no real week**, which is the state the fold
      // actually produces: `createRosFold` emits a row for every id the feed
      // mentioned, so a player it knows and has no line for is present with an
      // empty `weeks` — not absent. Read on the row's existence rather than on
      // `weeks`, he would score a confident zero.
      listed: played("listed", ["WR"], {}, []),
    };
    const solved = solveLeagueLineup(
      league(["stash", "held", "listed"]),
      board,
      NO_ADP,
      new Map(),
      season,
    );
    const by = new Map(
      [...solved.starters.flatMap((s) => (s.player ? [s.player] : [])), ...solved.bench].map(
        (p) => [p.player_id, p],
      ),
    );
    assert.equal(by.get("held")!.season_points, 0);
    assert.equal(by.get("stash")!.season_points, null);
    assert.equal(by.get("listed")!.season_points, null);
  });

  test("an empty board leaves every season figure null, never zero", () => {
    const board: RosProjections = { wr1: projected("wr1", ["WR"], { rec: 5 }) };
    const solved = solveLeagueLineup(league(["wr1"]), board, NO_ADP);
    assert.equal(solved.starters[2]!.player!.season_points, null);
  });

  test("it does not seat anybody — the lineup is a decision about the weeks ahead", () => {
    // `wr2` has banked four times what `wr1` has and is projected for a
    // quarter of it. Read into the seating he would take the flex over a
    // healthy starter on the strength of games that are already over.
    const board: RosProjections = {
      wr1: projected("wr1", ["WR"], { rec: 20 }),
      wr2: projected("wr2", ["WR"], { rec: 5 }),
    };
    const season: SeasonStats = {
      wr1: played("wr1", ["WR"], { rec: 10 }),
      wr2: played("wr2", ["WR"], { rec: 400 }),
    };
    const withSeason = solveLeagueLineup(
      league(["wr1", "wr2"]),
      board,
      NO_ADP,
      new Map(),
      season,
    );
    const without = solveLeagueLineup(league(["wr1", "wr2"]), board, NO_ADP);
    assert.equal(withSeason.starters[2]!.player!.player_id, "wr1");
    assert.deepEqual(
      withSeason.starters.map((s) => s.player?.player_id),
      without.starters.map((s) => s.player?.player_id),
    );
    assert.equal(withSeason.projected_points, without.projected_points);
  });

  test("the stat board names a player the projections feed does not", () => {
    // A past season reads no projections at all, so without this nobody has a
    // position and every roster lands whole on the bench — on the one page
    // where season totals are the only lens that answers.
    const season: SeasonStats = {
      qb: played("qb", ["QB"], { rec: 3 }),
      rb: played("rb", ["RB"], { rec: 2 }),
    };
    const solved = solveLeagueLineup(
      league(["qb", "rb"]),
      {},
      NO_ADP,
      new Map(),
      season,
    );
    assert.deepEqual(
      solved.starters.map((s) => [s.slot, s.player?.player_id]),
      [
        ["QB", "qb"],
        ["RB", "rb"],
        ["FLEX", undefined],
      ],
    );
    assert.equal(solved.starters[0]!.player!.name, "Name qb");
    // Still unprojected: the fallback names him, it does not price his week.
    assert.equal(solved.starters[0]!.player!.points, null);
    assert.equal(solved.starters[0]!.player!.season_points, 3);
  });

  test("the projections feed wins every field it has an answer for", () => {
    // **The fallback fires on absence and never on disagreement**, which is one
    // rule read three ways: a null name, an empty position list and a null team
    // are each the projections board saying nothing rather than saying no. The
    // team is the one where that distinction does work — `RosPlayerProjection`
    // documents its null as "no real row named one", so it is absent exactly
    // for the unprojected, and the board that *did* see him play is then the
    // only thing that knows where.
    const board: RosProjections = {
      known: projected("known", ["WR"], { rec: 1 }),
      // A row with a name and positions but no real projection, which is what
      // a bye-long or wholly unprojected player looks like on this feed.
      unplayed: unprojected("unplayed", ["WR"]),
    };
    const season: SeasonStats = {
      known: played("known", ["TE"], { rec: 9 }),
      unplayed: played("unplayed", ["TE"], { rec: 9 }),
    };
    season.known.name = "Stale Name";
    season.known.team = "AAA";
    season.unplayed.team = "BBB";

    const solved = solveLeagueLineup(
      league(["known", "unplayed"]),
      board,
      NO_ADP,
      new Map(),
      season,
    );
    const by = new Map(
      [
        ...solved.starters.flatMap((s) => (s.player ? [s.player] : [])),
        ...solved.bench,
      ].map((p) => [p.player_id, p]),
    );
    // Named and placed by the projections feed, which has both.
    assert.equal(by.get("known")!.name, "Name known");
    assert.deepEqual(by.get("known")!.positions, ["WR"]);
    // …and its `team` is genuinely absent on both of these, so both take the
    // stat board's, which is where each was last seen playing.
    assert.equal(by.get("known")!.team, "AAA");
    assert.equal(by.get("unplayed")!.team, "BBB");
    assert.deepEqual(by.get("unplayed")!.positions, ["WR"]);
  });
});
