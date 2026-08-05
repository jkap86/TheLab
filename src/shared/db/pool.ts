import { Pool } from "pg";
import { databaseBudget } from "./budget";
import { dbSsl } from "./ssl";

/**
 * Shared pg connection pool.
 *
 * Cached on `globalThis` in **every** environment, which is the half of this
 * that matters. Development was the obvious case — HMR reloads the module and
 * would otherwise stack a pool per edit — but production is the expensive one:
 * a route bundle that gets its own copy of this module gets its own pool with
 * its own `max`, and nothing in the process knows the difference. Three copies
 * of a ten-connection pool is thirty connections from one dyno, which is past
 * the limit a managed Postgres role carries on a small plan and reads, from the
 * outside, as `too many connections for role` in a background loop that was
 * doing nothing unusual. One key, one pool, however many times this file is
 * evaluated.
 *
 * `pg` is externalized in next.config.ts, so this only ever runs on the Node.js
 * server.
 *
 * Every wait it can do is bounded (see `./budget`): a connection that can't be
 * had, a statement that runs long and a transaction whose client walked away
 * all end in an error the caller can answer with, rather than in a connection
 * held until something outside the process gives up.
 *
 * `ssl` is derived from the target host (see `dbSsl`) so managed providers like
 * Heroku Postgres, which require TLS, connect without extra configuration.
 */
const globalForPool = globalThis as unknown as { pgPool?: Pool };

/**
 * How long a connection may sit idle in the pool before it is closed.
 *
 * `pg`'s own default, stated because the reasoning is not the usual one: the
 * connection limit here belongs to the *role*, not to this process, so an idle
 * connection is one another dyno — or the migration runner on the next boot —
 * cannot have. Holding them costs nothing locally and something real everywhere
 * else, which is why this is not raised to keep connections warm.
 */
const IDLE_TIMEOUT_MS = 10_000;

function createPool(): Pool {
  const budget = databaseBudget(process.env);

  const created = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: dbSsl(),
    max: budget.poolMax,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // Queueing for a connection is a wait like any other, and an unbounded one
    // is how a saturated pool turns every route into a hang: `pg`'s default is
    // to wait forever, so callers piled up behind the pool until the platform
    // killed them at its own deadline and their browsers asked again.
    connectionTimeoutMillis: budget.connectionMs,
    // The server-side half, and the one that actually stops work: Postgres
    // cancels the query and hands the connection back. Sent in the startup
    // packet, so it is in force on the first statement of every connection —
    // there is no window where a fresh connection runs unbounded.
    statement_timeout: budget.statementMs,
    // A transaction whose Node side is stuck holds row locks as well as a
    // connection, so it is bounded on the same budget. Every transaction here
    // is pure database work with no upstream call inside it, which is what
    // makes this safe to set as low as a statement.
    idle_in_transaction_session_timeout: budget.statementMs,
    // Names the app in `pg_stat_activity`, so the next time a role runs out of
    // connections the question "who is holding them" has an answer that doesn't
    // depend on guessing from the query text.
    application_name: "the-lab",
  });

  // An idle client's connection dropping emits `error` on the pool, and an
  // unhandled `error` on an `EventEmitter` takes the process down — so a
  // provider recycling a connection overnight would restart the dyno rather
  // than cost one connection. `pg` has already removed the client from the pool
  // by the time this runs; there is nothing to do but say so. Attached here
  // rather than beside the export so a re-evaluated module doesn't stack
  // listeners on the pool it just found cached.
  created.on("error", (error) => {
    console.error("[db] Idle client error; connection discarded:", error);
  });

  return created;
}

export const pool: Pool = (globalForPool.pgPool ??= createPool());
