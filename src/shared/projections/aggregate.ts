/**
 * Folding a player's weekly projections into one rest-of-season line.
 *
 * Pure and free of runtime imports so it can be unit-tested — the caller supplies
 * the rows (see `./queries`) and scores the result (see `./score`).
 *
 * Stat lines are summed rather than points, which is the part worth being
 * explicit about: scoring a projection is a dot product, so it is linear, and
 * `score(w1) + score(w2)` is exactly `score(w1 + w2)`. Summing first costs one dot
 * product per player instead of one per player-week, and rounds once instead of
 * once a week.
 */

/** One player's stored stat line for one week. */
export type PlayerWeekStats = {
  player_id: string;
  week: number;
  stats: Record<string, number> | null;
};

/** One player's summed projection over the weeks that had one. */
export type AggregatedProjection = {
  player_id: string;
  /** Stat line summed across `weeks`. */
  stats: Record<string, number>;
  /**
   * Weeks that contributed, ascending. Fewer than the horizon asked for means a
   * bye or an unpublished week, not a projected zero — a player on bye and a
   * player Sleeper hasn't projected both sum to the same total, and only this
   * tells them apart.
   */
  weeks: number[];
};

/**
 * Sum each player's stat lines across the rows given, keyed by player id.
 *
 * Non-numeric values are dropped rather than coerced: Sleeper's `stats` is
 * untyped JSON, and a single string sneaking in would turn a whole season's total
 * into `NaN`, which propagates silently through the lineup maths.
 *
 * A repeated (player, week) contributes once. The table's primary key makes that
 * unreachable today, but double-counting a week is the kind of error that reads
 * as a plausible projection rather than as a bug.
 */
export function aggregateWeeklyStats(
  rows: readonly PlayerWeekStats[],
): Record<string, AggregatedProjection> {
  const byPlayer = new Map<string, { stats: Record<string, number>; weeks: Set<number> }>();

  for (const row of rows) {
    if (!row?.player_id) continue;

    let entry = byPlayer.get(row.player_id);
    if (!entry) {
      entry = { stats: {}, weeks: new Set() };
      byPlayer.set(row.player_id, entry);
    }
    if (entry.weeks.has(row.week)) continue;
    entry.weeks.add(row.week);

    for (const [key, value] of Object.entries(row.stats ?? {})) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      entry.stats[key] = (entry.stats[key] ?? 0) + value;
    }
  }

  return Object.fromEntries(
    [...byPlayer].map(([player_id, { stats, weeks }]) => [
      player_id,
      { player_id, stats, weeks: [...weeks].sort((a, b) => a - b) },
    ]),
  );
}
