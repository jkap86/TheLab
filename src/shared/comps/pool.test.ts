import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { COMPS_ENRICHMENTS } from "./fields.ts";

/**
 * Which reads each comps entry point is allowed to make.
 *
 * **The one agreement here that nothing else can hold.** `pool.ts` opens a
 * database pool, so it cannot be loaded in this runner at all, and the routes
 * beside it await `params` and return a `NextResponse`. So the claim these
 * tests make is about the *source*: which loaders each file names, and where.
 * That is exactly the claim that regresses, because the failure mode of getting
 * it wrong is not an error — a base pool that reached for KTC again would still
 * answer, still typecheck, still pass every other test in the repo, and simply
 * be four queries a season slower for every reader who never looked at the
 * market. It is the same shape of test as `league-routes.test.ts` pinning what
 * each League Details route may read.
 *
 * What the *values* mean once loaded is `enrichment.test.ts`'s; this is only
 * about what gets asked for.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const POOL = read("./pool.ts");
const COMPS_ROUTE = read("../../app/api/comps/route.ts");
const PLAYERS_ROUTE = read("../../app/api/comps/players/route.ts");

/**
 * A call rather than a mention — every one of these names appears in prose in
 * one file or another, and a doc comment explaining why something *isn't* read
 * must not fail the test that says so.
 */
function calls(source: string, fn: string): boolean {
  return new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`).test(source);
}

/** The body of a named function declaration, to its closing brace at column 0. */
function body(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is not declared here`);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name} has no closing brace`);
  return source.slice(start, end);
}

/** The four reads a board only pays for when it weighs a field naming one. */
const DATASET_READS = {
  ktc: "getKtcValuesAsOf",
  ktc_history: "getKtcSfHistoryAsOf",
  adp: "getDraftAdpForPlayers",
  draft: "getNflDraftPicks",
} as const;

describe("the season pool every board shares", () => {
  test("reads a season's stat lines and the profiles behind them", () => {
    const loader = body(POOL, "loadSeasonPool");
    assert.ok(calls(loader, "listSeasonStatLines"));
    assert.ok(calls(loader, "getPlayerProfiles"));
  });

  test("reads none of the four datasets", () => {
    // The whole point of the split: the entry every board shares is the two
    // reads every board needs. Any one of these back in it and a default board
    // is paying for the market again — silently, and per stored season.
    const loader = body(POOL, "loadSeasonPool");
    for (const [dataset, fn] of Object.entries(DATASET_READS)) {
      assert.equal(calls(loader, fn), false, `the season pool reads ${dataset}`);
    }
  });
});

describe("the dataset loaders", () => {
  test("every dataset has one, and it is the only place its read is named", () => {
    // One loader per dataset, reached only through the cache in
    // `getCompsEnrichment` — so "was this dataset loaded" is a question about
    // one line of code rather than about the whole file.
    for (const dataset of COMPS_ENRICHMENTS) {
      const fn = DATASET_READS[dataset];
      const occurrences = POOL.split(new RegExp(`(?<![\\w.\`{@])${fn}\\s*\\(`))
        .length - 1;
      assert.equal(occurrences >= 1, true, `${dataset}: ${fn} is never called`);
    }
  });

  test("each one is wired to its own name in the loader table", () => {
    // The table is what `getCompsEnrichment` indexes with the dataset a field
    // declared, so a mis-wired row would load one dataset under another's key —
    // a KTC weight fetching ADP, cached as though it were KTC.
    assert.match(POOL, /ktc:\s*loadKtc,/);
    assert.match(POOL, /ktc_history:\s*loadKtcHistory,/);
    assert.match(POOL, /adp:\s*loadAdp,/);
    assert.match(POOL, /draft:\s*loadDraft,/);
  });

  test("only the datasets asked for are loaded", () => {
    // `listCompsEnrichments(needs)` is the list walked — never
    // `COMPS_ENRICHMENTS`, which would be all four whatever the board said.
    const loader = body(POOL, "loadEnrichmentInputs");
    assert.ok(calls(loader, "listCompsEnrichments"));
    assert.equal(loader.includes("COMPS_ENRICHMENTS"), false);
  });

  test("a board needing nothing does not merge a corpus at all", () => {
    // It gets the pools it was handed straight back — the same arrays, which is
    // what keeps the corpus-identity memo beside it (`withCareerValues`)
    // pointed at one corpus whatever board is being run.
    assert.match(
      POOL,
      /if \(!anyCompsEnrichment\(needs\)\) return pools;/,
    );
  });
});

describe("the read admission", () => {
  test("every database read in this module passes it", () => {
    // The bound is on *database* work, so each read is wrapped where it is
    // made. `getDraftAdpForPlayers` is the one exception and it is deliberate:
    // it carries `adpComputeAdmission` of its own, and a comps slot held across
    // a wait for an ADP slot is two limiters stacked on one read.
    for (const fn of [
      "listSeasonStatLines",
      "getPlayerProfiles",
      "getKtcValuesAsOf",
      "getKtcSfHistoryAsOf",
      "getNflDraftPicks",
      "listStoredSeasons",
      "listStoredPlayerSeasons",
    ]) {
      assert.match(
        POOL,
        new RegExp(`compsReadAdmission\\.run\\((?:\\(\\) =>)?[\\s\\S]{0,80}?${fn}`),
        `${fn} is read outside the admission`,
      );
    }
  });

  test("a slot is never held across the pool read it depends on", () => {
    // The ADP and draft loaders need the season's ids, which come from the
    // season's pool — itself an admitted read. Awaiting it from inside a slot is, with
    // every slot taken, a queue waiting on itself.
    for (const name of ["loadAdp", "loadDraft"]) {
      const loader = body(POOL, name);
      const ids = loader.indexOf("seasonPlayerIds");
      const admitted = loader.indexOf("compsReadAdmission.run");
      assert.notEqual(ids, -1, `${name} should resolve its ids`);
      assert.ok(
        admitted === -1 || ids < admitted,
        `${name} takes a slot before resolving its ids`,
      );
    }
  });
});

describe("what a season's entries are held for", () => {
  test("both season caches store on the season's own clock", () => {
    // One fifteen-minute clock over a corpus every request walks end to end was
    // ~54 reads four times an hour to re-learn seasons that do not move. The
    // policy is `getCompsSeasonTtlMs`; what is pinned here is that both caches
    // actually pass it, since falling back to the cache's own TTL is silent —
    // the reads still answer, merely four times as often as they need to.
    for (const cache of ["poolCache", "enrichmentCache"]) {
      const from = POOL.indexOf(`${cache}.read(`);
      assert.notEqual(from, -1, `${cache}.read( not found — was it renamed?`);
      const call = POOL.slice(from, from + 400);
      assert.match(
        call,
        /ttlMs:\s*await seasonTtlMs\(/,
        `${cache} stores on the cache's own TTL rather than the season's`,
      );
    }
  });

  test("the stagger is keyed on the entry, not on the season", () => {
    // Otherwise a season's pool and its four datasets expire in one instant,
    // which is the cliff the tiers exist to remove wearing a smaller hat.
    assert.match(POOL, /seasonTtlMs\(season, key\)/);
  });
});

describe("a season that changes is dropped rather than waited out", () => {
  test("the stats sync's announcement is what invalidates", () => {
    // A finished season is held for a day, which is right until the day it is
    // corrected: an archive week re-probed with rows, a refused payload the
    // next tick accepts, a backfill reaching a season for the first time.
    assert.ok(calls(POOL, "onStatsSeasonWritten"));
    assert.match(POOL, /onStatsSeasonWritten\(forgetCompsSeason\)/);
  });

  test("it forgets the season's pool and every one of its datasets", () => {
    // A pool dropped without its datasets is a corrected season decorated with
    // the market maps built against the ids it used to have.
    const forget = body(POOL, "forgetCompsSeason");
    assert.ok(forget.includes("poolCache.forget"));
    assert.ok(forget.includes("enrichmentCache.forget"));
    assert.ok(
      forget.includes("COMPS_ENRICHMENTS"),
      "the datasets must be walked from the catalogue, not listed here",
    );
    // And the seasons list, since a season's *first* stat line is what makes it
    // appear at all.
    assert.ok(forget.includes("seasonsCache.forget"));
  });
});

describe("the picker's list", () => {
  test("is not the comps corpus", () => {
    // This is the regression that made opening the picker assemble every stored
    // season and join four datasets onto each — to print names.
    assert.equal(calls(PLAYERS_ROUTE, "getCompsPools"), false);
    assert.equal(calls(PLAYERS_ROUTE, "getCompsPool"), false);
    assert.equal(calls(PLAYERS_ROUTE, "enrichCompsPools"), false);
    assert.ok(calls(PLAYERS_ROUTE, "getCompsPlayerIndex"));
  });

  test("its read names none of the four datasets", () => {
    const loader = body(POOL, "getCompsPlayerIndex");
    for (const fn of Object.values(DATASET_READS)) {
      assert.equal(calls(loader, fn), false, `the picker index reads ${fn}`);
    }
    // Named rather than called: the stats read is handed to the admission as a
    // reference, so what is asserted is that it is the read reached for.
    assert.ok(loader.includes("listStoredPlayerSeasons"));
    assert.ok(calls(loader, "getPlayerProfiles"));
  });
});

describe("the comps route", () => {
  test("derives what to load from the board it is about to run", () => {
    // Not from the position, not from the catalogue: from the effective fields,
    // which is the only thing that knows whether a market field carries weight.
    assert.match(
      COMPS_ROUTE,
      /const needs = requiredCompsEnrichments\(wanted\);/,
    );
    assert.match(COMPS_ROUTE, /enrichCompsPools\(base, needs\)/);
  });

  test("resolves the board before it loads anything expensive", () => {
    // The order is the gate: `compsWantedFields` needs the subject's position,
    // and the datasets must not be read before it is known.
    const wanted = COMPS_ROUTE.indexOf("const wanted = compsWantedFields");
    const needs = COMPS_ROUTE.indexOf("const needs = requiredCompsEnrichments");
    const loaded = COMPS_ROUTE.indexOf("enrichCompsPools(base, needs)");
    assert.ok(wanted !== -1 && needs > wanted && loaded > needs);
  });

  test("prints a draft pick without loading the corpus's picks", () => {
    // A dozen labels, read for the rows actually being sent — where the
    // `draft_capital` *field* is a dimension over every player-season on file.
    assert.ok(calls(COMPS_ROUTE, "getCompsDisplayDraft"));
    assert.match(COMPS_ROUTE, /needs\.draft\s*\n?\s*\?\s*null/);
  });
});
