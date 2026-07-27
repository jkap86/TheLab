import type { SleeperNflState } from "@/shared/sleeper";

/** Last week Sleeper publishes regular-season projections for. */
export const LAST_REGULAR_WEEK = 18;

/** Weeks past the current one the sync keeps warm. */
export const PROJECTION_LOOKAHEAD = 1;

/**
 * Weeks the background sync should keep fresh, given the current NFL state.
 *
 * `display_week` is preferred over `week` because it is the week Sleeper's own UI
 * is pointed at — it rolls over once a week's games are done, which is exactly
 * when a lineup tool should start caring about the next one. In the offseason
 * `week` is 0 while `display_week` is already 1, and projections for that week
 * exist months ahead of kickoff, so there is no reason to sit idle until
 * September.
 *
 * Only ever a small window: past weeks never change once their games are played,
 * so re-fetching them would be 5.6MB spent to rewrite identical rows. Backfilling
 * one is a deliberate act — pass explicit weeks to `syncProjections`.
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

/** A parsed `?week=` list, or the reason it was rejected. */
export type ParsedWeeks =
  | { ok: true; weeks: number[] }
  | { ok: false; error: string };

/**
 * Validate week numbers from a query string, accepting the repeated-or-comma form
 * the other routes use (`?week=1&week=2` == `?week=1,2`).
 *
 * No values means "not specified" — an empty list, which callers read as "use the
 * current window" rather than "sync nothing".
 */
export function parseWeeks(values: string[]): ParsedWeeks {
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

  return { ok: true, weeks };
}
