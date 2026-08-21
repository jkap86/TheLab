/**
 * Which stale week a capped horizon pass reaches for first.
 *
 * The horizon is sixteen weeks and a tick fetches {@link
 * HORIZON_WEEKS_PER_TICK} of them, so the pass is a rotation and the only
 * question is what sits at its head. Ascending by week number is the obvious
 * answer and it has one failure mode, which is not obvious at all: a week that
 * **fails to fetch**, or whose payload the completeness gate **refuses**,
 * deliberately stamps no freshness — that is what keeps it eager — and an
 * unstamped week is stale again next tick, and the tick after, and sorts ahead
 * of every week behind it every time. Two of them are the whole cap. Weeks 5
 * through 18 are then never *attempted*, not merely deferred, and the backfill
 * stops at whatever week it had reached and stays there.
 *
 * Nothing about that reads as a stall. The near window keeps refreshing on its
 * own clock, the log keeps naming the same two weeks as failed, `deferred`
 * keeps reporting the same count, and every rest-of-season number downstream
 * describes a two-week horizon without saying so — the plausible wrong answer
 * this codebase keeps meeting. It is the same shape as the league crawler's
 * first-sync wedge, where an unstamped manager sorted to the front of
 * `pendingManagers` and the corpus stopped growing, and it takes the same fix:
 * **stamp the attempt, order on the attempt, and leave freshness alone.**
 *
 * So a week's place in the queue is when it was last *tried*, and a week never
 * tried outranks every week that has been. Three consequences:
 *
 * - **A cold horizon still walks in week order.** Every week is null-attempt, so
 *   the tiebreaker is all there is and the pass runs 3,4 → 5,6 → … exactly as
 *   before. The change is invisible until something fails, which is when it
 *   should be.
 * - **A failing week costs one slot per pass, not the pass.** It rotates behind
 *   the untried weeks, comes back around once they are exhausted, and keeps
 *   retrying — the eagerness the freshness gate was protecting survives, it just
 *   stops being exclusive.
 * - **Freshness is untouched.** `attempt_at` orders and never gates; `synced_at`
 *   gates and never orders. A week that failed is still due, and a week that
 *   succeeded is still fresh for its TTL, which is what keeps a failed fetch
 *   from waiting out a day on the strength of having been tried.
 *
 * The comparator and the SQL are a matched pair with no compiler link between
 * them — `sync.staleWeeks` runs the fragment and the tests drive the function —
 * so both are built here, beside the rule they spell, and `horizon-queue.test.ts`
 * pins them against each other and against the migration that adds the column.
 */

/** One week's place in the queue, as this ordering reads it. */
export type WeekAttempt = {
  week: number;
  /**
   * When the week was last tried, in epoch milliseconds — success, failure or
   * refusal alike. Null for a week that has never been tried at all.
   */
  attemptAtMs: number | null;
};

/**
 * Order two stale weeks: never-tried first, then longest-since-tried, then by
 * week number.
 *
 * The week number is a tiebreaker rather than the key, which is the whole
 * change. It still decides the common case — a cold horizon, where every week
 * is null-attempt — and it stops deciding the one case where deciding by it is
 * a wedge.
 */
export function compareWeekAttempts(a: WeekAttempt, b: WeekAttempt): number {
  if (a.attemptAtMs === null && b.attemptAtMs !== null) return -1;
  if (a.attemptAtMs !== null && b.attemptAtMs === null) return 1;
  if (a.attemptAtMs !== null && b.attemptAtMs !== null) {
    if (a.attemptAtMs !== b.attemptAtMs) return a.attemptAtMs - b.attemptAtMs;
  }
  return a.week - b.week;
}

/** The same rule as a sort, non-mutating so a shared list can be ordered. */
export function orderWeeksByAttempt<T extends WeekAttempt>(
  weeks: readonly T[],
): T[] {
  return [...weeks].sort(compareWeekAttempts);
}

/**
 * The same rule as SQL, over a `projection_week_syncs` row aliased `s` outer-
 * joined to the requested weeks as `w(week)`.
 *
 * `NULLS FIRST` is written out because it is not the default for an ascending
 * sort, and it is the half that carries the rule: a week with no stamp at all is
 * a week never tried, and those go first.
 */
export const HORIZON_ORDER_SQL = `s.attempt_at NULLS FIRST, w.week` as const;

/**
 * Plain week order, for a list with no cap on it.
 *
 * The near window is three weeks and all of them are always fetched, so rotating
 * them buys nothing and costs the log its natural reading order. Spelled here rather
 * than inline so the two orderings are visibly a choice between alternatives.
 */
export const WEEK_ORDER_SQL = `w.week` as const;

/**
 * The two orderings and nothing else.
 *
 * These are interpolated into an `ORDER BY` rather than bound, so the closed
 * union is what stands in for validation — the `POINTS_COLUMN` rule, one layer
 * up: a value reaching SQL as anything but a bound parameter has to be one the
 * compiler can enumerate.
 */
export type WeekOrderSql = typeof HORIZON_ORDER_SQL | typeof WEEK_ORDER_SQL;
