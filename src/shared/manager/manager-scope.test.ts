import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { MANAGER_SCOPE_STAMP_SQL, MANAGER_SYNC_STAMP_SQL } from "./sync-freshness.ts";

/**
 * The manager's scope, pinned against its source.
 *
 * **These are `crawl-writes.test.ts`' bargain, for its reason.** Which leagues
 * are a manager's is decided inside `pool.query` template literals, so no type
 * carries it and — the part that matters — nothing *fails* when it is wrong.
 * A read that forgets the scope answers with a league the manager left: a real
 * league, real rosters, real numbers, on a page that should not list it. It
 * typechecks, it commits, it renders, and the only symptom is a page quietly
 * describing somebody else's team as yours.
 *
 * So this reads the two files and asserts the handful of textual facts their doc
 * comments spend paragraphs arguing for, so that an edit which drops one has to
 * delete an assertion that says why. Nothing here connects to anything; the
 * end-to-end behaviour is `scripts/verify-manager-scope.ts`, which drives the
 * real statements against a real Postgres.
 */

const read = (file: string) =>
  readFileSync(join(process.cwd(), "src/shared/manager", file), "utf8");

/**
 * One function's body, from its signature to the `}` that closes it.
 *
 * The end is the first `}` **alone on a line**, not the first `\n}` — a
 * signature like `): Promise<{ … }> {` puts one of those in the middle of the
 * declaration, and the naive read silently returns a body with no query in it,
 * which is an assertion that passes for the wrong reason.
 */
function body(source: string, name: string): string {
  const start = source.search(
    new RegExp(`(export )?(async )?function ${name}\\(`),
  );
  assert.notEqual(start, -1, `${name} should exist`);
  const rest = source.slice(start);
  const end = rest.search(/\n\}(\n|$)/);
  assert.notEqual(end, -1, `${name} should be terminated`);
  return rest.slice(0, end);
}

const queries = read("queries.ts");

describe("the scope predicate", () => {
  test("is two arms: no snapshot narrows nothing, a snapshot decides", () => {
    const fragment = queries.slice(
      queries.indexOf("const IN_MANAGER_SCOPE_SQL"),
      queries.indexOf("const MANAGER_LEAGUE_SQL"),
    );
    // Without the first arm a manager the crawler discovered — a real graph,
    // no enumeration of their own ever made — would read as belonging to
    // nothing at all.
    assert.match(fragment, /NOT EXISTS\s*\(\s*SELECT 1 FROM manager_syncs/);
    assert.match(fragment, /ms\.scope_at IS NOT NULL/);
    // And the snapshot itself, which is what a confirmed enumeration wrote.
    assert.match(fragment, /EXISTS\s*\(\s*SELECT 1 FROM manager_league_order mo/);
    assert.match(fragment, /mo\.league_id = l\.league_id/);
  });

  test("narrows the graph predicate rather than replacing it", () => {
    // Both halves still have to hold: a tombstoned league is gone for
    // everybody, and `FIELDED_A_TEAM_SQL`'s deliberate exclusion of a
    // not-yet-drafted league is a documented behaviour, not an accident to be
    // shipped away by a scope that lists it.
    assert.match(
      queries,
      /const MANAGER_LEAGUE_SQL = `\$\{MANAGER_LEAGUE_GRAPH_SQL\} AND \$\{IN_MANAGER_SCOPE_SQL\}`/,
    );
    assert.match(
      queries,
      /const MANAGER_LEAGUE_GRAPH_SQL = `\$\{LIVE_LEAGUE_SQL\} AND \$\{FIELDED_A_TEAM_SQL\}`/,
    );
  });
});

describe("every cross-league manager read is scoped", () => {
  /**
   * The reads that answer "for this manager, across their leagues, …". Each is
   * a page or a panel a departed league must not appear on: the grid, the
   * trades circle, the leaguemate list, the shares, the lineup ranks, the week
   * check.
   */
  const scoped = [
    "getManagerLeagues",
    "getManagerLeagueIds",
    "getLeaguemateIds",
    "getManagerRosters",
    "getLeagueRosters",
    "getManagerLeaguemates",
    "getManagerLeagueRosters",
    "getManagerWeekLineups",
  ];

  for (const name of scoped) {
    test(`${name} applies the scope`, () => {
      const fn = body(queries, name);
      const applies =
        fn.includes("${MANAGER_LEAGUE_SQL}") ||
        fn.includes("${IN_MANAGER_SCOPE_SQL}");
      assert.ok(applies, `${name} must narrow to the manager's own scope`);
      // Never the graph-only fragment, which is the one that cannot see a
      // departure.
      assert.ok(
        !fn.includes("${MANAGER_LEAGUE_GRAPH_SQL}"),
        `${name} must not read the graph predicate alone`,
      );
    });
  }

  test("player shares read the scope, not just the tombstone", () => {
    // A left league's roster row is frozen exactly as a deleted league's is, so
    // `LIVE_LEAGUE_SQL` alone leaves every player on a team the manager walked
    // away from counting toward their shares.
    const fn = body(queries, "getManagerRosters");
    assert.match(fn, /\$\{LIVE_LEAGUE_SQL\}/);
    assert.match(fn, /\$\{IN_MANAGER_SCOPE_SQL\}/);
  });

  test("the lineup ranks read the scope, which HOLDS_A_ROSTER_SQL cannot", () => {
    const fn = body(queries, "getManagerLeagueRosters");
    assert.match(fn, /\$\{HOLDS_A_ROSTER_SQL\}/);
    assert.match(fn, /\$\{IN_MANAGER_SCOPE_SQL\}/);
  });
});

describe("the tombstone probe is the deliberate exception", () => {
  test("getUnlistedManagerLeagueIds reads the graph predicate alone", () => {
    // It asks which stored leagues the enumeration has *stopped* naming.
    // Scoped by that same enumeration it would find nothing, by construction,
    // and no deletion would ever be tombstoned from this signal again.
    const fn = body(queries, "getUnlistedManagerLeagueIds");
    assert.match(fn, /\$\{MANAGER_LEAGUE_GRAPH_SQL\}/);
    assert.ok(!fn.includes("${MANAGER_LEAGUE_SQL}"));
    assert.ok(!fn.includes("${IN_MANAGER_SCOPE_SQL}"));
  });

  test("a league with no manager in the question is not scoped", () => {
    // `getLeagueLineupRow` is the timeline's read of one league by id. There is
    // no manager to scope by, and imposing one would empty a card over a fact
    // about the reader.
    const fn = body(queries, "getLeagueLineupRow");
    assert.ok(!fn.includes("${IN_MANAGER_SCOPE_SQL}"));
    assert.match(fn, /\$\{LIVE_LEAGUE_SQL\}/);
  });
});

describe("replaceManagerLeagueScope", () => {
  const fn = body(read("persist.ts"), "replaceManagerLeagueScope");

  test("has no early return on an empty enumeration", () => {
    // The guard that used to sit here was protecting against `sleeperGet`'s
    // `[]` fallback, which no longer reaches this function: only a confirmed
    // array does. Left in place it would make a manager who has left every
    // league permanently unable to be shown that.
    assert.ok(
      !/leagueIds\.length === 0\)\s*return/.test(fn),
      "a confirmed empty enumeration must replace the scope with nothing",
    );
  });

  test("replaces wholesale — delete then insert, in one transaction", () => {
    assert.match(fn, /withTransaction/);
    assert.match(fn, /DELETE FROM manager_league_order WHERE user_id = \$1 AND season = \$2/);
    assert.match(fn, /table: "manager_league_order"/);
  });

  test("stamps the marker inside the same transaction as the rows", () => {
    // Stamped separately, a crash between the two leaves a marker over somebody
    // else's snapshot — a page narrowed by an enumeration nobody made.
    assert.match(fn, /client\.query\(MANAGER_SCOPE_STAMP_SQL, \[userId, season\]\)/);
  });
});

describe("MANAGER_SCOPE_STAMP_SQL", () => {
  test("names scope_at and nothing else", () => {
    // Three columns, three questions. `attempt_at` says somebody tried,
    // `synced_at` says the graph is current, `scope_at` says Sleeper told us
    // which leagues are theirs — true of a run that then failed every graph,
    // and false of one that never got an answer.
    assert.match(MANAGER_SCOPE_STAMP_SQL, /INSERT INTO manager_syncs \(user_id, season, scope_at\)/);
    assert.match(MANAGER_SCOPE_STAMP_SQL, /DO UPDATE\s*\n?\s*SET scope_at = now\(\)/);
    assert.ok(!/attempt_at/.test(MANAGER_SCOPE_STAMP_SQL));
    assert.ok(!/synced_at/.test(MANAGER_SCOPE_STAMP_SQL));
  });

  test("the sync stamp still does not name scope_at", () => {
    // The reverse of the same rule: a run that could not read the enumeration
    // stamps its attempt without claiming to know the manager's leagues.
    assert.ok(!/scope_at/.test(MANAGER_SYNC_STAMP_SQL));
  });
});

describe("the migration", () => {
  const dir = join(process.cwd(), "db/migrations");
  const file = readdirSync(dir).find((f) => f.includes("manager_league_scope"));
  assert.ok(file, "the scope migration should exist");
  const sql = readFileSync(join(dir, file), "utf8");
  const [up, down] = sql.split("-- Down Migration");

  test("adds scope_at and drops it again", () => {
    assert.match(up, /ALTER TABLE manager_syncs ADD COLUMN IF NOT EXISTS scope_at TIMESTAMPTZ/);
    assert.match(down, /ALTER TABLE manager_syncs DROP COLUMN IF EXISTS scope_at/);
  });

  test("backfills only where an enumeration snapshot already exists", () => {
    // Order rows are only ever written by a wholesale replacement of a
    // successful enumeration, so marking those is recording a fact rather than
    // inventing one. Marking a manager with *no* order rows would read as
    // "confirmed: zero leagues" and empty their page on the deploy.
    assert.match(up, /UPDATE manager_syncs/);
    assert.match(up, /EXISTS \(SELECT 1 FROM manager_league_order mo/);
    assert.match(up, /ms\.scope_at IS NULL/);
  });
});

describe("the sync's enumeration path", () => {
  const sync = read("sync.ts");
  const fn = body(sync, "syncManagerLeaguesLocked");

  test("reads the enumeration through the shape that can say it failed", () => {
    assert.match(fn, /getUserLeaguesEnumeration\(userId, season\)/);
    assert.ok(
      !/getUserLeagues\(userId, season\)/.test(fn),
      "the fallback-folding read must not be what the scope is written from",
    );
  });

  test("an unreadable enumeration stamps the attempt and returns incomplete", () => {
    const arm = fn.slice(fn.indexOf("if (!enumeration.ok)"));
    assert.match(arm, /stampAttempt\(userId, season\)/);
    assert.match(arm, /complete: false/);
    // And crucially it returns *before* the scope write and the completeness
    // stamp below: `failed === 0 && partial === 0` is trivially true when
    // nothing was attempted, which is exactly how an ambiguous answer used to
    // be reported as a finished sync.
    assert.ok(
      arm.indexOf("return {") < arm.indexOf("replaceManagerLeagueScope"),
      "it must return before anything writes the scope",
    );
  });

  test("a transport failure stamps the attempt and rethrows", () => {
    const arm = fn.slice(fn.indexOf("} catch (error) {"));
    assert.match(arm.slice(0, 200), /stampAttempt\(userId, season\)/);
    assert.match(arm.slice(0, 200), /throw error/);
  });

  test("the scope is written from the enumeration, before any graph is fetched", () => {
    assert.ok(
      fn.indexOf("replaceManagerLeagueScope(userId, season, leagueIds)") <
        fn.indexOf("syncLeagueGraphs("),
      "a league the manager left must leave their scope even if every graph fails",
    );
  });

  test("completeness still counts partials as well as failures", () => {
    // Unchanged, and re-pinned here because the return above is a second way
    // out of this function: an edit that moved the stamp must not let either
    // path claim a complete sync.
    assert.match(fn, /const complete = failed === 0 && partial === 0;/);
  });
});
