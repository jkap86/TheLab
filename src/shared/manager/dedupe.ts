/**
 * Collapsing a fetched collection to one row per natural key.
 *
 * Pure and free of runtime imports it can't resolve, so it unit-tests like its
 * neighbours (`rank`, `draft-picks`, `matchups`); `persist` hands it what a sync
 * fetched, once per collection carrying a key Sleeper could repeat.
 */

/**
 * Keep one row per key, taking the last.
 *
 * **A multi-row INSERT carrying one key twice is a hard error even with an
 * `ON CONFLICT DO UPDATE` clause.** Postgres refuses the whole command — "cannot
 * affect row a second time" — rather than applying the clause, so that clause
 * only ever covers `bulkInsert`'s chunk boundaries and never a repeat inside a
 * chunk. Sleeper should not send one, but the cost if it does is this league's
 * entire sync transaction, every collection in it — and it repeats on every
 * retry, because the payload is what triggers it. That is the permanently
 * wedged league `partitionSyncFailures` exists to end, reached through a
 * different door — and note which door: a payload Postgres refuses is a league
 * Sleeper is still serving, so it parks rather than tombstones.
 *
 * The later row wins, which is what the conflict clause would have done.
 *
 * Callers spell a composite key by joining the parts with `:`, which is safe
 * only because no part can carry the separator — Sleeper's ids are digit
 * strings and its seasons four-digit years. A key with a free-text part (a
 * team name, a display name) wants a different join, or two rows that differ
 * become one.
 */
export function dedupeBy<T>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyOf(row), row);
  return [...byKey.values()];
}
