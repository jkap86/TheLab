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
  let rollbackFailed = false;
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
      rollbackFailed = true;
      console.error("[db] ROLLBACK failed; dropping connection:", rollbackError);
    }
    throw error;
  } finally {
    // A client whose ROLLBACK failed may still be inside the aborted
    // transaction; a healthy release would hand the next borrower a connection
    // that rejects every query. Destroy it instead, as `lock.ts` does.
    client.release(rollbackFailed);
  }
}
