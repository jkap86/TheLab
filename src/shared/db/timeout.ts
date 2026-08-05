/**
 * Telling "the database ran out of room" apart from "this read is broken".
 *
 * Pure, and deliberately importing nothing: it is matched against errors thrown
 * from four different layers (Postgres, the pool, the advisory-lock helper,
 * `pg`'s socket) and it has to stay testable without any of them.
 *
 * The distinction is worth drawing because the two want opposite answers. A
 * failed read is a 500 and a bug report; a read that ran out of *budget* is a
 * 503 and a retry, and answering it as a 500 tells a caller to stop asking for
 * something that would have worked a second later. It is also the only signal a
 * client has that backing off is the useful thing to do.
 */

/**
 * Postgres error codes that mean a bound was reached rather than a query being
 * wrong. All four are ours: the first three are the timeouts this app sets on
 * every connection, and the last is the role's connection limit — the one
 * nobody sets and everybody eventually finds.
 */
const BUSY_CODES = new Set([
  /** `query_canceled` — what `statement_timeout` raises. */
  "57014",
  /** `lock_not_available` — what `lock_timeout` raises. */
  "55P03",
  /** `idle_in_transaction_session_timeout`. */
  "25P03",
  /** `too_many_connections` — the role is at its limit. */
  "53300",
]);

/**
 * What `pg`'s pool rejects with when `connectionTimeoutMillis` runs out.
 *
 * Matched on the message because it is a bare `Error` with no code — fragile,
 * and the reason there is a test pinning the exact string: if `pg` ever renames
 * it the test is what says so, rather than a 500 quietly replacing a 503 in
 * production.
 */
const POOL_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

/**
 * Whether an error means the database had no room, rather than the read being
 * wrong.
 *
 * The advisory-lock timeout is matched by `name` rather than with `instanceof`,
 * so this module stays free of runtime imports — `AdvisoryLockTimeoutError`
 * lives beside a module that loads `pg`, and importing it here would make this
 * one untestable for the sake of one comparison.
 */
export function isDatabaseBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { code, message, name } = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };

  if (typeof code === "string" && BUSY_CODES.has(code)) return true;
  if (name === "AdvisoryLockTimeoutError") return true;
  return typeof message === "string" && message.includes(POOL_TIMEOUT_MESSAGE);
}
