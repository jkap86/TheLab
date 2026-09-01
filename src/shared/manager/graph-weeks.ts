import type { GraphWeeks, WeekRange } from "./graph";

/**
 * Last week of the NFL regular season, and so the ceiling for a season that has
 * finished.
 *
 * Declared here rather than imported: in TheLabX it lives in
 * `projections/weeks.ts`, which is the module that also decides which weeks of
 * projections to keep warm. That port has not landed, and a constant is
 * cheaper to move later than a dependency on a folder that does not exist is to
 * fake now — it moves back beside projections when they arrive.
 */
export const LAST_REGULAR_WEEK = 18;

/**
 * Which weeks of a league's week-keyed collections one sync fetches.
 *
 * Split out of `sync.ts` and pure — the "if a loop in the composition file
 * starts making a decision, that decision wants a pure module" rule — because
 * the decision it carries was quietly wrong for every season but the current
 * one: **the ceiling is a fact about the league's season, and it was being read
 * off the app's.**
 *
 * `syncLeagueGraphs` bounds both collections above by `currentWeek`, which comes
 * from `state/nfl` and therefore names a week of the season Sleeper is *in*. Fed
 * a 2024 league in the 2026 offseason — the season stepper walks back to 2017,
 * so this is a page a reader can reach — `flooredWeek` answers 1 and the league
 * is backfilled with exactly one week of transactions and one of matchups.
 * Worse, it stays there: the next sync reads a stored max week of 1, and
 * `max(currentWeek, stored)` is 1 again. Mid-season it is the same bug wearing a
 * plausible number — a past season fills in lockstep with the current week and
 * reaches week 18 only in January.
 *
 * A finished season has no live edge, so its ceiling is the whole regular
 * season. That is also what makes the retirement in `./sync-freshness` mean
 * anything: `SyncSummary.complete` is what licenses a past season to stop being
 * re-synced, and a graph that can never fetch past week 1 is never a graph worth
 * retiring.
 */

/**
 * Whether `leagueSeason` is a season the NFL has finished with, per the season
 * Sleeper's own state names.
 *
 * **Unparseable either side answers false**, which is the live ceiling and so
 * exactly the behaviour that existed before this module. The `crawl-ttl` rule:
 * fail toward the fresh tier, because extra fetches are the failure you can see
 * — where the other direction silently stops fetching the weeks a live season is
 * still playing.
 */
export function isFinishedSeason(
  leagueSeason: string | null | undefined,
  activeSeason: string | null | undefined,
): boolean {
  const league = seasonYear(leagueSeason);
  const active = seasonYear(activeSeason);
  if (league === null || active === null) return false;
  return league < active;
}

/**
 * What one sync knows about *now*.
 *
 * Both fields come off a single `state/nfl` read — the split `flooredWeek`
 * already exists for, and the reason the season travels with the week rather
 * than being resolved separately: the ceiling is a fact about the fetch (which
 * weeks can exist), so it must be decided from the same answer that says which
 * week is being played, not from a cache that may name a different season.
 */
export type SyncClock = {
  /** The current NFL week, floored to 1 — see `flooredWeek`. */
  currentWeek: number;
  /** The season Sleeper's state names, or null when the state was unreadable. */
  activeSeason: string | null;
};

/** The highest week worth fetching for a league of this season. */
export function graphWeekCeiling(
  leagueSeason: string | null | undefined,
  clock: SyncClock,
): number {
  return isFinishedSeason(leagueSeason, clock.activeSeason)
    ? LAST_REGULAR_WEEK
    : clock.currentWeek;
}

/**
 * The window of one week-keyed collection to re-fetch, given the highest week
 * already stored for it.
 *
 * From the stored week **minus one**, to catch late-settling waivers and trades
 * and the stat corrections that move a closed week's points; from week 1 when
 * nothing is stored, which backfills the league. The ceiling never drops below
 * what is already stored, so a collection that somehow ran ahead of the clock is
 * refreshed rather than truncated.
 */
export function collectionWeeks(
  stored: number | undefined,
  ceiling: number,
): WeekRange {
  return {
    from: stored ? Math.max(stored - 1, 1) : 1,
    to: Math.max(ceiling, stored ?? 1, 1),
  };
}

/** Both collections' windows for one league. Each is gated on its own stored
 *  week: they fill up independently, so one shared gate would open the window
 *  past a whole unfetched season. */
export function leagueGraphWeeks(
  leagueSeason: string | null | undefined,
  clock: SyncClock,
  stored: { transactions?: number; matchups?: number },
): GraphWeeks {
  const ceiling = graphWeekCeiling(leagueSeason, clock);
  return {
    transactions: collectionWeeks(stored.transactions, ceiling),
    matchups: collectionWeeks(stored.matchups, ceiling),
  };
}

/** A four-digit year as a number, or null for anything that isn't one. */
function seasonYear(season: string | null | undefined): number | null {
  return season && /^\d{4}$/.test(season) ? Number(season) : null;
}
