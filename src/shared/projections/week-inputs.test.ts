import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isProjectable } from "./candidates.ts";
import { scoreStatLine } from "./score.ts";
import {
  bucketPlayerRows,
  dayLockedPlayers,
  solveWeekLineups,
  weekProjectionPoints,
} from "./week-inputs.ts";
import type { WeekProjectionInputs } from "./week-inputs.ts";

import type { LeagueTeamsInput } from "./outlook";
import type { LineupWeekStats } from "./queries";

/**
 * The week path's decisions, now that they are reachable without a database.
 *
 * These used to live inside `./outlook`'s I/O, where the only way to exercise a
 * flex rule or a missing player was to have Postgres answer first — so nothing
 * did. The extraction that removed the duplicate read is what makes them
 * assertable, and the assertions are the point of it as much as the saved
 * query: the shared snapshot is only safe if a solve run off it picks the same
 * lineup a solve that read for itself would have.
 */

const SCORING = { rec: 1, rush_yd: 0.1, pass_yd: 0.04 };

/**
 * One week's rows. The points each line is worth under {@link SCORING} are on
 * the right, because every expectation below is arithmetic over them.
 */
const STATS: LineupWeekStats[] = [
  row("qb1", { pass_yd: 300 }), //  12
  row("qb2", { pass_yd: 250 }), //  10
  row("rb1", { rush_yd: 100 }), //  10
  row("rb2", { rush_yd: 50 }), //    5
  row("wr1", { rec: 10 }), //       10
  row("wr2", { rec: 4 }), //         4
  row("te1", { rec: 6 }), //         6
  // Twenty points and no row in the players cache — see the missing-metadata
  // test, which is the one case where the biggest number on the board must not
  // reach a lineup.
  row("ghost", { rec: 20 }), //     20
];

const POSITIONS: Record<string, string[]> = {
  qb1: ["QB"],
  qb2: ["QB"],
  rb1: ["RB"],
  rb2: ["RB"],
  wr1: ["WR"],
  wr2: ["WR"],
  te1: ["TE"],
};

const TEAMS: Record<string, string | null> = {
  qb1: "KC",
  qb2: "BUF",
  rb1: "SF",
  rb2: "DAL",
  wr1: "KC",
  wr2: "BUF",
  te1: "SF",
};

const ROSTER = ["qb1", "qb2", "rb1", "rb2", "wr1", "wr2", "te1", "ghost"];
/** Deliberately a poor lineup, so every swap the solve names is visible. */
const STARTERS = ["qb2", "rb2", "wr2", "rb1", "qb1"];

const INPUTS: WeekProjectionInputs = {
  season: "2025",
  week: 5,
  playerIds: ROSTER,
  stats: STATS,
  positions: POSITIONS,
  teams: TEAMS,
};

function row(
  player_id: string,
  stats: Record<string, number>,
  locked = false,
): LineupWeekStats {
  return { player_id, week: 5, stats, locked };
}

function league(
  rosterPositions: string[],
  overrides: Partial<LeagueTeamsInput> = {},
): LeagueTeamsInput {
  return {
    league_id: "L1",
    rosterPositions,
    scoringSettings: SCORING,
    teams: [{ roster_id: 1, players: ROSTER, starters: STARTERS }],
    ...overrides,
  };
}

/** The one call shape every test here makes — the leagues narrowed as the route does. */
function solve(leagues: LeagueTeamsInput[], inputs = INPUTS) {
  return solveWeekLineups({
    inputs,
    leagues: leagues.filter(isProjectable),
    locked: new Set<string>(),
    kickoffs: null,
    score: (scoring) => (stats) => scoreStatLine(stats, scoring),
  });
}

const SUPERFLEX = ["QB", "RB", "WR", "FLEX", "SUPER_FLEX", "BN"];
const ONE_QB = ["QB", "RB", "WR", "FLEX", "BN"];

describe("the week's projection column", () => {
  test("scores every row the snapshot holds", () => {
    const points = weekProjectionPoints(STATS, (s) => scoreStatLine(s, SCORING));

    assert.deepEqual(
      [...points].sort(),
      [
        ["ghost", 20],
        ["qb1", 12],
        ["qb2", 10],
        ["rb1", 10],
        ["rb2", 5],
        ["te1", 6],
        ["wr1", 10],
        ["wr2", 4],
      ].sort(),
    );
  });

  test("keeps a player whose game is already played", () => {
    // The one decision this column has, and the reason it reads the whole week
    // rather than the horizon: those are points he scored, in the lineup the
    // reader is looking at.
    const played = weekProjectionPoints(
      [row("qb1", { pass_yd: 300 }, true)],
      (s) => scoreStatLine(s, SCORING),
    );
    assert.equal(played.get("qb1"), 12);
  });

  test("a league with no scoring on file scores zero rather than nothing", () => {
    // Not an empty map: the column still names every rostered player, which is
    // what a panel draws. `scoreStatLine` refuses to guess and the row says so.
    const points = weekProjectionPoints(STATS, (s) => scoreStatLine(s, null));
    assert.equal(points.size, STATS.length);
    assert.equal(points.get("qb1"), 0);
  });
});

describe("the snapshot's derived sets", () => {
  test("the day lock is the rows' own flag and nothing else", () => {
    const locked = dayLockedPlayers([
      row("qb1", { pass_yd: 300 }, true),
      row("qb2", { pass_yd: 250 }),
    ]);
    assert.deepEqual([...locked], ["qb1"]);
  });

  test("bucketing keeps every row of a player together", () => {
    const bucketed = bucketPlayerRows([
      { player_id: "a", week: 1, stats: { rec: 1 } },
      { player_id: "b", week: 1, stats: { rec: 2 } },
      { player_id: "a", week: 2, stats: { rec: 3 } },
    ]);
    assert.deepEqual(bucketed.get("a")?.map((r) => r.week), [1, 2]);
    assert.deepEqual(bucketed.get("b")?.map((r) => r.week), [1]);
  });
});

describe("one team's week off a shared snapshot", () => {
  const team = () => solve([league(SUPERFLEX)]).get("L1")?.get(1);

  test("the totals are the lineups, not the roster", () => {
    const lineup = team();
    assert.ok(lineup);
    // Optimal: QB qb1 12, RB rb1 10, WR wr1 10, SUPER_FLEX qb2 10, FLEX te1 6.
    assert.equal(lineup.optimal_points, 48);
    // Current: QB qb2 10, RB rb2 5, WR wr2 4, FLEX rb1 10, SUPER_FLEX qb1 12.
    assert.equal(lineup.current_points, 41);
    assert.equal(lineup.points_left, 7);
  });

  test("the swaps are both ends of the same moves", () => {
    const lineup = team();
    assert.deepEqual([...(lineup?.sit ?? [])].sort(), ["rb2", "wr2"]);
    assert.deepEqual([...(lineup?.start ?? [])].sort(), ["te1", "wr1"]);
  });

  test("the lineup carried back is what the roster is actually starting", () => {
    // Slot order, unrecognised slots dropped — a caller holding `starters`
    // cannot rebuild this, which is why it travels.
    assert.deepEqual(
      team()?.lineup,
      [
        { slot: "QB", player_id: "qb2", points: 10 },
        { slot: "RB", player_id: "rb2", points: 5 },
        { slot: "WR", player_id: "wr2", points: 4 },
        { slot: "FLEX", player_id: "rb1", points: 10 },
        { slot: "SUPER_FLEX", player_id: "qb1", points: 12 },
      ],
    );
  });
});

describe("the slot rules are the slot vocabulary's, not the snapshot's", () => {
  test("a second quarterback starts in a superflex league and nowhere else", () => {
    const superflex = solve([league(SUPERFLEX)]).get("L1")?.get(1);
    const oneQb = solve([league(ONE_QB)]).get("L1")?.get(1);

    assert.ok(superflex?.start.includes("te1"));
    // Optimal in a one-QB league: QB qb1 12, RB rb1 10, WR wr1 10, FLEX te1 6.
    assert.equal(oneQb?.optimal_points, 38);
    // qb2's ten points are unreachable — the flex takes RB/WR/TE only.
    assert.ok(!oneQb?.start.includes("qb2"));
    assert.equal(superflex?.optimal_points, 48);
  });

  test("the flex takes the best of the positions it is open to", () => {
    // te1 (6) over rb2 (5) — the flex is not a running-back slot with a
    // different name.
    const seats = solve([league(SUPERFLEX)]).get("L1")?.get(1);
    assert.ok(seats?.start.includes("te1"));
    assert.ok(seats?.sit.includes("rb2"));
  });
});

describe("a player the cache doesn't know", () => {
  test("is eligible for nothing, whatever he projects", () => {
    // Twenty points, the best number on the board, and no `players` row. He
    // must not be seated: recommending a lineup Sleeper would reject is worse
    // than recommending a lower-scoring one it accepts.
    const lineup = solve([league(SUPERFLEX)]).get("L1")?.get(1);
    const seated = [
      ...(lineup?.lineup.map((seat) => seat.player_id) ?? []),
      ...(lineup?.start ?? []),
    ];
    assert.ok(!seated.includes("ghost"));
  });

  test("is still on the projection column", () => {
    // The two answers are different on purpose: what he is projected for is a
    // fact about the week, where whether he can start is a fact about the
    // players cache.
    const points = weekProjectionPoints(STATS, (s) => scoreStatLine(s, SCORING));
    assert.equal(points.get("ghost"), 20);
  });

  test("keeps his seat in the kickoff ordering rather than being dated", () => {
    // An unknown NFL team reaches `orderLineupByKickoff` as a null kickoff.
    // Asserted through a *known* player with no team on file, since the
    // unknown-position case above never reaches a seat at all.
    const solved = solveWeekLineups({
      inputs: { ...INPUTS, teams: { ...TEAMS, qb2: null } },
      leagues: [league(SUPERFLEX)].filter(isProjectable),
      locked: new Set<string>(),
      kickoffs: new Map([["KC", 4_100_000_000_000]]),
      score: (scoring) => (stats) => scoreStatLine(stats, scoring),
    });

    const seats = solved.get("L1")?.get(1);
    assert.ok(seats?.kickoff_order);
    assert.deepEqual(
      [...seats.kickoff_order].map((seat) => seat.player_id).sort(),
      seats.lineup.map((seat) => seat.player_id).sort(),
    );
  });
});

describe("the reads the snapshot does not make", () => {
  test("no kickoffs is no ordering, never an identity lineup", () => {
    // Null is "no answer": an ordering equal to the lineup would be a claim
    // about a schedule this process never read.
    assert.equal(solve([league(SUPERFLEX)]).get("L1")?.get(1)?.kickoff_order, null);
  });

  test("a locked player holds his slot and costs the lineup its best seat", () => {
    const solved = solveWeekLineups({
      inputs: INPUTS,
      leagues: [league(SUPERFLEX)].filter(isProjectable),
      // wr2 has already played, so his four points are settled and the WR slot
      // is no longer a seat anyone can be moved into.
      locked: new Set(["wr2"]),
      kickoffs: null,
      score: (scoring) => (stats) => scoreStatLine(stats, scoring),
    });

    const seats = solved.get("L1")?.get(1);
    // Never named as a swap: the gap this reports has to be points a manager can
    // still go and get.
    assert.ok(!seats?.sit.includes("wr2"));
    // QB qb1 12, RB rb1 10, WR wr2 4 (held), FLEX wr1 10, SUPER_FLEX qb2 10 —
    // two short of the 48 an unlocked week reaches, because the ten-point
    // receiver now has to take a flex seat te1 would otherwise have had.
    assert.equal(seats?.optimal_points, 46);
    assert.equal(seats?.points_left, 5);
  });
});

describe("one snapshot answers for several leagues", () => {
  test("each league scores the same rows under its own settings", () => {
    // The reason the scoring is not on the snapshot: one stat line is worth two
    // different numbers in two leagues, off one fetch.
    const solved = solve([
      league(SUPERFLEX),
      {
        ...league(SUPERFLEX),
        league_id: "L2",
        // A reception is worth nothing here, so the receivers fall behind.
        scoringSettings: { rush_yd: 0.1, pass_yd: 0.04 },
      },
    ]);

    assert.equal(solved.get("L1")?.get(1)?.optimal_points, 48);
    // QB qb1 12, SUPER_FLEX qb2 10, RB rb1 10, FLEX rb2 5, WR wr1 0.
    assert.equal(solved.get("L2")?.get(1)?.optimal_points, 37);
  });

  test("a best-ball league has nothing to decide", () => {
    const solved = solve([{ ...league(SUPERFLEX), bestBall: true }]);
    const seats = solved.get("L1")?.get(1);

    assert.equal(seats?.points_left, 0);
    assert.deepEqual(seats?.sit, []);
    assert.deepEqual(seats?.start, []);
    assert.equal(seats?.kickoff_order, null);
    // Sleeper seats the best lineup itself, so that is what `current` holds.
    assert.equal(seats?.current_points, 48);
  });

  test("a league with no slots or scoring on file is refused, not guessed at", () => {
    const solved = solve([
      { ...league(SUPERFLEX), league_id: "L2", scoringSettings: null },
      { ...league(SUPERFLEX), league_id: "L3", rosterPositions: null },
    ]);
    assert.equal(solved.has("L2"), false);
    assert.equal(solved.has("L3"), false);
  });
});
