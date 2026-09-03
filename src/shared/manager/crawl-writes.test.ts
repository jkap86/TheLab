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
