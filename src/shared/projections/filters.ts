/**
 * Query-string parsing for `GET /api/projections`.
 *
 * Pure so it can be unit-tested, and so the SQL beside it only ever sees
 * checked values — `scoring` in particular decides which column is interpolated
 * into `ORDER BY`, which is only safe because it is constrained to this enum
 * here. The parsing primitives come from `shared/query`, imported relatively
 * with a `.ts` extension so Node's test runner can resolve the chain.
 */

import { booleanFlag, integer, isSeason, list } from "../query/parse.ts";
import { LAST_REGULAR_WEEK } from "./weeks.ts";

const SCORINGS = ["std", "half_ppr", "ppr"] as const;

/** Which of Sleeper's three scorings to rank and report by. */
export type ProjectionScoring = (typeof SCORINGS)[number];

export const PROJECTIONS_LIMIT_MAX = 1000;

/** A validated `/api/projections` query. `null` means "don't filter on this". */
export type ProjectionFilters = {
  season: string;
  /** null when the caller didn't say; the route resolves it to the latest stored week. */
  week: number | null;
  scoring: ProjectionScoring;
  /** Positions from the players cache, e.g. `["WR", "TE"]`. */
  positions: string[] | null;
  player_ids: string[] | null;
  /** Include the full projected stat line per player. Off by default — it is ~27 keys a row. */
  include_stats: boolean;
  limit: number;
  offset: number;
};

export const PROJECTION_FILTER_DEFAULTS: {
  scoring: ProjectionScoring;
  limit: number;
  offset: number;
} = {
  // PPR is the format most Sleeper leagues use, and the one `order_by` on the
  // upstream endpoint defaults to.
  scoring: "ppr",
  limit: 100,
  offset: 0,
};

export type ParsedProjectionFilters =
  | { ok: true; filters: ProjectionFilters }
  | { ok: false; error: string };

/**
 * Whether {@link parseProjectionFilters} will read its `defaultSeason`.
 *
 * The ADP filters' predicate of the same name, for the same reason: the route
 * resolves a season only where the answer is used, so `?season=2024` never waits
 * on Sleeper's state call. Simpler here because a projections read has no date
 * bound to bound it another way — a blank `season=` is no season, matching what
 * the parser itself reads.
 */
export function usesDefaultSeason(params: URLSearchParams): boolean {
  return !params.get("season")?.trim();
}

/**
 * Validate a projections query string. `defaultSeason` is passed in rather than
 * imported so this module stays dependency-free; the route supplies the season
 * the app is operating in.
 *
 * It may be `null` where the caller checked {@link usesDefaultSeason} and found
 * none was wanted. Null on the path that does want one is refused rather than
 * left to become an undefined season in a query.
 *
 * `stats` is an on/off flag (`booleanFlag`, absent → false): it switches a
 * feature on, unlike the ADP filters' tri-state booleans that narrow a
 * population.
 */
export function parseProjectionFilters(
  params: URLSearchParams,
  defaultSeason: string | null,
): ParsedProjectionFilters {
  const season = params.get("season")?.trim();
  if (season && !isSeason(season)) {
    return { ok: false, error: `Invalid season: ${season}. Expected a 4-digit year.` };
  }
  // The only path that reads the argument, so this is where its absence is
  // caught — unreachable for a caller that gated on `usesDefaultSeason`.
  if (!season && defaultSeason === null) {
    return { ok: false, error: "No season resolved for a projections read." };
  }

  const week = integer(params, "week", {
    min: 1,
    max: LAST_REGULAR_WEEK,
    fallback: null,
  });
  if (!week.ok) return week;

  const rawScoring = params.get("scoring")?.trim().toLowerCase();
  if (rawScoring && !(SCORINGS as readonly string[]).includes(rawScoring)) {
    return {
      ok: false,
      error: `Invalid scoring: ${rawScoring}. Expected one of ${SCORINGS.join(", ")}.`,
    };
  }

  const includeStats = booleanFlag(params, "stats");
  if (!includeStats.ok) return includeStats;

  const limit = integer(params, "limit", {
    min: 1,
    max: PROJECTIONS_LIMIT_MAX,
    fallback: PROJECTION_FILTER_DEFAULTS.limit,
  });
  if (!limit.ok) return limit;

  const offset = integer(params, "offset", {
    min: 0,
    fallback: PROJECTION_FILTER_DEFAULTS.offset,
  });
  if (!offset.ok) return offset;

  // Positions are matched against the players cache, so they are upper-cased to
  // match how Sleeper stores them ("WR", "DEF") rather than validated against a
  // fixed list — Sleeper's position vocabulary is wide (IDP, OL, K/P) and grows.
  // Deduped after the fold: `list` dedupes raw tokens, so `wr,WR` survives it.
  const positions = [
    ...new Set(list(params, "position").map((p) => p.toUpperCase())),
  ];
  const playerIds = list(params, "player_id");

  return {
    ok: true,
    filters: {
      // Non-null by the guard above: either the caller named one, or they
      // resolved one because `usesDefaultSeason` said it would be read.
      season: season || (defaultSeason as string),
      week: week.value,
      scoring: (rawScoring as ProjectionScoring) || PROJECTION_FILTER_DEFAULTS.scoring,
      positions: positions.length > 0 ? positions : null,
      player_ids: playerIds.length > 0 ? playerIds : null,
      include_stats: includeStats.value,
      limit: limit.value ?? PROJECTION_FILTER_DEFAULTS.limit,
      offset: offset.value ?? PROJECTION_FILTER_DEFAULTS.offset,
    },
  };
}
