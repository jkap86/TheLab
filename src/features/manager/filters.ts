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

/**
 * The options each filter offers, in the order they're shown.
 *
 * They live here rather than in the control that renders them because the
 * vocabulary is now read in two places — the modal's buttons and
 * {@link filterSummary}, which names the active selection outside it. A modal
 * hides its own state, so the words on the header have to come from the same
 * table as the words in the dialog or the two drift into disagreeing about what
 * `bestBall: "no"` is called.
 */
export const TYPE_OPTIONS: { value: LeagueFilters["type"]; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
];

export const BEST_BALL_OPTIONS: {
  value: LeagueFilters["bestBall"];
  label: string;
}[] = [
  { value: "all", label: "All formats" },
  { value: "yes", label: "Best ball" },
  { value: "no", label: "Lineup" },
];

/** How many filters are narrowing the list — the count on the modal's trigger. */
export function activeFilterCount(filters: LeagueFilters): number {
  return (
    (filters.type !== "all" ? 1 : 0) + (filters.bestBall !== "all" ? 1 : 0)
  );
}

/**
 * The active selection in words, e.g. `"dynasty · lineup"` or `"all leagues"`.
 *
 * With the controls behind a modal, this is the only thing on the page saying
 * what the header's record and win pct are counted over — so it names the
 * *scope* of those numbers rather than decorating the trigger button.
 *
 * Lower case because it is read mid-sentence ("counting dynasty · lineup"),
 * where the buttons' own capitalised labels read as proper nouns. Same table
 * either way, so a renamed option can't say two different things.
 */
export function filterSummary(filters: LeagueFilters): string {
  const parts = [
    filters.type !== "all"
      ? TYPE_OPTIONS.find((o) => o.value === filters.type)?.label
      : null,
    filters.bestBall !== "all"
      ? BEST_BALL_OPTIONS.find((o) => o.value === filters.bestBall)?.label
      : null,
  ].filter((label): label is string => Boolean(label));
  return parts.length
    ? parts.map((label) => label.toLowerCase()).join(" · ")
    : "all leagues";
}

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
