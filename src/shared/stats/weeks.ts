import type { SleeperNflState } from "@/shared/sleeper";

// Relative and with the extension, never the projections barrel: this module is
// tested under Node's runner, and `weeks.ts` over there is pure — the same
// pure→pure seam `ppg.ts` takes to reach the scorer.
//
// **Imported rather than redeclared**, which matters more than it looks: a
// second `= 18` beside this one is two constants that agree today, and the day
// the NFL adds a week they disagree silently — the stats sync would stop one
// week short of what the projections sync is already publishing, which reads as
// a missing average rather than as a stale constant.
import { LAST_REGULAR_WEEK } from "../projections/weeks.ts";

/**
 * Which weeks the stats sync covers, on two clocks.
 *
 * The mirror image of `projections/weeks`, and the asymmetry is the point:
 * projections look *forward* — every week to the end of the season exists months
 * ahead — where a stat line only exists once the game has been played. So the
 * window here is bounded above by what the NFL has actually done, and the
 * backfill runs backwards through the season rather than forwards through it.
 *
 * Pure and free of runtime imports (the state shape arrives as an erased
 * `import type`), so it tests without a fetch behind it.
 */

/**
 * How many *finished* weeks stay on the fast clock alongside the one being
 * played.
 *
 * One, and it is the correction window rather than a round number. The NFL
 * revises a week's stats through the following Tuesday and Wednesday — a catch
 * reassigned, a fumble credited to someone else — so week 5's line is still
 * moving while week 6 is being played, and is final by week 7. Keeping exactly
 * one finished week hot is what catches those without holding the whole season
 * on an hourly gate.
 */
export const STATS_CORRECTION_WEEKS = 1;

/**
 * The regular-season weeks that have started, per NFL state.
 *
 * **`season_type` gates this, and `week` alone is a trap.** In the preseason
 * Sleeper reports `season_type: "pre"` with `week` counting *preseason* weeks
 * 1–4, so reading `week` on its own would claim that regular-season weeks 1
 * through 4 have been played and send the sync looking for stat lines that
 * cannot exist — every one of them coming back empty, stamped, and then filled
 * with real games later only because the live tier happens to reach them. Only
 * `"regular"` and `"post"` count regular-season weeks.
 *
 * The current week is included even though it is part-played: that is exactly
 * the week a lineup screen is being read against, and a stats week fills in over
 * five days rather than arriving at once.
 *
 * Clamped to {@link LAST_REGULAR_WEEK} because `week` keeps climbing through the
 * playoffs, where this table has nothing to say.
 */
export function playedWeeks(
  state: Pick<SleeperNflState, "week" | "season_type"> | null,
): number[] {
  const type = state?.season_type;
  if (type !== "regular" && type !== "post") return [];

  const current = Math.min(
    Math.max(Math.trunc(state?.week ?? 0), 0),
    LAST_REGULAR_WEEK,
  );
  return Array.from({ length: current }, (_, i) => i + 1);
}

/**
 * The weeks kept fresh on the news-cycle clock: the one being played, and the
 * {@link STATS_CORRECTION_WEEKS} behind it that are still being revised.
 *
 * Deliberately narrow. These are the only weeks whose numbers can still change,
 * and everything older is {@link settledWeeks} on a clock two orders of
 * magnitude slower.
 */
export function liveWeeks(
  state: Pick<SleeperNflState, "week" | "season_type"> | null,
  correctionWeeks: number = STATS_CORRECTION_WEEKS,
): number[] {
  const played = playedWeeks(state);
  const keep = 1 + Math.max(Math.trunc(correctionWeeks), 0);
  return played.slice(-keep);
}

/**
 * The played weeks behind the live window — final, and re-read rarely.
 *
 * Newest first, so the backfill's per-tick cap spends itself on the weeks
 * nearest the live window rather than starting at week 1. A points-per-game
 * average is wrong by the weeks it is missing whichever end they are at, but a
 * cold database mid-season should converge on the recent form a reader is
 * looking at first.
 */
export function settledWeeks(
  state: Pick<SleeperNflState, "week" | "season_type"> | null,
  correctionWeeks: number = STATS_CORRECTION_WEEKS,
): number[] {
  const played = playedWeeks(state);
  const live = new Set(liveWeeks(state, correctionWeeks));
  return played.filter((week) => !live.has(week)).reverse();
}

/**
 * The season before `season`, or null when it isn't a year.
 *
 * The stats table carries it for one reason: a points-per-game average has no
 * current-season weeks to read in week 1, and the honest stand-in is what the
 * player averaged last year. It is a finished season, so its weeks are settled
 * by definition and never enter the live tier.
 */
export function previousSeason(season: string): string | null {
  const year = Number(season);
  if (!Number.isInteger(year) || year < 1920) return null;
  return String(year - 1);
}

/** Every regular-season week, for backfilling a finished season whole. */
export function allRegularWeeks(): number[] {
  return Array.from({ length: LAST_REGULAR_WEEK }, (_, i) => i + 1);
}

/**
 * The finished seasons *behind* the previous one, newest first, down to
 * `floor` — the archive the comps pool is deep because of.
 *
 * Starts at two seasons back, because {@link previousSeason} is its own tier
 * with its own reason (the week-1 PPG fallback) and its own clock; these exist
 * for a different reader — a comp is worth little from a corpus one season
 * deep — and never enter either faster tier. Newest first, so a cold backfill
 * fills the seasons nearest living memory before the deep ones.
 *
 * The floor is a runaway stop, not a claim about availability: how far back
 * Sleeper actually has data is *discovered* by fetching — a season it doesn't
 * carry answers empty weeks, which are stamped once and never asked about
 * again, and a season that stores no rows never surfaces anywhere.
 */
export function archiveSeasons(season: string, floor: string): string[] {
  const year = Number(season);
  const floorYear = Number(floor);
  if (!Number.isInteger(year) || year < 1920) return [];
  if (!Number.isInteger(floorYear) || floorYear < 1920) return [];
  const count = year - 1 - floorYear;
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    String(year - 2 - i),
  );
}
