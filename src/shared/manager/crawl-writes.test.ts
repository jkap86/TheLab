import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { NEVER_REFRESHED_SQL } from "./sync-freshness.ts";

/**
 * The crawler's writes, pinned against their source.
 *
 * **These are `sql.test.ts`'s bargain, for the same reason.** The decisions here
 * live inside `bulkInsert` option objects and `pool.query` template literals, so
 * no type carries them and — the part that matters — nothing *fails* when they
 * are wrong. A `DEFAULT now()` where a sentinel belongs writes a row that says a
 * league nobody has ever read was refreshed this second; a conflict clause that
 * grows an `updated_at` overwrites a real sync time with a discovery instant.
 * Both typecheck, both commit, and the only symptom is a freshness answer that
 * quietly lies for as long as the row lives.
 *
 * The repo's DB-touching modules are otherwise untested, and this does not
 * change that: nothing here connects to anything. It reads the two files and
 * asserts the handful of textual facts their doc comments spend paragraphs
 * arguing for, so that an edit which flattens one has to delete an assertion
 * that says why.
 */

const read = (file: string) =>
  readFileSync(join(process.cwd(), "src/shared/manager", file), "utf8");

/** One exported function's body, from its signature to the next top-level `}`. */
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name} should be terminated`);
  return source.slice(start, end);
}

describe("persistUnsyncedLeagues", () => {
  const persist = read("persist.ts");
  const fn = body(persist, "persistUnsyncedLeagues");

  test("a row with no graph takes the sentinel, never `now()`", () => {
    // The whole point of the row: it records that the league was seen so
    // discovery stops re-selecting it, and records nothing about a graph,
    // because there is not one. `DEFAULT now()` here is the claim
    // `writeLeagueGraph` already refuses to make one row over.
    assert.match(fn, /column: "updated_at", sql: NEVER_REFRESHED_SQL/);
    assert.equal(NEVER_REFRESHED_SQL, "'epoch'::timestamptz");
  });

  test("the attempt is stamped, because this was one", () => {
    assert.match(fn, /column: "sync_attempt_at", sql: "now\(\)"/);
  });

  test("a conflict moves the attempt and nothing else", () => {
    // A row already here came from a sync that saw the league, or from a
    // tombstone. Both beat the enumeration payload this holds — so the payload,
    // `gone_at` and above all a legitimate `updated_at` are left alone.
    const clause = /onConflict: `\(league_id\) DO UPDATE SET sync_attempt_at = now\(\)`/;
    assert.match(fn, clause);
    assert.doesNotMatch(fn, /DO UPDATE SET[^`]*updated_at/);
    assert.doesNotMatch(fn, /DO UPDATE SET[^`]*gone_at/);
  });
});

describe("persistGoneLeagues", () => {
  const fn = body(read("persist.ts"), "persistGoneLeagues");

  test("the row arrives already tombstoned", () => {
    // Without a row there is nowhere to record the answer, so every member of
    // the league rediscovers it forever.
    assert.match(fn, /trailing: \{ column: "gone_at", sql: "now\(\)" \}/);
  });

  test("a conflict stamps only the marker", () => {
    assert.match(fn, /onConflict: `\(league_id\) DO UPDATE SET gone_at = now\(\)`/);
    assert.doesNotMatch(fn, /DO UPDATE SET[^`]*updated_at/);
  });
});

describe("the queue's writes", () => {
  const queue = read("crawl-queue.ts");

  test("stampManagers never names `synced_at`", () => {
    // `synced_at` means a *complete* graph sync and stays owned by
    // `syncManagerLeagues`. A discovery pass that advanced it would make the
    // leagues route serve a half-refreshed list as fresh — and the protection
    // is that there is no branch here at all for an edit to flatten.
    const fn = body(queue, "stampManagers");
    assert.match(fn, /INSERT INTO manager_syncs \(user_id, season, attempt_at\)/);
    assert.doesNotMatch(fn, /synced_at/);
    assert.match(fn, /DO UPDATE SET attempt_at = now\(\)/);
  });

  test("the claim reads its freshness interval as both freshness and throttle", () => {
    // Two questions, one interval: `updated_at` says whether work is needed and
    // `sync_attempt_at` says how often it may be asked for. A healthy league
    // carries both at the same instant and turns over together; a league that
    // cannot sync stops occupying a slot every tick. The claim binds `$2` twice
    // for exactly that, so it is bound twice here too.
    const claim = readFileSync(
      join(process.cwd(), "src/shared/manager/crawl-priority.ts"),
      "utf8",
    );
    const sql = claim.slice(claim.indexOf("export function staleLeagueClaimSql"));
    assert.match(sql, /updated_at < now\(\) - \$2::interval/);
    assert.match(sql, /sync_attempt_at < now\(\) - \$2::interval/);
    // And it claims and stamps in one statement, so two ticks — or two
    // instances — can never pick the same batch.
    assert.match(sql, /UPDATE leagues\s+SET sync_attempt_at = now\(\)/);
    assert.match(sql, /RETURNING league_id/);
  });

  test("nothing in the queue stamps `last_accessed_at` except the demand signal", () => {
    // Demand is *observed*, never inferred. If the crawler stamped what it
    // refreshed, within one rotation every league would look demanded and the
    // five tiers would flatten back to the round-robin they replace.
    const stamps = queue.match(/last_accessed_at = now\(\)/g) ?? [];
    assert.equal(stamps.length, 1);
    assert.match(body(queue, "markLeaguesAccessed"), /last_accessed_at = now\(\)/);
  });
});

/** One `async function`'s body, exported or not, to the next top-level `}`. */
function anyBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name} should be terminated`);
  return source.slice(start, end);
}

describe("what a sync reads as already stored whole", () => {
  const persist = read("persist.ts");
  const graph = read("graph.ts");
  const sync = read("sync.ts");

  test("a draft is skipped only when stored complete *with* picks", () => {
    // Two conditions, and dropping either is silent. Without the status a
    // draft in progress would stop being re-read the moment its first pick was
    // stored; without the pick clause a draft whose row went in as `complete`
    // while its pick fetch failed into `[]` would freeze that absence for good.
    const fn = body(persist, "getStoredCompleteDraftIds");
    assert.match(fn, /d\.status = 'complete'/);
    assert.match(fn, /EXISTS \(SELECT 1 FROM draft_picks p WHERE p\.draft_id = d\.draft_id\)/);
    assert.match(fn, /league_id = ANY\(\$1::varchar\[\]\)/);
  });

  test("the fetch filters on the stored set before asking for any picks", () => {
    // Filtered rather than resolved to `[]` inside the fan-out, and on the
    // stored ids rather than the fetched status: what makes a board safe to
    // skip is that its picks are already in Postgres, which the fetched row
    // cannot say.
    const fn = body(graph, "fetchLeagueGraph");
    const filter = fn.indexOf("drafts.filter((d) => !completeDraftIds.has(d.draft_id))");
    assert.notEqual(filter, -1, "the draft list is narrowed by the stored set");
    assert.ok(filter < fn.indexOf("getDraftPicks(d.draft_id, fresh)"));
    // The draft rows themselves are still fetched: status only moves forward
    // and `drafts` are never deleted, so the upsert is what advances them.
    assert.match(fn, /getLeagueDrafts\(league\.league_id, fresh\)/);
  });

  test("the set is read where every caller passes, and handed to the fetch", () => {
    // `syncLeagueGraphs` is the one call site of `fetchLeagueGraph` — the
    // crawler, the manager sync, a refresh press and a history load all drive
    // it — so the read here is what makes the skip apply to the `fresh` press
    // too. Immutable is immutable, whoever asked.
    const fn = body(sync, "syncLeagueGraphs");
    assert.match(fn, /getStoredCompleteDraftIds\(leagueIds\)/);
    assert.match(fn, /fetchLeagueGraph\(league, weeksFor\(league\), \{\s*fresh,\s*completeDraftIds,\s*\}\)/);
  });

  test("the pick delete stays scoped to the drafts in the payload", () => {
    // The whole safety of the skip: a skipped draft is absent from
    // `g.draftPicks`, so a delete scoped to what arrived leaves its board
    // untouched, where a per-league delete would empty it on every refresh.
    const fn = anyBody(persist, "writeLeagueGraph");
    assert.match(fn, /DELETE FROM draft_picks WHERE draft_id = ANY\(\$1::varchar\[\]\)/);
    assert.doesNotMatch(fn, /DELETE FROM draft_picks WHERE league_id/);
    assert.match(fn, /wrotePicks: pickedDraftIds\.length > 0/);
  });

  test("the capital board is evicted only when picks were written", () => {
    // Evicting the season-wide ADP aggregate marks a board every `/api/trades`
    // page rebuilds, and a refresh that wrote no picks cannot have moved an
    // ADP. Evicted on every persist, a crawler ticking fifteen leagues a minute
    // kept that board permanently cold. The season itself is still always
    // named: it narrows three other forgets, so spelling this as a null season
    // would widen them to every season — see `TradeCacheInvalidation`.
    const fn = body(persist, "persistLeagueGraph");
    assert.match(fn, /season: g\.league\.season/);
    assert.match(fn, /wroteDraftPicks: wrotePicks/);
  });

  test("the stored max week is one index probe per league, not an aggregate", () => {
    // `GROUP BY league_id` over `max(week)` reads every stored row of every
    // league asked for; a backward probe of the `(league_id, week)` index
    // reads a page. Both answer the same map, and only one of them is a full
    // scan of a season's history on every sync.
    const fn = anyBody(persist, "maxWeekByLeague");
    assert.match(fn, /FROM unnest\(\$1::varchar\[\]\) AS ids\(id\)/);
    assert.match(fn, /WHERE t\.league_id = ids\.id AND t\.week IS NOT NULL/);
    assert.match(fn, /ORDER BY t\.week DESC\s+LIMIT 1/);
    assert.doesNotMatch(fn, /GROUP BY/);
    assert.doesNotMatch(fn, /max\(week\)/);
    // A league with nothing stored answers null from the subquery and must be
    // *absent* from the map — absent is what means "backfill the season".
    assert.match(fn, /\.filter\(\(r\) => r\.max_week !== null\)/);
  });
});
