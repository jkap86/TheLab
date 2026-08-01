import type { SleeperNflState } from "@/shared/sleeper";

/** Last week Sleeper publishes regular-season projections for. */
export const LAST_REGULAR_WEEK = 18;

/** Weeks past the current one the sync keeps warm. */
export const PROJECTION_LOOKAHEAD = 1;

/**
 * Weeks the background sync keeps fresh at the news-cycle TTL: the one being
 * played and the one being set.
 *
 * `display_week` is preferred over `week` because it is the week Sleeper's own UI
 * is pointed at — it rolls over once a week's games are done, which is exactly
 * when a lineup tool should start caring about the next one. In the offseason
 * `week` is 0 while `display_week` is already 1, and projections for that week
 * exist months ahead of kickoff, so there is no reason to sit idle until
 * September.
 *
 * Deliberately narrow, because these are the weeks that move on news — a Friday
 * injury designation changes Sunday's numbers. The rest of the season is
 * {@link horizonWeeks}, refreshed far more slowly. Past weeks are in neither: they
 * never change once their games are played, so re-fetching one would be 5.6MB
 * spent to rewrite identical rows. Backfilling one is a deliberate act — pass
 * explicit weeks to `syncProjections`.
 */
export function targetWeeks(
  state: Pick<SleeperNflState, "week" | "display_week"> | null,
  lookahead: number = PROJECTION_LOOKAHEAD,
): number[] {
  const reported = state?.display_week || state?.week || 1;
  const first = Math.min(Math.max(Math.trunc(reported), 1), LAST_REGULAR_WEEK);
  const last = Math.min(first + Math.max(Math.trunc(lookahead), 0), LAST_REGULAR_WEEK);

  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/**
 * The rest of the regular season past {@link targetWeeks} — everything from the
 * end of that window to week 18.
 *
 * Sleeper publishes all 18 weeks months ahead of kickoff and they are real, not
 * padding: a back's rushing line moves week to week with the opponent, and a bye
 * shows up as the player being absent from that week entirely. Storing them is
 * what lets "rest of season" mean it rather than "the next fortnight".
 *
 * Separate from the near window because they age differently, not because they
 * matter less. A week-12 projection in July doesn't move hour to hour, so syncing
 * it on the same one-hour gate would re-download 90MB a day to rewrite the same
 * rows — see the two TTLs in `./sync`.
 */
export function horizonWeeks(
  state: Pick<SleeperNflState, "week" | "display_week"> | null,
  lookahead: number = PROJECTION_LOOKAHEAD,
): number[] {
  const near = targetWeeks(state, lookahead);
  const first = (near.at(-1) ?? 0) + 1;

  return Array.from(
    { length: Math.max(0, LAST_REGULAR_WEEK - first + 1) },
    (_, i) => first + i,
  );
}

/** A parsed `?week=` list, or the reason it was rejected. */
export type ParsedWeeks =
  | { ok: true; weeks: number[] }
  | { ok: false; error: string };

/**
 * The most weeks one request may name.
 *
 * A named week skips both freshness gates and both caps, and each one is a
 * ~5.6MB download held under the projections advisory lock — so the list is
 * bounded at the whole regular season, which is every week that exists. Anything
 * longer is duplicates or junk, and rejecting it beats spending an hour of
 * upstream budget discovering that.
 */
export const MAX_REQUESTED_WEEKS = LAST_REGULAR_WEEK;

/**
 * Validate week numbers from a query string, accepting the repeated-or-comma form
 * the other routes use (`?week=1&week=2` == `?week=1,2`).
 *
 * No values means "not specified" — an empty list, which callers read as "use the
 * current window" rather than "sync nothing".
 *
 * The count is checked on the *deduplicated* list: `?week=1,1,1,…` names one
 * week's work however long the string is, and failing it would be rejecting a
 * request this can answer cheaply.
 */
export function parseWeeks(
  values: string[],
  maxWeeks: number = MAX_REQUESTED_WEEKS,
): ParsedWeeks {
  const weeks: number[] = [];

  for (const raw of values.flatMap((v) => v.split(","))) {
    const token = raw.trim();
    if (!token) continue;

    const week = Number(token);
    if (!Number.isInteger(week) || week < 1 || week > LAST_REGULAR_WEEK) {
      return {
        ok: false,
        error: `week must be an integer from 1 to ${LAST_REGULAR_WEEK}, got "${token}"`,
      };
    }
    if (!weeks.includes(week)) weeks.push(week);
  }

  if (weeks.length > maxWeeks) {
    return {
      ok: false,
      error: `at most ${maxWeeks} week(s) may be requested, got ${weeks.length}`,
    };
  }

  return { ok: true, weeks };
}
