import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";

import { pool } from "@/shared/db";
import {
  clearProjectionMetaCaches,
  getOptimalLineups,
  getWeeklyTeamPoints,
} from "@/shared/projections";

import {
  clearManagerSnapshotCache,
  readManagerOptimalLineups,
  readManagerProjectionInputs,
  readManagerSnapshot,
} from "./manager-snapshot.ts";
import { clearManagerRanksCache, readManagerRanks } from "./ranks-read.ts";

/**
 * How many times one default Manager screen load reads each table.
 *
 * **The second of this repo's two query-count tests, and the exception the
 * testing rule makes room for.** Everything else here keeps logic in pure
 * modules and tests those; a query *count* is a fact about the composition —
 * which loader called which read — and cannot be asserted from any one of them.
 * `./snapshot-cache.test.ts` states the same claim about the memoiser with
 * counting loaders behind it; this file states it about the **real** reads, so
 * that a wiring change which quietly gives one lens its own read is caught by
 * something.
 *
 * It is `stats/league-week.test.ts`'s shape and inherits its two safeguards:
 * `new Pool(…)` does not connect, so importing the I/O modules costs nothing;
 * and the stub **dispatches on the table named in the SQL** rather than on call
 * order, so a read moving between callers cannot quietly re-label itself.
 *
 * What it is protecting against is not an error. Three lenses each reading the
 * whole account's roster graph, each reading every stat line of every remaining
 * week, and two of them solving the identical lineup answers correctly,
 * typechecks, and passes every other test in the repo. It is simply the same
 * work three times over on the web process's own event loop — which is exactly
 * the state this file exists to keep from coming back.
 *
 * ## The numbers
 *
 * Before the shared snapshot, one load of the three default lenses cost:
 * `leagues` ×3, `rosters` ×3, `projections` ×3 and `players` ×3, plus two
 * rest-of-season lineup solves over identical rosters. After it: one of each,
 * and one solve.
 */

const USER = "user-1";
const OTHER = "user-2";
const SEASON = "2025";

const SLOTS = ["QB", "RB", "WR", "FLEX", "BN"];
const SCORING = { rec: 1, rush_yd: 0.1, pass_yd: 0.04 };
const WEEKS = [10, 11];

/** Roster → its players. The manager owns roster 1 of `owned` only. */
const ROSTERS = {
  owned: {
    1: ["qb1", "rb1", "wr1", "te1"],
    2: ["qb2", "rb2", "wr2", "te2"],
  },
  left: {
    1: ["qb3", "rb3", "wr3"],
    2: ["qb4", "rb4", "wr4"],
  },
} as const;

/** Every player's weekly stat line — deliberately uneven, so a lineup can be wrong. */
const STATS: Record<string, Record<string, number>> = {
  qb1: { pass_yd: 300 },
  rb1: { rush_yd: 90, rec: 3 },
  wr1: { rec: 8 },
  te1: { rec: 5 },
  qb2: { pass_yd: 200 },
  rb2: { rush_yd: 40 },
  wr2: { rec: 9 },
  te2: { rec: 2 },
  qb3: { pass_yd: 250 },
  rb3: { rush_yd: 60 },
  wr3: { rec: 6 },
  qb4: { pass_yd: 150 },
  rb4: { rush_yd: 30 },
  wr4: { rec: 4 },
};

const POSITION_OF = (id: string) => id.replace(/\d+$/, "").toUpperCase();

type Counts = {
  leagues: number;
  rosters: number;
  remaining_weeks: number;
  projections: number;
  players: number;
  other: number;
};

const restore = pool.query;

beforeEach(() => {
  // Every cache in this chain is module state that outlives a test.
  clearManagerSnapshotCache();
  clearManagerRanksCache();
  clearProjectionMetaCaches();
});

afterEach(() => {
  pool.query = restore;
});

/**
 * Replace the database and count what each table is asked.
 *
 * `FROM leagues` is matched first on purpose: `FIELDED_A_TEAM_SQL` names
 * `rosters` inside the leagues query, so dispatching on the rosters read first
 * would count that one twice and hide the very duplication this is measuring.
 */
function stub(): Counts {
  const counts: Counts = {
    leagues: 0,
    rosters: 0,
    remaining_weeks: 0,
    projections: 0,
    players: 0,
    other: 0,
  };

  pool.query = (async (text: string) => {
    if (/FROM leagues\b/.test(text)) {
      counts.leagues += 1;
      return {
        rows: Object.keys(ROSTERS).map((league_id) => ({
          league_id,
          roster_positions: SLOTS,
          scoring_settings: SCORING,
          best_ball: false,
          median_match: false,
        })),
      };
    }
    if (/FROM rosters\b/.test(text)) {
      counts.rosters += 1;
      return {
        rows: Object.entries(ROSTERS).flatMap(([league_id, teams]) =>
          Object.entries(teams).map(([roster_id, players]) => ({
            league_id,
            roster_id: Number(roster_id),
            // The manager owns roster 1 of `owned`; every other roster is
            // somebody else's, so `left` is a league they no longer field a
            // team in — on the snapshot, and not among the owned leagues.
            owner_id:
              league_id === "owned" && roster_id === "1" ? USER : OTHER,
            players: [...players],
            starters: [...players].slice(0, 4),
            reserve: [],
            taxi: [],
            settings: {
              wins: Number(roster_id) === 1 ? 2 : 1,
              losses: Number(roster_id) === 1 ? 1 : 2,
              ties: 0,
              fpts: Number(roster_id) === 1 ? 210 : 190,
            },
          })),
        ),
      };
    }
    if (/FROM projections\b/.test(text)) {
      if (/GROUP BY week/.test(text)) {
        counts.remaining_weeks += 1;
        return { rows: WEEKS.map((week) => ({ week })) };
      }
      counts.projections += 1;
      return {
        rows: Object.entries(STATS).flatMap(([player_id, stats]) =>
          WEEKS.map((week) => ({ player_id, week, stats })),
        ),
      };
    }
    if (/FROM players\b/.test(text)) {
      counts.players += 1;
      return {
        rows: Object.keys(STATS).map((player_id) => ({
          player_id,
          position: POSITION_OF(player_id),
          positions: [POSITION_OF(player_id)],
        })),
      };
    }
    counts.other += 1;
    return { rows: [] };
  }) as unknown as typeof pool.query;

  return counts;
}

/**
 * The three requests a default Manager load fires, as their routes make them.
 *
 * The projected ranks read the whole snapshot; the KTC and ADP starter values
 * each want the owned leagues and the aggregate lineup over them. Started
 * together, because that is when they arrive.
 */
function screenLoad(userId = USER, season = SEASON) {
  return Promise.all([
    readManagerRanks(userId, season, { projections: true }),
    readManagerSnapshot(userId, season).then(async (snapshot) => ({
      owned: snapshot.owned,
      lineups: await readManagerOptimalLineups(userId, season),
    })),
    readManagerSnapshot(userId, season).then(async (snapshot) => ({
      owned: snapshot.owned,
      lineups: await readManagerOptimalLineups(userId, season),
    })),
  ]);
}

describe("one default Manager screen load", () => {
  test("reads the manager's roster graph once", async () => {
    // Three times before the shared snapshot: `getManagerLeagueRosters` is two
    // statements over the whole account, and each lens made both.
    const counts = stub();
    await screenLoad();

    assert.equal(counts.leagues, 1);
    assert.equal(counts.rosters, 1);
  });

  test("reads the projection corpus once", async () => {
    // The heaviest read on the screen: every stored stat line of every remaining
    // week for every player on every roster of the account. Three times before.
    const counts = stub();
    await screenLoad();

    assert.equal(counts.projections, 1);
    assert.equal(counts.players, 1);
    // The horizon was already coalesced per season by `getRemainingWeeks`, and
    // still is — counted so a regression there is visible here too.
    assert.equal(counts.remaining_weeks, 1);
  });

  test("hands the KTC and ADP lenses one lineup solve", async () => {
    stub();
    const [, ktc, adp] = await screenLoad();

    // Identity rather than deep equality: two separately-solved lineups would
    // satisfy `deepEqual` and be exactly the duplicated CPU this removes.
    assert.equal(ktc.lineups, adp.lineups);
    assert.equal(ktc.owned, adp.owned);
  });

  test("prices the leagues the manager holds a roster in, and ranks the rest", async () => {
    stub();
    const [ranks, ktc] = await screenLoad();

    // `owned` is the `withOwn` filter both value routes used to apply for
    // themselves — the league the manager has left is on the snapshot and out of
    // the priced set.
    assert.deepEqual(
      ktc.owned.map((l) => l.league_id),
      ["owned"],
    );
    assert.deepEqual([...ktc.lineups.lineups.keys()], ["owned"]);
    // The ranks still see both leagues; only the one the manager is in has a
    // rank set, since `left` contributes no roster of theirs.
    assert.deepEqual(Object.keys(ranks.ranks), ["owned"]);
  });
});

describe("the numbers the lenses report", () => {
  test("are what the unshared reads produce", async () => {
    // **The before/after assertion.** `getOptimalLineups` still reads its own
    // inputs when handed none — that branch *is* the pre-snapshot path — so
    // solving the same leagues both ways and comparing is a direct statement
    // that sharing the reads changed no value.
    stub();
    const shared = await readManagerOptimalLineups(USER, SEASON);

    const { owned } = await readManagerSnapshot(USER, SEASON);
    const unshared = await getOptimalLineups({
      season: SEASON,
      leagues: owned.map((l) => ({
        league_id: l.league_id,
        rosterPositions: l.roster_positions,
        scoringSettings: l.scoring_settings,
        teams: l.teams,
      })),
    });

    assert.deepEqual(shared.weeks, unshared.weeks);
    assert.deepEqual(
      [...shared.lineups].map(([id, teams]) => [id, [...teams]]),
      [...unshared.lineups].map(([id, teams]) => [id, [...teams]]),
    );
    // And the lineup is a real one rather than an empty answer both ways.
    assert.deepEqual(shared.lineups.get("owned")?.get(1), [
      "qb1",
      "rb1",
      "wr1",
      "te1",
    ]);
  });

  test("the weekly solves are what they were, over the shared reads", async () => {
    // The projected ranks are deliberately *not* moved onto the aggregate
    // lineup — their number is one solve per team per week. What they share is
    // the reads, so the totals must be identical either way.
    stub();
    const { leagues } = await readManagerSnapshot(USER, SEASON);
    const asLeagues = leagues.map((l) => ({
      league_id: l.league_id,
      rosterPositions: l.roster_positions,
      scoringSettings: l.scoring_settings,
      teams: l.teams,
    }));

    const shared = await getWeeklyTeamPoints({
      season: SEASON,
      leagues: asLeagues,
      inputs: await readManagerProjectionInputs(USER, SEASON),
    });
    const unshared = await getWeeklyTeamPoints({
      season: SEASON,
      leagues: asLeagues,
    });

    assert.deepEqual(shared.weeks, unshared.weeks);
    assert.deepEqual(
      [...shared.points].map(([id, teams]) => [id, [...teams]]),
      [...unshared.points].map(([id, teams]) => [id, [...teams]]),
    );
    assert.deepEqual(
      [...shared.bench].map(([id, teams]) => [id, [...teams]]),
      [...unshared.bench].map(([id, teams]) => [id, [...teams]]),
    );
    assert.ok((shared.points.get("owned")?.get(1) ?? 0) > 0);
  });

  test("the ranks payload keeps its shape", async () => {
    // The route annotates its response with `ManagerRanksPayload` and nothing
    // about that moved; this is the runtime half of the same claim.
    stub();
    const [ranks] = await screenLoad();

    assert.deepEqual(Object.keys(ranks).sort(), ["ranks", "season", "weeks"]);
    assert.equal(ranks.season, SEASON);
    assert.deepEqual(ranks.weeks, WEEKS);
    assert.deepEqual(Object.keys(ranks.ranks.owned).sort(), [
      "points",
      "proj",
      "proj_bench",
      "standing",
    ]);
    assert.deepEqual(ranks.ranks.owned.standing, { rank: 1, of: 2 });
    assert.deepEqual(ranks.ranks.owned.points, { rank: 1, of: 2, pointsFor: 210 });
  });

  test("`?projections=0` still reads no projections at all", async () => {
    // The cheap half of the ranks is off the rosters the snapshot already has,
    // so opting out must still cost nothing beyond them.
    const counts = stub();
    const ranks = await readManagerRanks(USER, SEASON, { projections: false });

    assert.equal(counts.projections, 0);
    assert.equal(counts.players, 0);
    assert.deepEqual(ranks.weeks, []);
    assert.equal(ranks.ranks.owned.proj, null);
  });
});

describe("whose snapshot it is", () => {
  test("two managers never share one", async () => {
    const counts = stub();
    await Promise.all([screenLoad(USER), screenLoad(OTHER)]);

    // Two accounts, two of everything — and no cross-user answer: the other
    // manager owns a roster in both leagues, so their priced set is both.
    assert.equal(counts.leagues, 2);
    assert.equal(counts.rosters, 2);
    assert.equal(counts.projections, 2);

    const mine = await readManagerSnapshot(USER, SEASON);
    const theirs = await readManagerSnapshot(OTHER, SEASON);
    assert.deepEqual(mine.owned.map((l) => l.league_id), ["owned"]);
    assert.deepEqual(theirs.owned.map((l) => l.league_id), ["owned", "left"]);
  });

  test("two seasons never share one", async () => {
    const counts = stub();
    await Promise.all([
      readManagerSnapshot(USER, SEASON),
      readManagerSnapshot(USER, "2024"),
    ]);

    assert.equal(counts.leagues, 2);
    const past = await readManagerSnapshot(USER, "2024");
    assert.equal(past.season, "2024");
  });
});

describe("a failed read", () => {
  test("does not poison the cache", async () => {
    // A rejection is never stored and never lingers (`TtlPromiseCache`), which
    // matters most here: these entries live seconds, and a poisoned one would
    // blank a Manager screen's columns for every reload inside the window.
    let broken = true;
    const counts = stub();
    const working = pool.query;
    pool.query = (async (text: string, values?: unknown[]) => {
      if (broken && /FROM projections\b/.test(text) && !/GROUP BY week/.test(text)) {
        throw new Error("projections read failed");
      }
      return (working as (t: string, v?: unknown[]) => Promise<unknown>)(text, values);
    }) as unknown as typeof pool.query;

    await assert.rejects(
      readManagerOptimalLineups(USER, SEASON),
      /projections read failed/,
    );

    broken = false;
    const lineups = await readManagerOptimalLineups(USER, SEASON);
    assert.deepEqual(lineups.weeks, WEEKS);
    // The rosters read is still the one the failed attempt made: a projections
    // failure costs what is computed from it and nothing above it.
    assert.equal(counts.leagues, 1);
    assert.equal(counts.rosters, 1);
  });

  test("leaves the rosters answering, so the value lenses still price", async () => {
    stub();
    const working = pool.query;
    pool.query = (async (text: string, values?: unknown[]) => {
      if (/FROM projections\b/.test(text) && !/GROUP BY week/.test(text)) {
        throw new Error("projections read failed");
      }
      return (working as (t: string, v?: unknown[]) => Promise<unknown>)(text, values);
    }) as unknown as typeof pool.query;

    // Exactly what the KTC and ADP routes do with a failed solve: catch it, lose
    // the split and the rank, keep the totals.
    const snapshot = await readManagerSnapshot(USER, SEASON);
    const lineups = await readManagerOptimalLineups(USER, SEASON).catch(() => null);

    assert.equal(lineups, null);
    assert.equal(snapshot.owned.length, 1);

    // And the ranks degrade the same way rather than failing: two of their four
    // numbers come straight off these rosters.
    const ranks = await readManagerRanks(USER, SEASON, { projections: true });
    assert.deepEqual(ranks.weeks, []);
    assert.deepEqual(ranks.ranks.owned.standing, { rank: 1, of: 2 });
    assert.equal(ranks.ranks.owned.proj, null);
  });
});
