/**
 * The crawler's resource guard, driven end to end against a real Postgres.
 *
 * **This is the coverage the unit tests cannot give.** `crawl-pressure.test.ts`
 * drives every band, width and latch on injected readings, and
 * `crawl-guard.test.ts` pins the wiring textually — because `crawl.ts` reaches
 * Postgres and Sleeper through `@/…` aliases and Node's own runner cannot even
 * resolve it. What neither can answer is the claim the whole design turns on:
 * that a tick which stands down mid-batch leaves the leagues it never reached
 * **unclaimed**, with `sync_attempt_at` untouched, so they are the next tick's
 * first candidates rather than deferred a whole freshness TTL. That is a fact
 * about rows, and only rows can settle it.
 *
 * Run it against a throwaway cluster:
 *
 *   DATABASE_URL=postgres://…/thelab ALLOW_DESTRUCTIVE=1 npm run verify:crawl-pressure
 *
 * It truncates the league-graph tables, so it refuses to start without
 * `ALLOW_DESTRUCTIVE=1` — `verify:manager-scope`'s rule, for its reason.
 *
 * The two deep imports are deliberate. `shared/manager`'s barrel deliberately
 * exposes the crawl loop's *starter* and nothing else — nothing outside the
 * folder decides what to crawl next — and a harness that drives one tick with a
 * scripted gate is the one caller that has to reach past it.
 */
import assert from "node:assert/strict";

import { pool } from "@/shared/db";
import { runLeagueCrawl } from "@/shared/manager/crawl";
import {
  crawlerPressureConfig,
  getCrawlerResourcePressure,
  type CrawlPressureGate,
  type CrawlerResourcePressure,
} from "@/shared/manager/crawl-pressure";

const SEASON = "2026";
const LEAGUES = 15;
const MANAGER = "u-mate";

if (process.env.ALLOW_DESTRUCTIVE !== "1") {
  console.error(
    "Refusing to run: this truncates the league-graph tables. " +
      "Set ALLOW_DESTRUCTIVE=1 against a throwaway database.",
  );
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Sleeper, stubbed                                                            */
/* -------------------------------------------------------------------------- */

let sleeperCalls = 0;
/** League ids whose fetch throws, to exercise the failure path. */
let broken = new Set<string>();

const leaguePayload = (id: string) => ({
  league_id: id,
  name: id.toUpperCase(),
  sport: "nfl",
  season: SEASON,
  status: "in_season",
  total_rosters: 2,
  avatar: null,
  roster_positions: ["QB", "RB", "WR", "BN"],
  settings: { type: 2, draft_rounds: 3 },
  scoring_settings: { pts_ppr: 1 },
  previous_league_id: null,
});

function sleeperAnswer(url: string): unknown {
  const path = new URL(url).pathname;
  if (path === "/v1/state/nfl") {
    return { season: SEASON, week: 3, season_type: "regular", display_week: 3 };
  }
  if (/^\/v1\/user\/[^/]+\/leagues\/nfl\/[^/]+$/.test(path)) {
    // One never-seen league per enumerated manager, so the discovery pass has
    // real work whenever it is allowed to run.
    return [leaguePayload("new-1"), leaguePayload("new-2")];
  }
  const parts = path.split("/").filter(Boolean); // v1, league, <id>, <rest…>
  if (parts[1] === "league") {
    const id = parts[2];
    if (broken.has(id)) throw new Error(`Sleeper is unhappy about ${id}`);
    const rest = parts.slice(3).join("/");
    if (rest === "") return leaguePayload(id);
    if (rest === "rosters") {
      return [
        {
          roster_id: 1,
          owner_id: MANAGER,
          league_id: id,
          players: ["1", "2"],
          starters: ["1"],
          reserve: null,
          taxi: null,
          settings: { wins: 1, losses: 0, ties: 0, fpts: 100, fpts_decimal: 0 },
        },
      ];
    }
    if (rest === "users") {
      return [{ user_id: MANAGER, display_name: "Mate", avatar: null, metadata: {} }];
    }
    return [];
  }
  return [];
}

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  sleeperCalls += 1;
  const body = sleeperAnswer(url);
  return new Response(JSON.stringify(body ?? null), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

/* -------------------------------------------------------------------------- */
/* A gate whose readings are scripted                                          */
/* -------------------------------------------------------------------------- */

const CONFIG = crawlerPressureConfig({
  maxConcurrency: 4,
  env: {},
  production: true,
});

/**
 * The real gate's logic over a scripted sequence of RSS readings, one consumed
 * per `read()`, the last repeating forever. The latch is the real one — this
 * replaces only where the number comes from.
 */
function scriptedGate(readingsMb: number[]): CrawlPressureGate & {
  reads: number[];
} {
  let latched = false;
  let index = 0;
  const reads: number[] = [];
  return {
    config: CONFIG,
    reads,
    read(signals = {}): CrawlerResourcePressure {
      const rssMb = readingsMb[Math.min(index, readingsMb.length - 1)];
      index += 1;
      reads.push(rssMb);
      const pressure = getCrawlerResourcePressure(CONFIG, {
        ...signals,
        rssBytes: rssMb * 1024 * 1024,
        recovering: latched,
      });
      if (latched && pressure.rssMb < CONFIG.resumeMb) latched = false;
      return pressure;
    },
    yielded() {
      latched = true;
    },
    latched: () => latched,
  };
}

/* -------------------------------------------------------------------------- */
/* Fixtures and probes                                                         */
/* -------------------------------------------------------------------------- */

async function reset(): Promise<void> {
  await pool.query(`TRUNCATE leagues, rosters, league_users, traded_picks,
    drafts, draft_picks, transactions, matchups, manager_syncs,
    manager_league_order CASCADE`);
}

/** Fifteen stale leagues nobody has ever attempted, plus a member to enumerate. */
async function seed(): Promise<void> {
  await reset();
  const ids = Array.from({ length: LEAGUES }, (_, i) => `L${String(i + 1).padStart(2, "0")}`);
  await pool.query(
    `INSERT INTO leagues (league_id, name, season, sport, status, total_rosters,
                          roster_positions, settings, scoring_settings,
                          updated_at, sync_attempt_at)
     SELECT id, upper(id), $2, 'nfl', 'in_season', 2,
            '["QB","RB","WR","BN"]'::jsonb, '{"type":2}'::jsonb,
            '{"pts_ppr":1}'::jsonb,
            now() - interval '10 days', NULL
       FROM unnest($1::varchar[]) AS id`,
    [ids, SEASON],
  );
  // One member of one league, so `pendingManagers` has somebody to enumerate.
  await pool.query(
    `INSERT INTO league_users (league_id, user_id, display_name, is_bot)
     VALUES ($1, $2, 'Mate', false)`,
    [ids[0], MANAGER],
  );
  sleeperCalls = 0;
  broken = new Set();
}

/** How many of the seeded leagues the crawler has claimed (stamped an attempt on). */
async function claimedCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM leagues
      WHERE season = $1 AND league_id LIKE 'L%' AND sync_attempt_at IS NOT NULL`,
    [SEASON],
  );
  return Number(rows[0].n);
}

/** How many were actually refreshed — `updated_at` moved off the seeded value. */
async function refreshedCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM leagues
      WHERE season = $1 AND league_id LIKE 'L%'
        AND updated_at > now() - interval '1 day'`,
    [SEASON],
  );
  return Number(rows[0].n);
}

/** Advisory locks held on the crawl key right now, across every session. */
async function crawlLocks(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_locks
      WHERE locktype = 'advisory' AND classid = 8675309 AND objid = 1`,
  );
  return Number(rows[0].n);
}

/** Nothing checked out, nothing queued — no client leaked by the tick. */
function assertPoolIdle(where: string): void {
  assert.equal(
    pool.totalCount - pool.idleCount,
    0,
    `${where}: ${pool.totalCount - pool.idleCount} connection(s) still checked out`,
  );
  assert.equal(pool.waitingCount, 0, `${where}: callers still queued for a connection`);
}

/* -------------------------------------------------------------------------- */
/* Cases                                                                       */
/* -------------------------------------------------------------------------- */

const cases: Array<[string, () => Promise<void>]> = [
  [
    "a tick refused before the lock costs nothing at all",
    async () => {
      await seed();
      const gate = scriptedGate([418]);
      const s = await runLeagueCrawl({ season: SEASON, gate });

      assert.equal(s.skipped, "memory");
      assert.equal(s.pressure.startRssMb, 418);
      assert.equal(s.refreshed, 0);
      assert.equal(s.managersCrawled, 0);
      // Nothing was claimed, nothing was fetched, and the lock was never taken.
      assert.equal(await claimedCount(), 0, "no league may be claimed");
      assert.equal(sleeperCalls, 0, "a refused tick asks Sleeper nothing");
      assert.equal(await crawlLocks(), 0, "the crawl lock was never taken");
      assert.equal(gate.latched(), true, "the refusal latches");
      assertPoolIdle("after a refused tick");
    },
  ],
  [
    "a tick that walks into pressure claims only what it runs",
    async () => {
      await seed();
      // Opening read, then one per batch boundary: 4 at 242MB, 2 at 318, 1 at
      // 366, then nothing at 407 — and critical for the discovery read after it.
      const gate = scriptedGate([242, 242, 318, 366, 407]);
      const s = await runLeagueCrawl({ season: SEASON, gate });

      assert.equal(s.skipped, null, "the tick ran");
      assert.equal(s.pressure.yielded, true, "it stood down before its budget");
      assert.equal(s.pressure.startConcurrency, 4);
      assert.equal(s.pressure.endConcurrency, 0);

      // 4 + 2 + 1 leagues claimed and refreshed; the other 8 untouched.
      assert.equal(s.refreshed, 7, "seven leagues refreshed");
      assert.equal(await claimedCount(), 7, "only the seven were claimed");
      assert.equal(await refreshedCount(), 7);
      assert.equal(
        s.pressure.leaguesRemaining,
        8,
        "the summary names the budget it did not spend",
      );

      // The eight the guard stopped us reaching kept their place in the queue:
      // no attempt stamp, so the claim query will offer them on the next tick
      // rather than refusing them for a freshness TTL.
      const { rows } = await pool.query<{ league_id: string }>(
        `SELECT league_id FROM leagues
          WHERE season = $1 AND sync_attempt_at IS NULL ORDER BY league_id`,
        [SEASON],
      );
      assert.equal(rows.length, 8);

      // Discovery never ran, and nothing about it was stamped.
      assert.equal(s.managersCrawled, 0, "discovery is deferred under pressure");
      assert.equal(s.pressure.discoveryDeferred, true);
      const { rows: syncs } = await pool.query(`SELECT 1 FROM manager_syncs`);
      assert.equal(syncs.length, 0, "no manager may be stamped by a deferred pass");

      assert.equal(await crawlLocks(), 0, "the lock is released on a yield");
      assert.equal(gate.latched(), true, "a yield latches for the next tick");
      assertPoolIdle("after a yielded tick");
    },
  ],
  [
    "the next tick is refused while elevated and resumes once recovered",
    async () => {
      // Continues from the case above: eight leagues still queued.
      const latched = scriptedGate([382]);
      latched.yielded();
      const refused = await runLeagueCrawl({ season: SEASON, gate: latched });
      assert.equal(refused.skipped, "memory", "382MB is not a recovery");
      assert.equal(await claimedCount(), 7, "nothing new was claimed");
      assert.equal(await crawlLocks(), 0);

      // 12:02 — back under the resume threshold. The remaining eight are taken.
      const recovered = scriptedGate([329]);
      recovered.yielded();
      const s = await runLeagueCrawl({ season: SEASON, gate: recovered });
      assert.equal(s.skipped, null, "a recovered tick runs");
      assert.equal(recovered.latched(), false, "and the latch is released");
      assert.equal(s.refreshed, 8, "the deferred leagues were crawled");
      assert.equal(await claimedCount(), 15);
      assert.equal(s.pressure.yielded, false);
      // 329MB is moderate, so discovery is still allowed — and it ran.
      assert.equal(s.managersCrawled, 1, "the member was enumerated");
      assert.equal(s.discovered, 2, "and their two unknown leagues were stored");
      assertPoolIdle("after a recovered tick");
    },
  ],
  [
    "an unguarded tick is the crawler exactly as it was",
    async () => {
      await seed();
      const off = crawlerPressureConfig({
        maxConcurrency: 4,
        env: { CRAWLER_MEMORY_GUARD_ENABLED: "false" },
        production: true,
      });
      let latched = false;
      const gate: CrawlPressureGate = {
        config: off,
        // A reading that would be critical under the production defaults.
        read: (signals = {}) =>
          getCrawlerResourcePressure(off, {
            ...signals,
            rssBytes: 900 * 1024 * 1024,
          }),
        yielded: () => {
          latched = true;
        },
        latched: () => latched,
      };

      const s = await runLeagueCrawl({ season: SEASON, gate });
      assert.equal(s.skipped, null);
      assert.equal(s.pressure.enabled, false);
      assert.equal(s.pressure.yielded, false);
      assert.equal(s.refreshed, LEAGUES, "the whole batch");
      assert.equal(await claimedCount(), LEAGUES);
      assert.equal(s.managersCrawled, 1, "discovery runs");
      assert.equal(latched, false, "and nothing ever latches");
      assertPoolIdle("after an unguarded tick");
    },
  ],
  [
    "a failing league does not break the guard's cleanup",
    async () => {
      await seed();
      broken = new Set(["L01", "L02", "L03"]);
      const gate = scriptedGate([242, 242, 318, 366, 407]);
      const s = await runLeagueCrawl({ season: SEASON, gate });

      assert.equal(s.skipped, null);
      assert.ok(s.refreshFailed >= 3, `expected the broken leagues to fail, got ${s.refreshFailed}`);
      assert.equal(s.pressure.yielded, true, "the tick still yielded on schedule");
      // The failures were claimed like everything else — they rotate to the back
      // of their own tier — and the unreached leagues are still unclaimed.
      assert.equal(await claimedCount(), 7);
      assert.equal(await crawlLocks(), 0, "the lock is released through a failure");
      assertPoolIdle("after a tick with failures");

      // And the next tick runs normally.
      broken = new Set();
      const next = await runLeagueCrawl({ season: SEASON, gate: scriptedGate([242]) });
      assert.equal(next.skipped, null);
      assert.ok(next.refreshed > 0, "the next tick crawls the leagues left over");
      assertPoolIdle("after the recovery tick");
    },
  ],
  [
    "the pool signal narrows the tick without refusing it",
    async () => {
      await seed();
      // A real reading, but with the pool reported saturated: width drops to 1
      // and discovery is deferred, while the tick still runs.
      let latched = false;
      const gate: CrawlPressureGate = {
        config: CONFIG,
        read: () =>
          getCrawlerResourcePressure(CONFIG, {
            rssBytes: 242 * 1024 * 1024,
            pool: { total: 10, idle: 0, waiting: 3, max: 10 },
          }),
        yielded: () => {
          latched = true;
        },
        latched: () => latched,
      };

      const s = await runLeagueCrawl({ season: SEASON, gate });
      assert.equal(s.skipped, null, "pool pressure never refuses a tick");
      assert.equal(s.pressure.poolSaturated, true);
      assert.equal(s.pressure.endConcurrency, 1);
      assert.equal(s.refreshed, LEAGUES, "the whole batch, one at a time");
      assert.equal(s.managersCrawled, 0, "but discovery is deferred");
      assert.equal(s.pressure.discoveryDeferred, true);
      assertPoolIdle("after a pool-narrowed tick");
    },
  ],
];

async function main(): Promise<void> {
  let failed = 0;
  for (const [name, run] of cases) {
    try {
      await run();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(error);
    }
  }
  await pool.end();
  console.log(failed === 0 ? `\n${cases.length} case(s) passed.` : `\n${failed} case(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
