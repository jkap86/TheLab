/**
 * The archive tier's freshness clock — when a `(season, week)` fetched once,
 * ever, is due again.
 *
 * **An archive week is stamped once and never asked about again, and that is
 * exactly right for the case it was written for and wrong for one empty
 * response.** How deep Sleeper's feed goes is discovered by probing: a season
 * it doesn't carry answers eighteen empty weeks, and the whole point of the
 * null TTL is that each of those costs one probe for the lifetime of the
 * database rather than one per tick forever. What that reasoning missed is that
 * "successful but empty" is not proof of anything — a 200 carrying only
 * placeholders is what an unsupported season looks like *and* what a bad
 * minute upstream looks like — so a single blip during the initial backfill
 * retired a week that had real historical data, permanently and silently.
 *
 * So an empty answer is *observed* rather than believed. A week is retired when
 * it stored rows (its observation count is 0) or when it has answered empty
 * {@link ARCHIVE_EMPTY_CONFIRMATIONS} times; one empty observation leaves it
 * due again, once {@link ARCHIVE_EMPTY_RETRY_MS} has passed.
 *
 * Three properties are what keep this from becoming the endless retry the null
 * TTL was protecting against:
 *
 * - **The count is a ceiling, not a streak against a clock.** A genuinely
 *   unsupported week costs exactly two probes in the lifetime of the database,
 *   not two per anything.
 * - **The confirming probe is deliberately a day out, not the next tick.** Two
 *   consecutive ticks are five minutes apart, which is well inside a single
 *   upstream incident — confirming that fast would make the second observation
 *   a copy of the first rather than a second opinion.
 * - **A non-empty answer resets the count to 0**, so a week that recovers is
 *   retired as a *stored* week and never carries a stale observation forward.
 *
 * The SQL and the predicate here are a matched pair with no compiler link
 * between them — `staleTargets` runs the SQL and `archiveStampIsFresh` is what
 * the tests drive — so the fragment is built here too, beside the rule it
 * spells, and `archive-clock.test.ts` pins the two against each other.
 */

/** Empty answers before an archive target is retired for good. */
export const ARCHIVE_EMPTY_CONFIRMATIONS = 2;

/** How long a once-empty archive target waits before its confirming probe. */
export const ARCHIVE_EMPTY_RETRY_MS = 24 * 60 * 60 * 1000;

/** One row of `stat_week_syncs`, as this clock reads it. */
export type ArchiveStamp = {
  /**
   * Consecutive empty answers for this week; 0 means the last successful fetch
   * stored rows.
   */
  emptyObservations: number;
  /** When that fetch happened, in epoch milliseconds. */
  syncedAtMs: number;
};

/**
 * Whether an archive target is retired — fresh under the null-TTL clock, so the
 * sync does not fetch it. A null stamp is a week never fetched at all, which is
 * always due.
 */
export function archiveStampIsFresh(
  stamp: ArchiveStamp | null,
  nowMs: number,
  options: {
    confirmations?: number;
    retryMs?: number;
  } = {},
): boolean {
  if (stamp === null) return false;
  const confirmations = options.confirmations ?? ARCHIVE_EMPTY_CONFIRMATIONS;
  const retryMs = options.retryMs ?? ARCHIVE_EMPTY_RETRY_MS;

  // Stored rows: final, the archive's original promise.
  if (stamp.emptyObservations <= 0) return true;
  // Confirmed empty: the feed does not carry this week.
  if (stamp.emptyObservations >= confirmations) return true;
  // Unconfirmed empty: held back until the retry window has passed, then due.
  return nowMs - stamp.syncedAtMs < retryMs;
}

/**
 * The same rule as SQL over a `stat_week_syncs` row aliased `s`. The two
 * placeholders are the caller's own bind positions — the confirmation count and
 * a `msInterval` string — so every value still arrives as a bound parameter.
 */
export function archiveStampFreshSql(
  confirmations: string,
  retryInterval: string,
): string {
  return `(s.empty_observations <= 0
            OR s.empty_observations >= ${confirmations}
            OR s.synced_at > now() - ${retryInterval}::interval)`;
}
