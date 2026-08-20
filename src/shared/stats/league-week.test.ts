import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { pool } from "@/shared/db";
import type { LeagueTeam } from "@/shared/manager";
import { getWeekLineups } from "@/shared/projections";
import http from "@thelab/http";

import { getLeagueWeekView } from "./league-week.ts";

/**
 * How many times one League Week request reads each table.
 *
 * **The exception to this repo's testing rule, and it is the whole point.**
 * Everything else here keeps logic in pure modules and tests those; a query
 * *count* is a fact about the composition file, which cannot be asserted from
 * one. So this drives the real loaders with `pool.query` and the Sleeper client
 * replaced by counting stubs — nothing connects, and what comes back is a
 * fixture rather than a database.
 *
 * It is the same shape of claim `league-routes.test.ts` makes about which
 * loaders a route names, for the same reason: reading the week's projections
 * twice is not an error. It answers, it typechecks, it passes every other test
 * in the repo, and it costs a second scan of the heaviest read on the panel —
 * which is exactly the state this file exists to keep from coming back.
 *
 * The lineup rules those reads feed are asserted in
 * `projections/week-inputs.test.ts`, where they are pure. Nothing here re-tests
 * them beyond the handful of numbers that prove the shared snapshot reaches the
 * solve intact.
 */

const SEASON = "2025";
const SCORING = { rec: 1, rush_yd: 0.1, pass_yd: 0.04 };
const SLOTS = ["QB", "RB", "WR", "FLEX", "SUPER_FLEX", "BN"];

const ROSTER = ["qb1", "qb2", "rb1", "rb2", "wr1", "wr2", "te1", "ghost"];
const STARTERS = ["qb2", "rb2", "wr2", "rb1", "qb1"];

/** Every stat line, with its points under {@link SCORING} on the right. */
const PROJECTIONS = [
  projection("qb1", { pass_yd: 300 }), //  12
  projection("qb2", { pass_yd: 250 }), //  10
  projection("rb1", { rush_yd: 100 }), //  10
  projection("rb2", { rush_yd: 50 }), //    5
  projection("wr1", { rec: 10 }), //       10
  projection("wr2", { rec: 4 }), //         4
  projection("te1", { rec: 6 }), //         6
  // No `players` row — see the missing-metadata assertion below.
  projection("ghost", { rec: 20 }), //     20
];

/** One `players` row per known player: eligibility and NFL team together. */
const PLAYERS = [
  player("qb1", "QB", "KC"),
  player("qb2", "QB", "BUF"),
  player("rb1", "RB", "SF"),
  player("rb2", "RB", "DAL"),
  player("wr1", "WR", "KC"),
  player("wr2", "WR", "BUF"),
  player("te1", "TE", "SF"),
];

/** Far enough ahead that nothing is locked, whenever this runs. */
const KICKOFF = Date.UTC(2099, 8, 7, 17);

const SCORES = [
  { start_time: KICKOFF, metadata: { home_team: "KC", away_team: "BUF" } },
  {
    start_time: KICKOFF + 3 * 60 * 60 * 1000,
    metadata: { home_team: "SF", away_team: "DAL" },
  },
];

function projection(player_id: string, stats: Record<string, number>) {
  return { player_id, week: 0, stats, locked: false };
}

function player(player_id: string, position: string, team: string) {
  return { player_id, position, team, positions: [position] };
}

/** What `getLeagueWeekView` needs of a team; the rest of `LeagueTeam` is chrome. */
function team(roster_id: number, players: string[], starters: string[]) {
  return {
    roster_id,
    owner_id: `owner-${roster_id}`,
    manager: null,
    record: { wins: 0, losses: 0, ties: 0 },
    fpts: 0,
    fpts_against: 0,
    players,
    starters,
    reserve: [],
    taxi: [],
    picks: [],
  } satisfies LeagueTeam;
}

type Counts = {
  projections: number;
  players: number;
  player_week_stats: number;
  schedule: number;
  other: number;
};

const restore = { query: pool.query, get: http.get };

afterEach(() => {
  pool.query = restore.query;
  http.get = restore.get;
});

/**
 * Replace the two things a week read reaches outside this process for, and
 * count what each is asked.
 *
 * Dispatched on the table named in the SQL rather than on call order, so a read
 * moving between callers doesn't quietly re-label itself — the counts are per
 * table because that is what the claim is about.
 */
function stub(week: number): Counts {
  const counts: Counts = {
    projections: 0,
    players: 0,
    player_week_stats: 0,
    schedule: 0,
    other: 0,
  };

  pool.query = (async (text: string) => {
    if (/FROM projections\b/.test(text)) {
      counts.projections += 1;
      return { rows: PROJECTIONS.map((r) => ({ ...r, week })) };
    }
    if (/FROM players\b/.test(text)) {
      counts.players += 1;
      return { rows: PLAYERS };
    }
    if (/FROM player_week_stats\b/.test(text)) {
      counts.player_week_stats += 1;
      return { rows: [] };
    }
    counts.other += 1;
    return { rows: [] };
  }) as unknown as typeof pool.query;

  http.get = (async () => {
    counts.schedule += 1;
    return { data: SCORES };
  }) as unknown as typeof http.get;

  return counts;
}

/** One league's week, as the route asks for it. */
function readWeek(week: number) {
  return getLeagueWeekView({
    leagueId: `league-${week}`,
    season: SEASON,
    week,
    teams: [team(1, ROSTER, STARTERS), team(2, ROSTER, STARTERS)],
    rosterPositions: SLOTS,
    scoringSettings: SCORING,
    bestBall: false,
    medianMatch: false,
  });
}

describe("one League Week request", () => {
  test("reads the week's projection rows once", async () => {
    // The duplicate this file exists for: the per-player column and the lineup
    // solve want the same rows of the same week for the same rosters, and used
    // to ask for them separately.
    const counts = stub(11);
    await readWeek(11);
    assert.equal(counts.projections, 1);
  });

  test("reads the players table once", async () => {
    // Eligibility and the NFL team arrive on one row, so asking twice was
    // arithmetic rather than judgement — see `getPlayerLineupMeta`.
    const counts = stub(12);
    await readWeek(12);
    assert.equal(counts.players, 1);
  });

  test("still answers both halves off that one read", async () => {
    stub(13);
    const view = await readWeek(13);

    // The projection column: every rostered player, the unrostered-by-the-cache
    // one included.
    assert.equal(view.projection.get("qb1"), 12);
    assert.equal(view.projection.get("ghost"), 20);
    assert.equal(view.projection.size, PROJECTIONS.length);

    // The lineups: both teams solved, off the same rows.
    const first = view.team_projection.get(1);
    assert.equal(first?.optimal, 48);
    assert.equal(first?.current, 41);
    assert.equal(first?.points_left, 7);
    assert.equal(view.team_projection.get(2)?.optimal, 48);
  });

  test("a player the cache doesn't know never reaches a lineup", async () => {
    // Twenty points and no `players` row. The consolidated metadata read must
    // keep this exactly as it was: eligible for nothing, so never seated.
    stub(14);
    const view = await readWeek(14);
    const lineup = view.team_projection.get(1);

    assert.ok(!lineup?.lineup.some((seat) => seat.player_id === "ghost"));
    assert.ok(!lineup?.start.includes("ghost"));
  });

  test("the kickoff ordering still answers, off the panel's own schedule read", async () => {
    // The NFL team half of that join moved onto the snapshot, so the ordering
    // now costs the schedule and nothing else.
    stub(15);
    const view = await readWeek(15);
    const lineup = view.team_projection.get(1);

    assert.ok(lineup?.kickoff_order);
    assert.deepEqual(
      lineup.kickoff_order.map((seat) => seat.player_id).sort(),
      lineup.lineup.map((seat) => seat.player_id).sort(),
    );
    assert.ok(view.games.has("KC"));
  });
});

describe("a league with no scoring on file", () => {
  test("still answers a projection column, and reads no player metadata", async () => {
    // The read the snapshot can skip: there is no lineup to solve, so the
    // eligibility and team maps nothing will open are not fetched — this league
    // stays at the one query it has always cost.
    const counts = stub(16);
    const view = await getLeagueWeekView({
      leagueId: "league-16",
      season: SEASON,
      week: 16,
      teams: [team(1, ROSTER, STARTERS)],
      rosterPositions: SLOTS,
      scoringSettings: null,
      bestBall: false,
      medianMatch: false,
    });

    assert.equal(counts.projections, 1);
    assert.equal(counts.players, 0);
    assert.equal(view.team_projection.size, 0);
    // Scored against nothing, which is `scoreStatLine`'s refusal to guess —
    // never an absent column.
    assert.equal(view.projection.get("qb1"), 0);
    assert.equal(view.projection.size, PROJECTIONS.length);
  });
});

describe("getWeekLineups outside a League Week request", () => {
  const leagues = (id: string) => [
    {
      league_id: id,
      rosterPositions: SLOTS,
      scoringSettings: SCORING,
      bestBall: false,
      teams: [{ roster_id: 1, players: ROSTER, starters: STARTERS }],
    },
  ];

  test("reads a snapshot of its own when handed none", async () => {
    // The lineup checker's own route passes no snapshot, so the reads have to
    // still be there — a shared-inputs parameter that quietly became required
    // would answer that page with empty lineups.
    const counts = stub(17);
    const first = await getWeekLineups({
      season: SEASON,
      week: 17,
      leagues: leagues("A"),
    });

    assert.equal(counts.projections, 1);
    assert.equal(counts.players, 1);
    assert.equal(first.teams.get("A")?.get(1)?.optimal_points, 48);
  });

  test("two independent calls each read for themselves", async () => {
    // Nothing is remembered between them: the snapshot is a per-request object,
    // not a cache with no key that could say whose week it holds.
    const counts = stub(18);
    const [first, second] = await Promise.all([
      getWeekLineups({ season: SEASON, week: 18, leagues: leagues("A") }),
      getWeekLineups({ season: SEASON, week: 18, leagues: leagues("B") }),
    ]);

    assert.equal(counts.projections, 2);
    assert.equal(counts.players, 2);
    assert.equal(
      first.teams.get("A")?.get(1)?.optimal_points,
      second.teams.get("B")?.get(1)?.optimal_points,
    );
  });

  test("a week with nothing stored is absence, not a lineup of zeros", async () => {
    stub(19);
    pool.query = (async (text: string) => {
      if (/FROM players\b/.test(text)) return { rows: PLAYERS };
      return { rows: [] };
    }) as unknown as typeof pool.query;

    const lineups = await getWeekLineups({
      season: SEASON,
      week: 19,
      leagues: leagues("A"),
    });
    assert.equal(lineups.teams.size, 0);
  });
});
