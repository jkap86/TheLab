import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { pool } from "@/shared/db";
import { clearProjectionMetaCaches } from "@/shared/projections";

import { clearManagerSnapshotCache } from "./manager-snapshot.ts";
import { clearManagerRanksCache, readManagerRanks } from "./ranks-read.ts";

/**
 * What a **failed** projections read does to a manager's ranks, and what it must
 * not do.
 *
 * The second file in this repo to drive real loaders with `pool.query` replaced
 * by a counting stub, and it is here for the reason `stats/league-week.test.ts`
 * is: the claim spans a composition file and a process cache, so no pure module
 * can carry it. `new Pool(…)` does not connect and the `@/*` alias resolves under
 * `tsx`, so importing the I/O module costs nothing; the stub dispatches on the
 * table named in the SQL rather than on call order, so a read moving between
 * callers cannot quietly re-label itself.
 *
 * **The thing being asserted is a distinction that used to not exist.** The
 * projections half of this payload is optional on purpose — the record and
 * points ranks come off rosters already in hand, and failing the whole request
 * would throw away answers nobody needed to lose — but the fallback was the
 * *empty* triple `getWeeklyTeamPoints` itself returns with nothing to project.
 * So a database blip and a manager whose season is over produced the identical
 * payload, and that payload went into fifteen minutes of process cache as a
 * fact. Every test here is one half of telling those two apart.
 */

const USER = "77777777777777777";
const LEAGUE = "1000000000000000001";
const SLOTS = ["QB", "RB", "WR", "FLEX", "BN"];
const SCORING = { rec: 1, rush_yd: 0.1, pass_yd: 0.04 };

/** Two teams, so a rank has something to be a rank *of*. */
const ROSTERS = [
  roster(1, USER, ["qb1", "rb1", "wr1", "rb2"], { wins: 3, fpts: 400 }),
  roster(2, "other", ["qb2", "rb3", "wr2", "wr3"], { wins: 1, fpts: 300 }),
];

const PLAYERS = [
  player("qb1", "QB"),
  player("qb2", "QB"),
  player("rb1", "RB"),
  player("rb2", "RB"),
  player("rb3", "RB"),
  player("wr1", "WR"),
  player("wr2", "WR"),
  player("wr3", "WR"),
];

/** One week of projections, weighted so the two rosters do not tie. */
const PROJECTIONS = [
  stat("qb1", { pass_yd: 300 }),
  stat("qb2", { pass_yd: 150 }),
  stat("rb1", { rush_yd: 120 }),
  stat("rb2", { rush_yd: 60 }),
  stat("rb3", { rush_yd: 30 }),
  stat("wr1", { rec: 9 }),
  stat("wr2", { rec: 4 }),
  stat("wr3", { rec: 2 }),
];

function roster(
  roster_id: number,
  owner_id: string,
  players: string[],
  settings: { wins: number; fpts: number },
) {
  return {
    league_id: LEAGUE,
    roster_id,
    owner_id,
    players,
    starters: players.slice(0, 3),
    reserve: [],
    taxi: [],
    settings: { wins: settings.wins, losses: 0, ties: 0, fpts: settings.fpts },
  };
}

function player(player_id: string, position: string) {
  return { player_id, position, positions: [position] };
}

function stat(player_id: string, stats: Record<string, number>) {
  return { player_id, week: 1, stats };
}

type Counts = { leagues: number; rosters: number; weeks: number; stats: number };

const restore = pool.query;

afterEach(() => {
  pool.query = restore;
  clearManagerRanksCache();
  // The manager snapshot holds this account's roster graph for a few seconds so
  // the three lenses of one screen load share it; dropped here for the reason
  // the ranks cache is, since a season reused across tests would otherwise be
  // answered from the previous test's stub.
  clearManagerSnapshotCache();
  // `getRemainingWeeks` is memoised per season for five minutes, so a season
  // reused across tests would answer from the previous test's stub.
  clearProjectionMetaCaches();
});

/**
 * Answer every read one ranks request makes, optionally throwing from the
 * projections stat lines — which is where a busy database actually fails.
 *
 * `failStats` is read on each call rather than captured, so one stub can serve a
 * request that fails and the retry after it that doesn't. That is the whole
 * "retryable" claim: the same process, the same key, a second later.
 */
function stub(options: { failStats: () => boolean }): Counts {
  const counts: Counts = { leagues: 0, rosters: 0, weeks: 0, stats: 0 };

  pool.query = (async (text: string) => {
    // Checked before `rosters`, because the leagues query's own
    // `FIELDED_A_TEAM_SQL` names that table in a subquery.
    if (/FROM leagues l\b/.test(text)) {
      counts.leagues += 1;
      return {
        rows: [
          {
            league_id: LEAGUE,
            roster_positions: SLOTS,
            scoring_settings: SCORING,
            best_ball: false,
            median_match: false,
          },
        ],
      };
    }
    if (/FROM rosters\s+WHERE league_id = ANY/.test(text)) {
      counts.rosters += 1;
      return { rows: ROSTERS };
    }
    if (/FROM projections\b/.test(text) && /GROUP BY week/.test(text)) {
      counts.weeks += 1;
      return { rows: [{ week: 1 }] };
    }
    if (/FROM projections\b/.test(text)) {
      counts.stats += 1;
      if (options.failStats()) throw new Error("canceling statement due to statement timeout");
      return { rows: PROJECTIONS };
    }
    if (/FROM players\b/.test(text)) return { rows: PLAYERS };
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }) as typeof pool.query;

  return counts;
}

describe("a manager's ranks when the projections read answers", () => {
  test("reports the projections half as computed, and caches it", async () => {
    const counts = stub({ failStats: () => false });

    const first = await readManagerRanks(USER, "2026", { projections: true });
    assert.equal(first.projections, "ok");
    assert.deepEqual(first.weeks, [1]);
    // The manager's roster projects higher than the other one, so both the
    // starter and the bench ranks are real answers rather than nulls.
    assert.equal(first.ranks[LEAGUE]?.proj?.rank, 1);
    assert.equal(first.ranks[LEAGUE]?.standing?.rank, 1);

    const second = await readManagerRanks(USER, "2026", { projections: true });
    assert.equal(second, first, "a good answer is served from the cache");
    assert.equal(counts.leagues, 1);
    assert.equal(counts.stats, 1);
  });
});

describe("a manager's ranks when the projections read throws", () => {
  test("is not reported as a manager with no projections", async () => {
    stub({ failStats: () => true });

    const payload = await readManagerRanks(USER, "2027", { projections: true });

    // The shape is the degraded one — and that is exactly why the status has to
    // be on the payload: `weeks: []` with a null `proj` is also what a finished
    // season legitimately answers.
    assert.equal(payload.projections, "error");
    assert.deepEqual(payload.weeks, []);
    assert.equal(payload.ranks[LEAGUE]?.proj, null);
    assert.equal(payload.ranks[LEAGUE]?.proj_bench, null);
  });

  test("still answers the two ranks it never needed projections for", async () => {
    stub({ failStats: () => true });

    const payload = await readManagerRanks(USER, "2028", { projections: true });

    // The partial answer is the reason this is a `200` at all: these come off
    // the rosters the first read already had.
    assert.equal(payload.ranks[LEAGUE]?.standing?.rank, 1);
    assert.equal(payload.ranks[LEAGUE]?.standing?.of, 2);
    assert.equal(payload.ranks[LEAGUE]?.points?.rank, 1);
    assert.equal(payload.ranks[LEAGUE]?.points?.pointsFor, 400);
  });

  test("is never inserted into the long-lived cache", async () => {
    const counts = stub({ failStats: () => true });

    await readManagerRanks(USER, "2029", { projections: true });
    await readManagerRanks(USER, "2029", { projections: true });

    // Twice, where a cached answer would have made it once. Without
    // `rankEntryTtlMs` the degraded payload sat here for fifteen minutes and
    // every reader of this manager in that window was told they had no
    // projections.
    //
    // **The projections read is what this counts, and deliberately not the
    // rosters read beside it.** The roster graph is shared across the three
    // lenses of one screen load by `manager-snapshot`, whose window is seconds
    // and whose entry is not this payload — so the second request here rightly
    // reuses it while still recomputing the answer that was degraded. What must
    // never be reused is the degraded payload itself, and a second stat-line
    // read is exactly the evidence that it wasn't.
    assert.equal(counts.stats, 2);
  });

  test("retries, and the retry succeeds", async () => {
    let broken = true;
    const counts = stub({ failStats: () => broken });

    const failed = await readManagerRanks(USER, "2030", { projections: true });
    assert.equal(failed.projections, "error");

    broken = false;
    const recovered = await readManagerRanks(USER, "2030", { projections: true });
    assert.equal(recovered.projections, "ok");
    assert.equal(recovered.ranks[LEAGUE]?.proj?.rank, 1);
    assert.equal(counts.stats, 2);
  });
});

describe("a ranks read that was asked for without projections", () => {
  test("reports skipped rather than error, and never reads projections", async () => {
    const counts = stub({ failStats: () => true });

    const payload = await readManagerRanks(USER, "2031", { projections: false });

    assert.equal(payload.projections, "skipped");
    assert.deepEqual(payload.weeks, []);
    assert.equal(payload.ranks[LEAGUE]?.proj, null);
    assert.equal(payload.ranks[LEAGUE]?.standing?.rank, 1);
    assert.equal(counts.stats, 0, "the whole cost of the route was skipped");
  });

  test("is cached, because nothing about it failed", async () => {
    const counts = stub({ failStats: () => true });

    await readManagerRanks(USER, "2032", { projections: false });
    await readManagerRanks(USER, "2032", { projections: false });

    assert.equal(counts.leagues, 1);
  });
});
