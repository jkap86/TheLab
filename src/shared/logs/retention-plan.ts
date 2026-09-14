/**
 * How long a visit is kept, and how the rows past that are removed — the pure
 * half of `./retention`, which is the loop.
 *
 * **Rows used to be kept for ever**, on the argument that the read is windowed
 * and indexed so a growing table cost nothing a reader could see. That was true
 * of the read and said nothing about the table: with the beacon and the proxy
 * both writing, an address log that never forgets is the one place this app
 * accumulates personal data without bound, and a scanner's month is rows
 * nobody asked for on a Basic dyno's disk. Ninety days is the default —
 * long enough that a season's traffic is readable, short enough to be a
 * retention policy rather than an archive — and `off` is a deliberate opt-out,
 * on `loopSwitch`'s spelling, for an operator who wants the archive.
 *
 * **Deletion is batched and the batch is bounded**, because a single
 * `DELETE … WHERE seen_at < …` over a table that has never been pruned is one
 * long transaction holding locks and generating dead tuples for the length of
 * it, beside requests. Each batch removes the oldest `RETENTION_BATCH` rows and
 * a tick runs at most `RETENTION_MAX_BATCHES_PER_TICK` of them, then yields to
 * the next tick; a backlog drains over a few ticks rather than in one.
 *
 * **The delete walks the read's own index.** `(seen_at DESC, id DESC)` serves
 * `ORDER BY seen_at, id LIMIT n` backwards, so picking the oldest rows is an
 * index scan and not a sort of the table.
 */

export const VISITOR_LOG_RETENTION_VAR = "VISITOR_LOG_RETENTION_DAYS";

export const DEFAULT_VISITOR_LOG_RETENTION_DAYS = 90;
export const MIN_VISITOR_LOG_RETENTION_DAYS = 1;
export const MAX_VISITOR_LOG_RETENTION_DAYS = 3650;

/** Rows removed per statement. */
export const RETENTION_BATCH = 5_000;
/** Statements per tick before the loop yields to its next interval. */
export const RETENTION_MAX_BATCHES_PER_TICK = 20;
/** How often the loop looks. */
export const RETENTION_INTERVAL_MS = 6 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

export type RetentionPolicy =
  | { enabled: true; days: number; retentionMs: number; warning?: string }
  | { enabled: false; reason: string; warning?: string };

/** What the environment says about retention. */
export function retentionPolicy(env: Record<string, string | undefined>): RetentionPolicy {
  const raw = env[VISITOR_LOG_RETENTION_VAR]?.trim();
  if (!raw) {
    return {
      enabled: true,
      days: DEFAULT_VISITOR_LOG_RETENTION_DAYS,
      retentionMs: DEFAULT_VISITOR_LOG_RETENTION_DAYS * DAY_MS,
    };
  }
  if (raw.toLowerCase() === "off") {
    return { enabled: false, reason: `${VISITOR_LOG_RETENTION_VAR}=off` };
  }
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_VISITOR_LOG_RETENTION_DAYS ||
    parsed > MAX_VISITOR_LOG_RETENTION_DAYS
  ) {
    return {
      enabled: true,
      days: DEFAULT_VISITOR_LOG_RETENTION_DAYS,
      retentionMs: DEFAULT_VISITOR_LOG_RETENTION_DAYS * DAY_MS,
      warning:
        `${VISITOR_LOG_RETENTION_VAR}=${JSON.stringify(raw)} is not "off" or a whole number of days ` +
        `between ${MIN_VISITOR_LOG_RETENTION_DAYS} and ${MAX_VISITOR_LOG_RETENTION_DAYS}; ` +
        `using ${DEFAULT_VISITOR_LOG_RETENTION_DAYS}.`,
    };
  }
  return { enabled: true, days: parsed, retentionMs: parsed * DAY_MS };
}

/**
 * One batch: the oldest `$2` rows past the cutoff `$1`, by id, so the delete
 * is bounded whatever the table holds and never scans forward through rows it
 * is keeping.
 */
export const PRUNE_VISITOR_LOGS_SQL = `
  DELETE FROM visitor_logs
   WHERE id IN (
         SELECT id
           FROM visitor_logs
          WHERE seen_at < now() - $1::interval
          ORDER BY seen_at ASC, id ASC
          LIMIT $2
   )`;

/**
 * Whether a tick that has run `batches` statements, the last removing
 * `lastDeleted` rows, should run another: only while a batch came back full
 * and the tick's own budget is not spent. A short batch is the end of the
 * backlog; a spent budget is the next tick's turn.
 */
export function pruneContinues(
  batches: number,
  lastDeleted: number,
  batch: number = RETENTION_BATCH,
  maxBatches: number = RETENTION_MAX_BATCHES_PER_TICK,
): boolean {
  return lastDeleted >= batch && batches < maxBatches;
}
