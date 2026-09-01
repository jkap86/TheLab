import { Pool } from "pg";
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
 * Every wait it can do is bounded: a connection that can't be had, a statement
 * that runs long and a transaction whose client walked away all end in an error
 * the caller can answer with, rather than in a connection held until something
 * outside the process gives up.
 *
 * `ssl` is derived from the target host (see `dbSsl`) so managed providers like
 * Heroku Postgres, which require TLS, connect without extra configuration.
 */
const globalForPool = globalThis as unknown as { pgPool?: Pool };

/**
 * How many connections this process may hold.
 *
 * TheLabX derives this and the three timeouts below from a request-deadline
 * budget shared by every route, a background worker and a crawler. This app has
 * one database-backed route and no loops, so they are constants — the numbers
 * that budget produced for a small managed plan. The crawler port is what makes
 * a derivation earn its place again; the call sites do not move when it does.
 */
const DEFAULT_POOL_MAX = 10;

/**
 * How long a connection may sit idle in the pool before it is closed.
 *
 * `pg`'s own default, stated because the reasoning is not the usual one: the
 * connection limit here belongs to the *role*, not to this process, so an idle
 * connection is one another instance — or the migration runner on the next boot
 * — cannot have. Holding them costs nothing locally and something real
 * everywhere else, which is why this is not raised to keep connections warm.
 */
const IDLE_TIMEOUT_MS = 10_000;

/** How long a caller may queue for a pooled connection. */
const CONNECTION_TIMEOUT_MS = 5_000;

/** How long one statement — or one idle transaction — may run. */
const STATEMENT_TIMEOUT_MS = 20_000;

/**
 * `DATABASE_POOL_MAX`, when it is a positive integer.
 *
 * Junk falls back rather than throwing: a pool size is not worth refusing to
 * boot over, and the default is the safe end of the range either way.
 */
function poolMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DATABASE_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[db] Ignoring DATABASE_POOL_MAX="${raw}"; expected a positive integer.`,
    );
    return DEFAULT_POOL_MAX;
  }
  return parsed;
}

function createPool(): Pool {
  const created = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: dbSsl(),
    max: poolMax(),
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // Queueing for a connection is a wait like any other, and an unbounded one
    // is how a saturated pool turns every route into a hang: `pg`'s default is
    // to wait forever, so callers piled up behind the pool until the platform
    // killed them at its own deadline and their browsers asked again.
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    // The server-side half, and the one that actually stops work: Postgres
    // cancels the query and hands the connection back. Sent in the startup
    // packet, so it is in force on the first statement of every connection —
    // there is no window where a fresh connection runs unbounded.
    statement_timeout: STATEMENT_TIMEOUT_MS,
    // A transaction whose Node side is stuck holds row locks as well as a
    // connection, so it is bounded on the same number. Every transaction here
    // is pure database work with no upstream call inside it, which is what
    // makes this safe to set as low as a statement.
    idle_in_transaction_session_timeout: STATEMENT_TIMEOUT_MS,
    // Names the app in `pg_stat_activity`, so the next time a role runs out of
    // connections the question "who is holding them" has an answer that doesn't
    // depend on guessing from the query text.
    application_name: "thelab",
  });

  // An idle client's connection dropping emits `error` on the pool, and an
  // unhandled `error` on an `EventEmitter` takes the process down — so a
  // provider recycling a connection overnight would restart the server rather
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
