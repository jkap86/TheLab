import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { pool } from "@/shared/db";

import {
  getAdpLeagues,
  getLeagueAdpBoards,
  getLeaguemateIds,
  getLeaguesByIds,
  getManagerLeagueIds,
  getManagerLeagueRosters,
  getManagerLeaguemates,
  getManagerLeagues,
  getManagerMatchups,
  getManagerRosters,
  getUnlistedManagerLeagueIds,
} from "./queries.ts";

/**
 * Every read that answers "this manager's leagues" excludes tombstoned ones, and
 * every read that does not have a manager in the question keeps them.
 *
 * **This is a test about a `WHERE` clause because the regression it catches is
 * not an error.** A deleted league's rows are frozen rather than cleared —
 * `league_users` and `rosters` are only ever replaced by a sync of the league
 * itself, which a tombstoned league never gets again — so a read that forgets
 * `gone_at IS NULL` answers, typechecks, and hands back a league that no longer
 * exists, indefinitely. That is how a deleted league stayed on the leagues list
 * for the whole life of the marker: the marker gated the crawler's queue and
 * nothing else.
 *
 * The negative half is the load-bearing one. The row is kept **on purpose** —
 * its drafts still feed `/api/adp` and its completed trades are still market
 * history — so a well-meant "filter it everywhere" is a silent corpus shrink
 * with no error and no failing assertion anywhere else. Asserting both
 * directions is what keeps the two populations from being confused for one.
 *
 * It sits on the query-count tests' side of the testing rule and inherits their
 * safeguards: `new Pool(…)` does not connect, so importing the I/O module costs
 * nothing, and the statements are matched on the table they name rather than on
 * call order.
 */

const USER = "user-1";
const SEASON = "2025";

const restore = pool.query;
afterEach(() => {
  pool.query = restore;
});

/** Run a read against a database that records the SQL and answers nothing. */
async function statementsOf(run: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  pool.query = (async (text: string) => {
    seen.push(text);
    return { rows: [] };
  }) as unknown as typeof pool.query;
  await run();
  return seen;
}

/** Statements that read the `leagues` table under this module's `l` alias. */
const leagueReads = (statements: readonly string[]): string[] =>
  statements.filter((text) => /\bleagues l\b/.test(text));

const MANAGER_READS: ReadonlyArray<[string, () => Promise<unknown>]> = [
  ["getManagerLeagues", () => getManagerLeagues(USER, SEASON)],
  ["getManagerLeagueIds", () => getManagerLeagueIds(USER, SEASON)],
  ["getLeaguemateIds", () => getLeaguemateIds(USER, SEASON)],
  ["getManagerLeaguemates", () => getManagerLeaguemates(USER, SEASON)],
  ["getManagerLeagueRosters", () => getManagerLeagueRosters(USER, SEASON)],
  ["getManagerRosters", () => getManagerRosters(USER, SEASON)],
  ["getManagerMatchups", () => getManagerMatchups(USER, SEASON, 3)],
  [
    "getUnlistedManagerLeagueIds",
    () => getUnlistedManagerLeagueIds(USER, SEASON, ["kept"], 8),
  ],
];

/**
 * Reads with no manager in the question. A gone league is still a league these
 * describe: the ADP board averages its drafts and the trades board shows what
 * moved in it, which is the whole reason the row outlives the deletion.
 */
const CORPUS_READS: ReadonlyArray<[string, () => Promise<unknown>]> = [
  ["getLeaguesByIds", () => getLeaguesByIds(["l1"])],
  ["getAdpLeagues", () => getAdpLeagues([SEASON])],
  ["getLeagueAdpBoards", () => getLeagueAdpBoards(["l1"])],
];

describe("tombstoned leagues", () => {
  for (const [name, run] of MANAGER_READS) {
    test(`${name} excludes them`, async () => {
      const reads = leagueReads(await statementsOf(run));
      assert.ok(reads.length > 0, `${name} read no leagues`);
      for (const text of reads) {
        assert.match(text, /gone_at IS NULL/, `${name} does not filter gone_at`);
      }
    });
  }

  for (const [name, run] of CORPUS_READS) {
    test(`${name} keeps them`, async () => {
      const reads = leagueReads(await statementsOf(run));
      assert.ok(reads.length > 0, `${name} read no leagues`);
      for (const text of reads) {
        assert.doesNotMatch(
          text,
          /gone_at/,
          `${name} narrowed the corpus a deletion is kept for`,
        );
      }
    });
  }
});
