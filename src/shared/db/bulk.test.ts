import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { bulkInsert } from "./bulk.ts";

/**
 * The multi-row INSERT builder every persist path writes through.
 *
 * It fails the way the trades `WHERE` builder fails — not with an error but with
 * the wrong rows — because the placeholder arithmetic is per *chunk* and a
 * caller only ever sees the first statement. So these check the properties: that
 * every `$n` a statement writes has a value at that position in the array it is
 * run with, that a chunk restarts its own numbering, that the non-parameterised
 * halves (the table, the trailing column, the conflict clause) are the only
 * things spliced, and that an arity mismatch is caught here rather than sent to
 * Postgres.
 *
 * The `Queryable` the module takes is a one-method interface, so a recorder is
 * the whole of the fixture.
 */

type Statement = { sql: string; params: unknown[] };

/** A client that records rather than executes. */
function recorder() {
  const statements: Statement[] = [];
  return {
    statements,
    client: {
      query: async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params: params ?? [] });
        return { rows: [] };
      },
    } as never,
  };
}

/** Every `$n` a statement references, in the order written. */
const placeholders = (sql: string): number[] =>
  [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

type Row = { id: string; week: number };

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, week: i }));

const insert = {
  table: "picks",
  columns: ["player_id", "week"],
  values: (row: Row) => [row.id, row.week],
};

describe("bulkInsert", () => {
  test("an empty list issues no statement at all", async () => {
    // A no-op rather than an INSERT with no tuples, which Postgres rejects —
    // and every collection in the league graph can legitimately be empty.
    const { statements, client } = recorder();
    await bulkInsert(client, { ...insert, rows: [] });
    assert.equal(statements.length, 0);
  });

  test("one statement carries every row, with the values in column order", async () => {
    const { statements, client } = recorder();
    await bulkInsert(client, { ...insert, rows: rows(2) });

    assert.equal(statements.length, 1);
    assert.match(statements[0].sql, /INSERT INTO picks \(player_id, week\) VALUES/);
    assert.match(statements[0].sql, /\(\$1,\$2\),\(\$3,\$4\)/);
    assert.deepEqual(statements[0].params, ["p0", 0, "p1", 1]);
  });

  test("every placeholder resolves to a value in the array it is run with", async () => {
    // The property the arithmetic rests on: an off-by-one binds a column to the
    // neighbouring row's value rather than failing.
    const { statements, client } = recorder();
    await bulkInsert(client, {
      table: "draft_picks",
      columns: ["draft_id", "pick_no", "player_id"],
      rows: rows(7),
      values: (row) => [row.id, row.week, `x${row.week}`],
      chunkRows: 3,
    });

    for (const { sql, params } of statements) {
      const used = placeholders(sql);
      assert.deepEqual(used, [...used].sort((a, b) => a - b), "written in order");
      assert.equal(used.length, params.length, "one placeholder per value");
      assert.equal(Math.min(...used), 1, "numbering starts at 1");
      assert.equal(Math.max(...used), params.length, "and reaches the last value");
    }
  });

  test("each chunk is its own statement, numbering from $1 again", async () => {
    // A chunk's parameters are bound to that statement alone — continuing the
    // numbering across chunks would reference values Postgres was never sent.
    const { statements, client } = recorder();
    await bulkInsert(client, { ...insert, rows: rows(5), chunkRows: 2 });

    assert.equal(statements.length, 3);
    assert.deepEqual(
      statements.map((s) => s.params.length),
      [4, 4, 2],
      "2 + 2 + 1 rows of two columns",
    );
    for (const statement of statements) {
      assert.equal(Math.min(...placeholders(statement.sql)), 1);
    }
    // No row is lost or repeated across the seam.
    assert.deepEqual(
      statements.flatMap((s) => s.params.filter((_, i) => i % 2 === 0)),
      ["p0", "p1", "p2", "p3", "p4"],
    );
  });

  test("a row list shorter than the chunk is a single statement", async () => {
    const { statements, client } = recorder();
    await bulkInsert(client, { ...insert, rows: rows(1), chunkRows: 500 });
    assert.equal(statements.length, 1);
  });

  test("the trailing column is SQL, appended to the columns and to every tuple", async () => {
    // `now()` can't be a parameter — it is the one thing deliberately spliced,
    // and it has to appear once per row or the tuple arity stops matching.
    const { statements, client } = recorder();
    await bulkInsert(client, {
      ...insert,
      rows: rows(2),
      trailing: { column: "updated_at", sql: "now()" },
    });

    assert.match(statements[0].sql, /\(player_id, week, updated_at\)/);
    assert.match(statements[0].sql, /\(\$1,\$2,now\(\)\),\(\$3,\$4,now\(\)\)/);
    assert.equal(statements[0].params.length, 4, "it is not a parameter");
  });

  test("the conflict clause is appended verbatim, after the tuples", async () => {
    const { statements, client } = recorder();
    await bulkInsert(client, {
      ...insert,
      rows: rows(1),
      onConflict: "(player_id, week) DO UPDATE SET week = EXCLUDED.week",
    });
    assert.match(
      statements[0].sql,
      / ON CONFLICT \(player_id, week\) DO UPDATE SET week = EXCLUDED\.week$/,
    );
  });

  test("without a conflict clause it stays a plain INSERT", async () => {
    const { statements, client } = recorder();
    await bulkInsert(client, { ...insert, rows: rows(1) });
    assert.ok(!statements[0].sql.includes("ON CONFLICT"));
  });

  test("a values function of the wrong arity throws, naming the table", async () => {
    // Caught here rather than sent: a short tuple is a syntax error from
    // Postgres with nothing in it to say which caller wrote it.
    const { statements, client } = recorder();
    await assert.rejects(
      bulkInsert(client, {
        table: "picks",
        columns: ["player_id", "week"],
        rows: rows(1),
        values: () => ["only-one"],
      }),
      /bulkInsert\(picks\).*expected 2 values, got 1/,
    );
    assert.equal(statements.length, 0, "nothing was sent");
  });

  test("a mismatch is caught before the chunk it is in is sent", async () => {
    // The tuples are built before the statement runs, so a bad row anywhere in a
    // chunk stops that chunk — never half of one.
    const { statements, client } = recorder();
    await assert.rejects(
      bulkInsert(client, {
        ...insert,
        rows: rows(4),
        chunkRows: 2,
        values: (row) => (row.week === 3 ? [row.id] : [row.id, row.week]),
      }),
      /expected 2 values, got 1/,
    );
    assert.equal(statements.length, 1, "the first chunk went, the second did not");
  });

  test("a null column value is bound, not skipped", async () => {
    // Sleeper omits fields constantly, so null is the common case rather than an
    // error — the tuple keeps its width and the null goes down as a parameter.
    const { statements, client } = recorder();
    await bulkInsert(client, {
      table: "leagues",
      columns: ["league_id", "previous_league_id"],
      rows: [{ id: "l1", week: 0 }],
      values: () => ["l1", null],
    });
    assert.deepEqual(statements[0].params, ["l1", null]);
    assert.match(statements[0].sql, /\(\$1,\$2\)/);
  });
});
