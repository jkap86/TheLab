/**
 * How long anything touching the database is allowed to wait, and how much of
 * the pool one request may hold — derived from the deadline the *platform*
 * enforces on the request that is waiting.
 *
 * Pure — the environment arrives as an argument — so the arithmetic can be
 * checked without a database or a deployment, the same shape as `./config`.
 *
 * The rule every number here exists to keep: **no wait may outlast the deadline
 * the request is already under.** Heroku's router answers H12/503 on the app's
 * behalf after 30 seconds and does not tell the dyno, so a query still running
 * at 31 seconds is work nobody is listening for — and, worse, it is still
 * holding the pool connection the *next* request needs. That is how one slow
 * read becomes an outage rather than a slow page: every caller queues on
 * `pool.connect()`, every queued caller is killed at 30 seconds, every killed
 * caller is retried by the browser, and the abandoned queries underneath never
 * stop. The observed end state is the pool full, the role's connection limit
 * hit (`53300`), and the background crawler unable to connect at all.
 *
 * So the waits are bounded, and bounded *shorter* than the deadline: the point
 * is that the app answers, not that it finishes.
 */

/**
 * The platform's own deadline on a request, in milliseconds.
 *
 * Heroku's router is what sets this one (30s, `H12 Request timeout`).
 * `REQUEST_DEADLINE_MS` overrides it for a host that enforces something else —
 * the budgets below are shares of it, so lowering it tightens all of them
 * together rather than leaving three numbers to be edited in step.
 */
export const REQUEST_DEADLINE_MS = 30_000;

/**
 * Connections one process may open, when nothing says otherwise.
 *
 * `pg`'s own default, kept deliberately: what changed is that it is now stated
 * and enforced once per process rather than per copy of this module. The
 * ceiling that matters is not this number but the *role's* — a Heroku Essential
 * plan caps the role at 20 connections across every dyno, every review app and
 * every `psql` session sharing the database — so a deployment running more than
 * one web dyno wants `DATABASE_POOL_MAX` set to its share rather than this.
 */
export const DEFAULT_POOL_MAX = 10;

/**
 * Waiting for a free pool connection: an eighth of the deadline.
 *
 * Short on purpose. A caller that cannot get a connection in five seconds is
 * behind a pool that is fully committed to work of its own, and queueing longer
 * only buys a slower failure — the request is killed at the deadline either
 * way. Failing here instead lets the route answer 503 while anyone is still
 * listening, and lets the browser's retry find a pool that has drained rather
 * than one it is adding to.
 */
const CONNECTION_SHARE = 1 / 6;

/**
 * Waiting for a per-key advisory lock: half the deadline.
 *
 * A blocking lock is taken where the caller needs the *result* — a manager's
 * league sync — so the wait has to be long enough for an ordinary sync ahead of
 * us to finish and short enough to leave room to serve what it wrote. Half is
 * that: the response still has fifteen seconds to be assembled and sent.
 */
const LOCK_WAIT_SHARE = 1 / 2;

/**
 * A single statement: two thirds of the deadline.
 *
 * This is the one the server enforces (`statement_timeout`), and it is the
 * reason an abandoned request stops costing anything — Postgres cancels the
 * query and the connection goes back to the pool, where previously it stayed
 * checked out until a read nobody would receive ran to completion. Two thirds
 * leaves the rest of the deadline for connecting, for the reads a route runs
 * before or after this one, and for serialising the answer.
 *
 * Background loops run under it too, deliberately: every one of them is
 * skip-and-retry shaped, so a tick cut short is retried on the next one, and a
 * statement that cannot finish in twenty seconds against this schema is a
 * finding rather than a cost to absorb quietly.
 */
const STATEMENT_SHARE = 2 / 3;

/**
 * How much of the pool one request may hold at once, as a fraction of it.
 *
 * A route that fans several reads out with `Promise.all` holds one connection
 * per read for as long as the slowest of them: `/api/user/…/adp-value` prices
 * each distinct ADP board with its own pair of queries, so a manager playing
 * across six boards took twelve connections out of ten — one request starving
 * the pool by itself, and two of them starving every other route on the dyno.
 * A third of the pool means three such requests can be in flight before anyone
 * queues, which is the point: a fan-out is a throughput optimisation for one
 * reader and must not be a denial of service for the rest.
 */
const FANOUT_SHARE = 1 / 3;

/** Every derived bound, in milliseconds except {@link DatabaseBudget.fanout}. */
export type DatabaseBudget = {
  /** Connections this process's pool may open. */
  poolMax: number;
  /** Waiting for a free pool connection before giving up. */
  connectionMs: number;
  /** Server-side cap on one statement (`statement_timeout`). */
  statementMs: number;
  /** Waiting for a blocking advisory lock before giving up. */
  lockWaitMs: number;
  /** Database queries one request may have in flight at once. */
  fanout: number;
};

/**
 * Read the budget from the environment.
 *
 * `DATABASE_POOL_MAX` and `REQUEST_DEADLINE_MS` are the only two knobs;
 * everything else is a share of them, so the ordering below — connect < lock
 * wait < statement < deadline — holds however they are set. Junk and
 * non-positive values fall back rather than failing the boot: an unparseable
 * pool size is a typo in a dashboard, and refusing to start over it would trade
 * a slow app for no app.
 */
export function databaseBudget(
  env: Record<string, string | undefined> = process.env,
): DatabaseBudget {
  const deadlineMs = positiveInt(env.REQUEST_DEADLINE_MS, REQUEST_DEADLINE_MS);
  const poolMax = Math.max(2, positiveInt(env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX));

  return {
    poolMax,
    connectionMs: share(deadlineMs, CONNECTION_SHARE),
    statementMs: share(deadlineMs, STATEMENT_SHARE),
    lockWaitMs: share(deadlineMs, LOCK_WAIT_SHARE),
    // At least two, or a route that reads two things concurrently would be
    // serialised by arithmetic; never the whole pool, which is the failure this
    // bound exists for and which wins where the two disagree.
    fanout: Math.min(poolMax - 1, Math.max(2, Math.floor(poolMax * FANOUT_SHARE))),
  };
}

/** A share of the deadline, in whole milliseconds and never zero. */
function share(deadlineMs: number, fraction: number): number {
  return Math.max(1, Math.round(deadlineMs * fraction));
}

/** A positive integer, or the fallback for anything else. */
function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A configured concurrency for work that holds a pool connection for its whole
 * duration, and what became of it.
 *
 * **The knob is a request, not a grant** — the rule `dbHeavyReadConcurrency`
 * already keeps for the analytical reads, applied to the two paths that hold a
 * connection for *longer* than any query does: a manager's league sync and a
 * league refresh each hold an advisory lock's session across a Sleeper fan-out
 * plus every read and write the graph needs. `MANAGER_SYNC_LIMIT=10` against a
 * pool of ten is not a wider budget, it is no budget — one manager able to take
 * every connection the process has, arrived at through the variable meant to
 * bound it, with nothing failing to say so.
 *
 * The ceiling is {@link DatabaseBudget.fanout} itself rather than the heavy
 * reads' `poolMax - fanout`, because these are not reads competing with an
 * ordinary request: each admitted unit *is* a request's worth of the pool held
 * for as long as Sleeper takes, so the honest cap is exactly what one request
 * may hold.
 */
export type FanoutLimit = {
  /** The bound to use: the request clamped, or the derived default. */
  limit: number;
  /** What the environment asked for, or null if it said nothing readable. */
  requested: number | null;
  /** The most this process grants however it is asked. */
  ceiling: number;
};

/**
 * Read one such knob.
 *
 * Junk, empty, zero, a negative and a decimal all fall back to the derived
 * default rather than failing the boot — the budget's own rule, and a zero
 * would be an admission that admits nobody, which is an outage rather than a
 * bound. The derived default is never clamped, because it *is* the reserved
 * share: a ceiling under the number the app picks for itself would be a clamp
 * arguing with its own default.
 */
export function fanoutLimit(
  value: string | undefined,
  budget: DatabaseBudget,
): FanoutLimit {
  const parsed = Number(value?.trim());
  const requested = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  const ceiling = budget.fanout;

  return {
    requested,
    ceiling,
    limit: requested === null ? ceiling : Math.min(requested, ceiling),
  };
}

/**
 * What to say about a request that was cut down, or null when there is nothing
 * to say.
 *
 * Pure, so the wording is testable and the `console.warn` stays one line at the
 * module's own initialisation — an operator who set a number this app will not
 * honour should be told once, at boot, rather than per request or not at all.
 */
export function clampNotice(name: string, limit: FanoutLimit): string | null {
  if (limit.requested === null || limit.requested <= limit.ceiling) return null;

  return (
    `Configured ${name}=${limit.requested} exceeds the safe database ` +
    `fan-out=${limit.ceiling}; using ${limit.ceiling}.`
  );
}
