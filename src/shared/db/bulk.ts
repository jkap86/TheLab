import type { PoolClient } from "pg";

type Queryable = Pick<PoolClient, "query">;

type BulkInsert<T> = {
  table: string;
  /** Parameterised columns, in the order `values` returns them. */
  columns: string[];
  rows: readonly T[];
  /** Map a row to exactly `columns.length` parameter values. */
  values: (row: T) => unknown[];
  /**
   * Non-parameterised columns appended to every row tuple — e.g.
   * `{ column: "updated_at", sql: "now()" }`.
   *
   * A list is accepted because freshness is *two* columns wherever it is
   * written honestly: `leagues` carries `updated_at` (the last complete graph
   * refresh) beside `sync_attempt_at` (the last time anybody tried), and a row
   * inserted for a league whose first sync failed has to say something different
   * in each. One `trailing` would have meant one of them taking its column
   * default, which is exactly the "a default is a claim" bug this pair exists to
   * stop.
   */
  trailing?: { column: string; sql: string } | readonly { column: string; sql: string }[];
  /** Clause after `ON CONFLICT ` for upserts (omit for a plain INSERT). */
  onConflict?: string;
  /** Rows per statement. Default 500 keeps params well under Postgres' 65535. */
  chunkRows?: number;
};

/**
 * Insert `rows` as chunked multi-row INSERTs — one round-trip per ~`chunkRows`
 * rows instead of one per row. No-op on an empty list.
 */
export async function bulkInsert<T>(
  client: Queryable,
  { table, columns, rows, values, trailing, onConflict, chunkRows = 500 }: BulkInsert<T>,
): Promise<void> {
  if (rows.length === 0) return;

  const perRow = columns.length;
  const trailingColumns = trailing
    ? Array.isArray(trailing)
      ? trailing
      : [trailing as { column: string; sql: string }]
    : [];
  const colSql = [...columns, ...trailingColumns.map((t) => t.column)].join(", ");
  const conflictSql = onConflict ? ` ON CONFLICT ${onConflict}` : "";

  for (let start = 0; start < rows.length; start += chunkRows) {
    const chunk = rows.slice(start, start + chunkRows);
    const params: unknown[] = [];

    const tuples = chunk.map((row, r) => {
      const rowValues = values(row);
      if (rowValues.length !== perRow) {
        throw new Error(
          `bulkInsert(${table}): expected ${perRow} values, got ${rowValues.length}`,
        );
      }
      const base = r * perRow;
      const placeholders = Array.from(
        { length: perRow },
        (_, c) => `$${base + c + 1}`,
      );
      for (const { sql } of trailingColumns) placeholders.push(sql);
      params.push(...rowValues);
      return `(${placeholders.join(",")})`;
    });

    await client.query(
      `INSERT INTO ${table} (${colSql}) VALUES ${tuples.join(",")}${conflictSql}`,
      params,
    );
  }
}
