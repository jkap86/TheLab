import type { ManagerLeague } from "./types";

/**
 * League list filtering. Kept apart from the control that renders it so the
 * matching rules — which encode Sleeper's settings quirks — can be read and
 * tested on their own.
 */

export type LeagueFilters = {
  /** Sleeper `settings.type`: "all" or a stringified 0=redraft, 1=keeper, 2=dynasty. */
  type: "all" | "0" | "1" | "2";
  /** Sleeper `settings.best_ball`: "all", or filter by best-ball on/off. */
  bestBall: "all" | "yes" | "no";
};

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  type: "all",
  bestBall: "all",
};

/** Read a numeric field out of a league's Sleeper `settings` blob. */
function settingNumber(league: ManagerLeague, key: string): number | undefined {
  const value = league.settings?.[key];
  return typeof value === "number" ? value : undefined;
}

/** Whether a league passes the active filters. */
export function matchesFilters(
  league: ManagerLeague,
  filters: LeagueFilters,
): boolean {
  if (filters.type !== "all") {
    // Sleeper omits `type` for standard redraft leagues; treat missing as 0.
    if ((settingNumber(league, "type") ?? 0) !== Number(filters.type)) {
      return false;
    }
  }
  if (filters.bestBall !== "all") {
    const isBestBall = settingNumber(league, "best_ball") === 1;
    if (filters.bestBall === "yes" ? !isBestBall : isBestBall) return false;
  }
  return true;
}
