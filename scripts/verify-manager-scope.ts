/**
 * The Manager scope, driven end to end against a real Postgres.
 *
 * **This is the coverage `manager-scope.test.ts` cannot give.** That file pins
 * the textual facts — which predicate every read applies, what the scope write
 * commits, where the sync returns — because the decisions live inside
 * `pool.query` template literals and no type carries them. What it cannot do is
 * *run* them: `npm test` is Node's own runner over `src/**\/*.test.ts` with no
 * alias loader and no database, so a module that imports `@/shared/db` cannot
 * even be resolved there, let alone answer.
 *
 * So this is the other half, and it is the half that would actually have caught
 * the bug: real statements, a real schema, a real `syncManagerLeagues` under its
 * real advisory lock, with Sleeper stubbed at `globalThis.fetch`. Run it against
 * a throwaway cluster:
 *
 *   DATABASE_URL=postgres://…/thelab npm run verify:manager-scope
 *
 * It is destructive — it truncates the league-graph tables — so it refuses to
 * start unless `ALLOW_DESTRUCTIVE=1` is set, on the same principle
 * `migrate:down` is documented by: a command that empties a corpus should be
 * hard to run by accident.
 */
import assert from "node:assert/strict";

import { pool } from "@/shared/db";
import {
  getLeaguemateIds,
  getManagerLeagueIds,
  getManagerLeagueRosters,
  getManagerLeagues,
  getManagerRosters,
  getManagerSyncState,
  syncManagerLeagues,
} from "@/shared/manager";

const USER = "u-manager";
const MATE = "u-mate";
const SEASON = "2026";
const A = "league-A";
const B = "league-B";

/** Sleeper's answers for one run, keyed by the tail of the URL. */
type Stub = {
  /** What `/user/:id/leagues/nfl/:season` returns — or a thrown error. */
  enumeration: unknown | (() => never);
  /** Which league ids `/league/:id` still serves. */
  live: ReadonlySet<string>;
};

let stub: Stub = { enumeration: [], live: new Set([A, B]) };

const league = (id: string, name: string) => ({
  league_id: id,
  name,
  sport: "nfl",
  season: SEASON,
  status: "in_season",
  total_rosters: 2,
  avatar: null,
  roster_positions: ["QB", "RB", "WR", "BN"],
  settings: { type: 2 },
  scoring_settings: { pts_ppr: 1 },
  previous_league_id: null,
});

const roster = (leagueId: string, id: number, owner: string) => ({
  roster_id: id,
  owner_id: owner,
  league_id: leagueId,
  players: ["1", "2"],
  starters: ["1"],
  reserve: null,
  taxi: null,
  settings: { wins: 1, losses: 0, ties: 0, fpts: 100, fpts_decimal: 0 },
});

/** Every Sleeper endpoint the graph fetch touches, answered from `stub`. */
function sleeperAnswer(url: string): unknown {
  const path = new URL(url).pathname;
  if (path === "/v1/state/nfl") {
    return { season: SEASON, week: 3, season_type: "regular", display_week: 3 };
  }
  const leagues = /^\/v1\/user\/[^/]+\/leagues\/nfl\/[^/]+$/;
  if (leagues.test(path)) {
    const answer = stub.enumeration;
    if (typeof answer === "function") (answer as () => never)();
    return answer;
  }
  const parts = path.split("/").filter(Boolean); // v1, league, <id>, <rest…>
  if (parts[1] === "league") {
    const id = parts[2];
    if (!stub.live.has(id)) return null;
    const rest = parts.slice(3).join("/");
    if (rest === "") return league(id, id.toUpperCase());
    if (rest === "rosters") {
      return [roster(id, 1, USER), roster(id, 2, MATE)];
    }
    if (rest === "users") {
      return [
        { user_id: USER, display_name: "Manager", avatar: null, metadata: {} },
        { user_id: MATE, display_name: "Mate", avatar: null, metadata: {} },
      ];
    }
    return [];
  }
  return [];
}

function installFetchStub(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = sleeperAnswer(url);
    return new Response(JSON.stringify(body ?? null), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function reset(): Promise<void> {
  await pool.query(`TRUNCATE leagues, rosters, league_users, traded_picks,
    drafts, draft_picks, transactions, matchups, manager_syncs,
    manager_league_order CASCADE`);
}

/** A fully synced manager in leagues A and B — the state every case starts in. */
async function seedBoth(): Promise<void> {
  await reset();
  stub = { enumeration: [league(A, "A"), league(B, "B")], live: new Set([A, B]) };
  const summary = await syncManagerLeagues(USER, SEASON, { force: true });
  assert.equal(summary.complete, true, "the seed sync should complete");
  const ids = (await getManagerLeagues(USER, SEASON)).map((l) => l.league_id);
  assert.deepEqual(ids.sort(), [A, B], "the seed should list both leagues");
}

const cases: Array<[string, () => Promise<void>]> = [
  [
    "leaving one league removes it from every manager-scoped read at once",
    async () => {
      await seedBoth();

      // B is alive and full of other people — Sleeper simply stops listing it
      // for this manager. Nothing about B's stored rows changes, which is the
      // whole reason the graph could not see this.
      stub.enumeration = [league(A, "A")];
      const summary = await syncManagerLeagues(USER, SEASON, { force: true });
      assert.equal(summary.complete, true, "a departure is not a failed sync");

      assert.deepEqual(
        (await getManagerLeagues(USER, SEASON)).map((l) => l.league_id),
        [A],
        "the leagues grid must drop B immediately",
      );
      assert.deepEqual(await getManagerLeagueIds(USER, SEASON), [A]);
      assert.deepEqual(
        Object.keys(await getManagerRosters(USER, SEASON)),
        [A],
        "player shares must not count a roster in a league they left",
      );
      assert.deepEqual(
        (await getManagerLeagueRosters(USER, SEASON)).map((l) => l.league_id),
        [A],
        "lineups and ranks must not solve a league they left",
      );

      // The graph is kept, globally: eleven other people are still in B.
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM rosters WHERE league_id = $1`,
        [B],
      );
      assert.equal(Number(rows[0].n), 2, "B's stored rosters must survive");
      const gone = await pool.query<{ gone_at: Date | null }>(
        `SELECT gone_at FROM leagues WHERE league_id = $1`,
        [B],
      );
      assert.equal(gone.rows[0].gone_at, null, "a departure is not a tombstone");
    },
  ],
  [
    "leaving the last league leaves the manager with none, and the sync completes",
    async () => {
      await seedBoth();

      stub.enumeration = []; // Sleeper: this manager has no leagues.
      const summary = await syncManagerLeagues(USER, SEASON, { force: true });
      assert.equal(summary.complete, true, "a confirmed empty list is a success");

      assert.deepEqual(await getManagerLeagues(USER, SEASON), []);
      assert.deepEqual(await getManagerLeagueIds(USER, SEASON), []);
      assert.deepEqual(await getLeaguemateIds(USER, SEASON), []);
      assert.deepEqual(await getManagerRosters(USER, SEASON), {});
      assert.deepEqual(await getManagerLeagueRosters(USER, SEASON), []);

      const state = await getManagerSyncState(USER, SEASON);
      assert.notEqual(state?.syncedAt, null, "and it is stamped fresh");
    },
  ],
  [
    "an unreadable enumeration changes nothing and is not a complete sync",
    async () => {
      await seedBoth();
      const before = await getManagerSyncState(USER, SEASON);

      // 200 with a null body: Sleeper's own spelling of "no data", and equally
      // what a truncated answer or an unresolvable user looks like.
      stub.enumeration = null;
      const summary = await syncManagerLeagues(USER, SEASON, { force: true });
      assert.equal(summary.complete, false, "an ambiguous answer is not complete");

      assert.deepEqual(
        (await getManagerLeagues(USER, SEASON)).map((l) => l.league_id).sort(),
        [A, B],
        "the cached list stays exactly as it was",
      );

      const after = await getManagerSyncState(USER, SEASON);
      assert.deepEqual(
        after?.syncedAt?.getTime(),
        before?.syncedAt?.getTime(),
        "synced_at must not move",
      );
      assert.ok(
        (after?.attemptAt?.getTime() ?? 0) > (before?.attemptAt?.getTime() ?? 0),
        "attempt_at must move, or a failing upstream becomes a retry loop",
      );
    },
  ],
  [
    "a malformed enumeration is treated the same way",
    async () => {
      await seedBoth();
      stub.enumeration = { error: "upstream" };
      const summary = await syncManagerLeagues(USER, SEASON, { force: true });
      assert.equal(summary.complete, false);
      assert.equal((await getManagerLeagues(USER, SEASON)).length, 2);
    },
  ],
  [
    "a failed enumeration request stamps the attempt and reports the error",
    async () => {
      await seedBoth();
      const before = await getManagerSyncState(USER, SEASON);

      stub.enumeration = () => {
        throw new Error("upstream exploded");
      };
      await assert.rejects(
        () => syncManagerLeagues(USER, SEASON, { force: true }),
        /upstream exploded/,
      );

      assert.equal(
        (await getManagerLeagues(USER, SEASON)).length,
        2,
        "the cached list survives a thrown enumeration",
      );
      const after = await getManagerSyncState(USER, SEASON);
      assert.deepEqual(
        after?.syncedAt?.getTime(),
        before?.syncedAt?.getTime(),
        "synced_at must not move",
      );
      assert.ok(
        (after?.attemptAt?.getTime() ?? 0) > (before?.attemptAt?.getTime() ?? 0),
        "attempt_at must move",
      );
    },
  ],
  [
    "a deleted league is still tombstoned, for everybody",
    async () => {
      await seedBoth();

      // B leaves the enumeration *and* stops being served: a deletion, not a
      // departure. The probe is what tells them apart, and it must still run
      // now that the scope handles the departures.
      stub.enumeration = [league(A, "A")];
      stub.live = new Set([A]);
      await syncManagerLeagues(USER, SEASON, { force: true });

      const { rows } = await pool.query<{ gone_at: Date | null }>(
        `SELECT gone_at FROM leagues WHERE league_id = $1`,
        [B],
      );
      assert.notEqual(rows[0].gone_at, null, "B should be tombstoned");
    },
  ],
  [
    "a manager with no enumeration of their own still sees their stored graph",
    async () => {
      // The crawler's case: a graph exists, discovery stamped an attempt, and
      // nobody has ever enumerated this manager's own list. Narrowed by a
      // snapshot that does not exist, their page would be empty.
      await seedBoth();
      await pool.query(
        `UPDATE manager_syncs SET scope_at = NULL WHERE user_id = $1 AND season = $2`,
        [USER, SEASON],
      );
      await pool.query(
        `DELETE FROM manager_league_order WHERE user_id = $1 AND season = $2`,
        [USER, SEASON],
      );
      assert.deepEqual(
        (await getManagerLeagues(USER, SEASON)).map((l) => l.league_id).sort(),
        [A, B],
        "no marker must mean no narrowing",
      );
    },
  ],
];

async function main(): Promise<void> {
  if (process.env.ALLOW_DESTRUCTIVE !== "1") {
    console.error(
      "Refusing to run: this truncates the league-graph tables.\n" +
        "Set ALLOW_DESTRUCTIVE=1 and point DATABASE_URL at a throwaway cluster.",
    );
    process.exitCode = 1;
    return;
  }
  installFetchStub();

  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      console.info(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(error);
    }
  }
  await reset();
  await pool.end();
  console.info(`\n${cases.length - failed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

await main();
