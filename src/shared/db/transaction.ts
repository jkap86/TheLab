import type { PoolClient } from "pg";

import { pool } from "./pool";

/**
 * Run `fn` inside a transaction on a pooled client, committing on success and
 * rolling back on any throw. The client is always returned to the pool.
 *
 * Pass the `client` through to every query in `fn` — a query issued against the
 * pool instead would run on a different connection, outside this transaction.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A rollback that itself fails (a dropped connection, say) must not replace
    // the error that caused the abort — that one is the useful one.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[db] ROLLBACK failed:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
