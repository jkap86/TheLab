/**
 * The NFL week vocabulary: how many weeks a regular season has, and how to read
 * one a caller asked for.
 *
 * Pure and free of runtime imports, so both the sync's week windows
 * (`manager/graph-weeks`) and the routes' query parsing can read it under
 * Node's test runner.
 *
 * `LAST_REGULAR_WEEK` lived in `manager/graph-weeks.ts` until the week-scoped
 * projections landed, and that file said why: it belongs beside the module that
 * also decides which weeks of projections to read, and "it moves back beside
 * projections when they arrive". This is that arrival. `manager` still
 * re-exports it, so nothing that imported it from there had to change.
 */

/**
 * Last week of the NFL regular season, and so the ceiling for a season that has
 * finished — and for any week a caller may ask about. The playoffs are a
 * different bracket per league and Sleeper keys them past this; nothing here
 * reads them.
 */
export const LAST_REGULAR_WEEK = 18;

/** Whether a number names a week of the regular season. */
export function isPlausibleWeek(week: number): boolean {
  return Number.isInteger(week) && week >= 1 && week <= LAST_REGULAR_WEEK;
}

/**
 * What a `?week=` parameter resolved to: the week, or why it was refused.
 *
 * Shaped like `season/parseRequestedWeek`'s sibling `RequestedSeason` on
 * purpose — a route reading both should read them the same way.
 */
export type RequestedWeek =
  | { ok: true; week: number }
  | { ok: false; error: string };

/**
 * A `?week=` query parameter, in **three states rather than two**.
 *
 * `null` means *not asked*, and it is the only one a caller may fill from a
 * resolver. An invalid value is an error, never a silent fallback: collapsing
 * absent and invalid is how `?week=abc` quietly becomes the current week and a
 * reader is shown one week's lineup under another week's heading. It is the
 * same rule, for the same reason, that `parseRequestedSeason` documents at
 * length for `?season=`.
 *
 * Whitespace-only is treated as absent — a blank `?week=` is a URL builder's
 * artefact rather than anybody's question.
 */
export function parseRequestedWeek(raw: string | null): RequestedWeek | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const week = Number(trimmed);
  if (!isPlausibleWeek(week)) {
    return {
      ok: false,
      error: `Invalid week: expected 1-${LAST_REGULAR_WEEK}`,
    };
  }
  return { ok: true, week };
}

/**
 * A week clamped into the regular season.
 *
 * The preseason answers week 0 and the postseason counts past 18, and both are
 * weeks this app has no projections or matchups for — so each is folded to the
 * nearest week that exists rather than being refused, since the caller asking
 * is a *default* (see the route's resolve) and a default that fails is a page
 * that fails.
 */
export function clampWeek(week: number): number {
  if (!Number.isFinite(week)) return 1;
  return Math.min(Math.max(Math.trunc(week), 1), LAST_REGULAR_WEEK);
}
