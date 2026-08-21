import type { SleeperNflState } from "@/shared/sleeper";

/** Last week Sleeper publishes regular-season projections for. */
export const LAST_REGULAR_WEEK = 18;

/**
 * Weeks past the current one the sync keeps warm.
 *
 * Two rather than one because the week being *set* is not the only week being
 * decided: a waiver claim or a trade is made against the week after it, so the
 * week-after-next is already load-bearing while it is still on the horizon's
 * day-long clock. Widening the near window is what moves it onto the hourly one.
 *
 * The cost is one more ~5.6MB fetch an hour and one fewer week on the horizon —
 * paid against the near tier's clock, not the horizon's, which is why this is a
 * different decision from raising `HORIZON_WEEKS_PER_TICK`.
 */
export const PROJECTION_LOOKAHEAD = 2;

/**
 * The earliest **regular-season** week that has not been played, as Sleeper's
 * state reports it.
 *
 * `week` and `display_week` are only regular-season week numbers when
 * `season_type` says the regular season is what is being played. In preseason
 * they count *preseason* weeks — `{week: 2, display_week: 2, season_type:
 * "pre"}` is the second week of August, while regular-season week 1 is still
 * three weeks out — so reading them unqualified walks the sync's near window
 * forward one regular-season week per preseason week and abandons the weeks it
 * leaves behind. Week 1 is in neither tier at that point: it sorts before the
 * near window, which makes it a *past* week to {@link horizonWeeks}, and past
 * weeks are never re-fetched. Observed in production on 2026-08-21, with week 1
 * five days stale and weeks 2 and 3 being refreshed hourly for a season whose
 * first game had not been played.
 *
 * So only `"regular"` and `"post"` are read as naming a regular-season week —
 * the `manager/crawl-ttl` rule, which matches `"regular"` by name for the same
 * reason: Sleeper labels the rest of the year `"pre"` and `"off"`, and a value
 * this does not recognise must not be read as a week number.
 *
 * **`season_start_date` is deliberately not consulted.** It is the obvious
 * second signal and it is wrong here: the 2026 state carries `2026-08-06` while
 * week 1's own `game_date` rows say September 9th, so it is naming the
 * preseason opener. `crawl-ttl` uses it to size a *TTL*, where being a month out
 * costs extra fetches; using it to pick a week would cost the wrong week.
 *
 * Everything else — preseason, offseason, an unrecognised label, no state at
 * all — answers 1, which is also what an unreachable Sleeper has always
 * answered here.
 */
export function regularSeasonWeek(
  state: Pick<SleeperNflState, "week" | "display_week" | "season_type"> | null,
): number {
  if (state?.season_type !== "regular" && state?.season_type !== "post") {
    return 1;
  }
  return state.display_week || state.week || 1;
}

/**
 * Weeks the background sync keeps fresh at the news-cycle TTL: the one being
 * played, the one being set, and the one being planned for.
 *
 * `display_week` is preferred over `week` because it is the week Sleeper's own UI
 * is pointed at — it rolls over once a week's games are done, which is exactly
 * when a lineup tool should start caring about the next one. Which of them is a
 * *regular-season* week is {@link regularSeasonWeek}'s question, and in the
 * offseason and preseason the answer is 1: projections for week 1 exist months
 * ahead of kickoff, so there is no reason to sit idle until September, and no
 * reason to walk past it either.
 *
 * Deliberately narrow, because these are the weeks that move on news — a Friday
 * injury designation changes Sunday's numbers. The rest of the season is
 * {@link horizonWeeks}, refreshed far more slowly. Past weeks are in neither: they
 * never change once their games are played, so re-fetching one would be 5.6MB
 * spent to rewrite identical rows. Backfilling one is a deliberate act — pass
 * explicit weeks to `syncProjections`.
 */
export function targetWeeks(
  state: Pick<SleeperNflState, "week" | "display_week" | "season_type"> | null,
  lookahead: number = PROJECTION_LOOKAHEAD,
): number[] {
  const first = Math.min(
    Math.max(Math.trunc(regularSeasonWeek(state)), 1),
    LAST_REGULAR_WEEK,
  );
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
  state: Pick<SleeperNflState, "week" | "display_week" | "season_type"> | null,
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
