import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { databaseBudget } from "../../../shared/db/budget.ts";
import { dbRead, loadEnrichments } from "../../../shared/db/fanout.ts";
import { rookieClassIds } from "../../../shared/players/rookie-class.ts";
import { toPlayerSummary } from "../../../shared/players/summary.ts";

/**
 * What `/api/adp` is allowed to do *after* its aggregate has answered.
 *
 * The route handler cannot be called in this runner — it opens a pool and
 * returns a `NextResponse` — so this file makes two kinds of claim, and both are
 * about things nothing else can catch:
 *
 * - **Which loaders the file names, and how**, read off the source. A route that
 *   went back to `Promise.all` over five reads would still answer, still
 *   typecheck and still pass every other test here; it would simply hold five
 *   connections out of a fan-out budget of three, which is the state this
 *   change replaced.
 * - **What the enrichment stage does at the limit**, driven through the same
 *   `loadEnrichments` the route calls, with deferred loaders standing in for the
 *   queries. No timers: the concurrency is asserted as a counter at the moment
 *   each fake read starts.
 */

const ROUTE = readFileSync(
  fileURLToPath(new URL("route.ts", import.meta.url)),
  "utf8",
);

/** A call rather than a mention — every one of these appears in prose too. */
function calls(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`).test(source);
}

/** How many times `fn` is *called* in the file. */
function callCount(source: string, fn: string): number {
  return source.match(new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`, "g"))?.length ?? 0;
}

describe("the ADP route's enrichment stage", () => {
  test("is bounded rather than started all at once", () => {
    assert.ok(calls(ROUTE, "loadEnrichments"), "route does not bound its fan-out");
    // The shape this replaced. `Promise.all` over the enrichments is precisely
    // the unbounded fan-out the budget exists to prevent, and it reads as
    // harmless because the list is a fixed length.
    // A call, not the mention: the comment above the bounded fan-out argues
    // about exactly the shape it replaced, and must not fail the test saying so.
    assert.equal(
      calls(ROUTE, "Promise\\.all"),
      false,
      "route still fans its enrichments out with Promise.all",
    );
  });

  test("declares every enrichment as a database read", () => {
    // Four reads, four declarations: a loader smuggled in outside `dbRead` is a
    // connection the bound does not know about.
    for (const loader of [
      "getPlayersWithExperience",
      "getKtcPickBoard",
      "getKtcValuesBySleeperId",
      "getDraftAuctionSpend",
    ]) {
      assert.ok(calls(ROUTE, loader), `route no longer reads ${loader}`);
    }
    assert.equal(callCount(ROUTE, "dbRead"), 4, "an enrichment is not declared");
    // The bound is the shared budget's, never a number of this route's own.
    assert.equal(
      /loadEnrichments\(\s*\{[^]*?\}\s*,\s*\d/.test(ROUTE),
      false,
      "route passes a hard-coded concurrency limit",
    );
  });

  test("the auction read keeps its own heavy-read admission", () => {
    // The route must not wrap it in a second admission token; the process-wide
    // one lives inside `getDraftAuctionSpend`, which is what keeps a route slot
    // held across it from being one limiter acquired twice.
    assert.equal(calls(ROUTE, "adpComputeAdmission"), false);
    assert.equal(calls(ROUTE, "dbHeavyReadAdmission"), false);
  });

  test("reads the players table once, not twice", () => {
    // The consolidation: `getPlayersByIds(ids)` and `getRookieClassIds(ids)`
    // were the same index lookup on the same ids, run twice. The class is now a
    // derivation over the one read.
    assert.equal(callCount(ROUTE, "getPlayersWithExperience"), 1);
    assert.equal(calls(ROUTE, "getPlayersByIds"), false);
    assert.equal(calls(ROUTE, "getRookieClassIds"), false);
    assert.equal(calls(ROUTE, "getRookiePlayerIds"), false);
    assert.ok(calls(ROUTE, "rookieClassIds"), "the rookie-class seam is gone");
  });

  test("still sends every field it sent before", () => {
    // The response is not what this change is about, so it is pinned here: a
    // payload field dropped while rearranging the reads would be a silent
    // contract break.
    for (const field of [
      "filters",
      "draft_count",
      "redraft_drafts",
      "dynasty_drafts",
      "redraft_auctions",
      "dynasty_auctions",
      "player_count",
      "players",
      "pick_ktc",
    ]) {
      assert.match(
        ROUTE,
        new RegExp(`\\n\\s+${field}\\s*[:,]`),
        `payload is missing ${field}`,
      );
    }
    for (const field of [
      "player_id",
      "name",
      "position",
      "team",
      "rookie",
      "redraft",
      "dynasty",
      "auction",
      "ktc",
    ]) {
      assert.match(
        ROUTE,
        new RegExp(`\\n\\s+${field}[:,]`),
        `player payload is missing ${field}`,
      );
    }
  });

  test("a failed enrichment is still a failed request", () => {
    // The route catches once, around everything, and answers through the shared
    // read-failure policy — 503 for a busy database, 500 for a broken read. An
    // enrichment caught into an empty map would be a 200 claiming the crawled
    // auctions never bought anybody.
    assert.ok(calls(ROUTE, "readFailureResponse"));
    assert.equal(
      /\.catch\(/.test(ROUTE),
      false,
      "route swallows an enrichment failure",
    );
  });
});

/**
 * The same four tasks the route declares, with the queries replaced by promises
 * this file settles.
 */
function enrichmentFixture() {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  let live = 0;
  let peak = 0;

  const load = <T>(name: string, value: T) => async () => {
    started.push(name);
    live += 1;
    peak = Math.max(peak, live);
    try {
      await new Promise<void>((resolve) => gates.set(name, resolve));
      return value;
    } finally {
      live -= 1;
    }
  };

  return { started, gates, load, peak: () => peak };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const PLAYER_ROWS = {
  rookie: {
    player_id: "rookie",
    full_name: "First Year",
    first_name: null,
    last_name: null,
    position: "WR",
    team: "CIN",
  },
  vet: {
    player_id: "vet",
    full_name: "Long Time",
    first_name: null,
    last_name: null,
    position: "RB",
    team: "SF",
  },
} as const;

const PLAYERS = {
  rookie: { ...toPlayerSummary(PLAYER_ROWS.rookie), years_exp: 0 },
  vet: { ...toPlayerSummary(PLAYER_ROWS.vet), years_exp: 7 },
};

describe("the enrichment stage at the limit", () => {
  test("every enrichment is requested and none exceeds the budget", async () => {
    const limit = databaseBudget({}).fanout;
    const f = enrichmentFixture();

    const run = loadEnrichments({
      players: dbRead(f.load("players", PLAYERS)),
      pickKtc: dbRead(f.load("pickKtc", { "2027|1|": { sf: 1, oneqb: 1 } })),
      ktc: dbRead(f.load("ktc", { values: {}, updated_at: null })),
      auction: dbRead(
        f.load("auction", {
          redraft_auctions: 0,
          dynasty_auctions: 0,
          values: new Map(),
        }),
      ),
    });

    await flush();
    // Four enrichments, a budget of three: the fourth waits rather than opening
    // a connection the pool was holding for somebody else.
    assert.equal(f.started.length, limit);

    for (const resolve of f.gates.values()) resolve();
    await flush();
    for (const resolve of f.gates.values()) resolve();
    const results = await run;

    assert.deepEqual([...f.started].sort(), [
      "auction",
      "ktc",
      "pickKtc",
      "players",
    ]);
    assert.equal(f.peak(), limit);
    assert.equal(results.players, PLAYERS);
  });

  test("the rookie flag is derived from the one players read", async () => {
    // What the route does with the consolidated answer, and the assertion that
    // the payload's `rookie` column is unchanged by the consolidation: the set
    // is exactly what the second query used to select.
    const { players } = await loadEnrichments({
      players: dbRead(async () => PLAYERS),
    });
    const rookies = rookieClassIds(players);

    assert.deepEqual(rookies, new Set(["rookie"]));
    // And the display half the payload reads is byte-identical to what
    // `getPlayersByIds` resolved before the column was added.
    for (const id of ["rookie", "vet"] as const) {
      const { years_exp: _experience, ...summary } = players[id];
      assert.deepEqual(summary, toPlayerSummary(PLAYER_ROWS[id]));
    }
  });
});
