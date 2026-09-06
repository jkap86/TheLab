import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  TRADE_PARTICIPANTS_ORPHAN_SQL,
  TRADE_PARTICIPANTS_PRUNE_SQL,
  TRADE_PARTICIPANT_OWNERS_SQL,
  tradeParticipantsRebuildSql,
  tradeParticipantsSql,
} from "./sql.ts";

/**
 * The historical snapshot's immutability, pinned as text.
 *
 * **This is `sql.test.ts`'s and `crawl-writes.test.ts`'s bargain, for their
 * reason.** These are statements, not types: a conflict clause that grows one
 * more assignment typechecks, commits, and quietly rewrites who made every
 * trade in a league the first time a roster changes hands. Nothing throws and
 * nothing looks wrong — the board simply attributes A's trades to B — so the
 * only thing that can fail is an assertion that says why the column is not
 * there.
 *
 * Nothing here connects to a database. It reads the fragments the rebuild is
 * built from and the migration that shaped the table, and asserts the handful
 * of textual facts their doc comments spend paragraphs arguing for.
 */

const normalise = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

/** The `ON CONFLICT … DO UPDATE SET` half of the rebuild, and nothing before it. */
function conflictClause(sql: string): string {
  const at = sql.indexOf("ON CONFLICT");
  assert.notEqual(at, -1, "the rebuild should be an upsert");
  return sql.slice(at);
}

describe("the participants rebuild", () => {
  const rebuild = tradeParticipantsRebuildSql(" AND t.league_id = $1");

  test("it is an upsert, never a delete and re-derive", () => {
    // The delete *was* the bug. Re-deriving the league's rows on every sync
    // reads today's `rosters.owner_id`, so every trade of a roster that had
    // changed hands was re-attributed — in the circle, in the managers menu, in
    // the bay filter and on the card.
    assert.match(rebuild, /^INSERT INTO trade_participants/);
    assert.match(rebuild, /ON CONFLICT \(transaction_id, roster_id\) DO UPDATE SET/);
    assert.doesNotMatch(rebuild, /DELETE/i);
  });

  test("a repeated sync moves only what is about the present", () => {
    // The whole guarantee, and the reason it is spelled as an absence: there is
    // no branch here for a later edit to flatten — the shape `stampManagers`
    // takes to keep `synced_at` out of a discovery pass.
    const clause = conflictClause(rebuild);
    assert.match(clause, /owner_id = EXCLUDED\.owner_id/);
    assert.match(clause, /league_id = EXCLUDED\.league_id/);
    assert.doesNotMatch(
      clause,
      /owner_id_at_trade/,
      "the historical snapshot must never be rewritten by a re-sync",
    );
    assert.doesNotMatch(
      clause,
      /owner_provenance/,
      "how the snapshot was come by cannot change after the fact",
    );
    assert.doesNotMatch(clause, /first_seen_at/);
  });

  test("a new row stamps the snapshot from the owner it can see, marked as such", () => {
    // `'ingest'` is a claim about provenance rather than about accuracy: this is
    // the roster's owner when the app first observed the trade, which for a
    // regularly synced league is the trade-time owner and for one first synced
    // years later is not. The value is there so a reader can tell which.
    assert.match(
      normalise(rebuild),
      /select d\.transaction_id, d\.league_id, d\.roster_id, d\.owner_id, d\.owner_id, 'ingest'/,
    );
    assert.match(
      normalise(rebuild),
      /\(transaction_id, league_id, roster_id, owner_id, owner_id_at_trade, owner_provenance\)/,
    );
  });

  test("it reuses the one derivation rather than restating it", () => {
    // Two spellings of "who was in this trade" is the drift `sql.test.ts`
    // already pins the backfill against; the rebuild is that same fragment
    // wrapped, so there is nothing new to keep in step.
    assert.ok(rebuild.includes(tradeParticipantsSql(" AND t.league_id = $1")));
  });

  test("the narrowing reaches the derivation, so a rebuild is per league", () => {
    assert.ok(rebuild.includes("AND t.league_id = $1"));
    assert.equal(
      (rebuild.match(/\$1/g) ?? []).length,
      1,
      "one league id, bound once",
    );
  });
});

describe("the reconciling statements", () => {
  test("the prune asks `transactions` alone, never `rosters`", () => {
    // A pair leaves the derivation for two very different reasons: the trade
    // stopped naming that roster, and the roster is orphaned today. Only the
    // first is a reason to forget the history — asking `rosters` here would
    // delete the attribution of every trade whose roster happens to be
    // ownerless.
    assert.match(TRADE_PARTICIPANTS_PRUNE_SQL, /^DELETE FROM trade_participants tp/);
    assert.match(TRADE_PARTICIPANTS_PRUNE_SQL, /FROM transactions t/);
    assert.doesNotMatch(
      TRADE_PARTICIPANTS_PRUNE_SQL,
      /rosters/,
      "an orphaned roster is not a reason to forget who dealt",
    );
    assert.match(TRADE_PARTICIPANTS_PRUNE_SQL, /t\.type = 'trade' AND t\.status = 'complete'/);
    assert.match(TRADE_PARTICIPANTS_PRUNE_SQL, /tp\.league_id = \$1/);
  });

  test("the prune's roster id goes through the house guard", () => {
    // A junk roster id must yield null and match nothing, rather than failing
    // the statement and with it the whole league's transaction.
    assert.match(
      TRADE_PARTICIPANTS_PRUNE_SQL,
      /CASE WHEN ri ~ '\^\[0-9\]\+\$' THEN ri::int END/,
    );
  });

  test("the orphan pass clears today's owner and leaves the history", () => {
    assert.match(TRADE_PARTICIPANTS_ORPHAN_SQL, /SET owner_id = NULL/);
    assert.doesNotMatch(
      TRADE_PARTICIPANTS_ORPHAN_SQL,
      /owner_id_at_trade/,
      "who dealt is still known when nobody holds the seat",
    );
    assert.match(TRADE_PARTICIPANTS_ORPHAN_SQL, /tp\.league_id = \$1/);
  });

  test("all three narrow to one league, so a sync touches nobody else's rows", () => {
    for (const sql of [
      tradeParticipantsRebuildSql(" AND t.league_id = $1"),
      TRADE_PARTICIPANTS_PRUNE_SQL,
      TRADE_PARTICIPANTS_ORPHAN_SQL,
    ]) {
      assert.match(sql, /league_id = \$1/);
    }
  });

  test("the rebuild runs all three, in the order the prune needs", () => {
    // Prune before the orphan pass, so the update does not walk rows that are
    // about to go. Asserted against the module rather than a database, which is
    // the only place this ordering is visible at all.
    const whole = readFileSync(
      join(process.cwd(), "src/shared/trades/participants.ts"),
      "utf8",
    );
    // From the function body only — the import block above it lists the same
    // three names in a different (alphabetical) order.
    const body = whole.slice(whole.indexOf("export async function rebuildTradeParticipants("));
    const rebuildAt = body.indexOf("tradeParticipantsRebuildSql(");
    const pruneAt = body.indexOf("TRADE_PARTICIPANTS_PRUNE_SQL,");
    const orphanAt = body.indexOf("TRADE_PARTICIPANTS_ORPHAN_SQL,");
    assert.ok(rebuildAt > 0, "the rebuild upsert runs");
    assert.ok(pruneAt > rebuildAt, "the prune runs after the upsert");
    assert.ok(orphanAt > pruneAt, "the orphan pass runs after the prune");
  });
});

describe("the page's own read of the snapshot", () => {
  test("it is a correlated lookup in the target list, not a second round trip", () => {
    // Evaluated after the ordered index walk and its `LIMIT`, so this is a
    // primary-key probe for the hundred rows the page returns and for nothing
    // else. A read beside the page would be another pooled connection on the
    // request's critical path.
    assert.match(TRADE_PARTICIPANT_OWNERS_SQL, /tp\.transaction_id = t\.transaction_id/);
    assert.match(TRADE_PARTICIPANT_OWNERS_SQL, /jsonb_object_agg/);
    assert.match(TRADE_PARTICIPANT_OWNERS_SQL, /tp\.owner_id_at_trade/);
    assert.doesNotMatch(
      TRADE_PARTICIPANT_OWNERS_SQL,
      /tp\.owner_id\b(?!_)/,
      "a card names who dealt, not who holds the roster now",
    );
  });
});

describe("the migration that made the snapshot possible", () => {
  const migration = (() => {
    const dir = new URL("../../../db/migrations/", import.meta.url).pathname;
    const file = readdirSync(dir).find((n) => n.includes("trade_participant_history"));
    assert.ok(file, "the participant history migration is still there");
    return normalise(readFileSync(join(dir, file), "utf8"));
  })();

  test("the snapshot is NOT NULL, so no read needs a coalesce", () => {
    assert.ok(migration.includes("alter column owner_id_at_trade set not null"));
  });

  test("today's owner becomes nullable, because a seat can end up held by nobody", () => {
    // The alternative to a null is either deleting the row — throwing the
    // history away — or leaving a stale name in a column that means "now",
    // which is the same wrong claim this migration exists to stop making.
    assert.ok(migration.includes("alter column owner_id drop not null"));
  });

  test("existing rows are backfilled and marked as backfilled", () => {
    // They carry today's owner because that is the only thing that was ever
    // stored. Labelling them is what keeps anything downstream from mistaking
    // that for an observation.
    assert.ok(migration.includes("set owner_id_at_trade = owner_id"));
    assert.ok(migration.includes("owner_provenance = 'backfill'"));
  });

  test("both new read paths are indexed", () => {
    // The manager-side index for the reads with no `ORDER BY`, and a covering
    // index for the correlated bay probe — the primary key's own `INCLUDE`
    // names `owner_id` and cannot be altered.
    assert.ok(migration.includes("(owner_id_at_trade, transaction_id)"));
    assert.ok(
      migration.includes("(transaction_id, roster_id) include (owner_id_at_trade)"),
    );
    assert.ok(migration.includes("analyze trade_participants"));
  });

  test("it goes back down", () => {
    // The down path is the only thing that exercises these blocks, so the
    // constraint it has to restore is worth naming: rows with no current owner
    // cannot satisfy a `NOT NULL` and are re-derived by the next sync.
    const down = migration.slice(migration.indexOf("-- down migration"));
    assert.ok(down.includes("delete from trade_participants where owner_id is null"));
    assert.ok(down.includes("alter column owner_id set not null"));
    assert.ok(down.includes("drop column if exists owner_id_at_trade"));
  });
});
