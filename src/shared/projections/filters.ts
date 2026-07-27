/**
 * Query-string parsing for `GET /api/projections`.
 *
 * Pure and free of runtime imports so it can be unit-tested, and so the SQL
 * beside it only ever sees checked values — `scoring` in particular decides which
 * column is interpolated into `ORDER BY`, which is only safe because it is
 * constrained to this enum here.
 *
 * The small `list`/`integer`/`enumList` helpers are deliberately duplicated from
 * `manager/adp-filters` rather than shared: importing that module at runtime would
 * couple the two concerns and, through its barrel, drag database code into a file
 * whose whole point is having no runtime dependencies.
 */

const SCORINGS = ["std", "half_ppr", "ppr"] as const;

/** Which of Sleeper's three scorings to rank and report by. */
export type ProjectionScoring = (typeof SCORINGS)[number];

/** Last week Sleeper publishes regular-season projections for. */
const MAX_WEEK = 18;

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

/** Values for one key, accepting repeated params and comma lists alike. */
function list(params: URLSearchParams, key: string): string[] {
  const values = params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function integer(
  params: URLSearchParams,
  key: string,
  { min, max, fallback }: { min: number; max?: number; fallback: number | null },
): { ok: true; value: number | null } | { ok: false; error: string } {
  const raw = params.get(key)?.trim();
  if (!raw) return { ok: true, value: fallback };

  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    const bound = max === undefined ? `>= ${min}` : `${min}-${max}`;
    return { ok: false, error: `Invalid ${key}: ${raw}. Expected an integer ${bound}.` };
  }
  return { ok: true, value };
}

function boolean(
  params: URLSearchParams,
  key: string,
): { ok: true; value: boolean } | { ok: false; error: string } {
  const raw = params.get(key)?.trim().toLowerCase();
  if (!raw) return { ok: true, value: false };
  if (["1", "true", "yes"].includes(raw)) return { ok: true, value: true };
  if (["0", "false", "no"].includes(raw)) return { ok: true, value: false };
  return { ok: false, error: `Invalid ${key}: ${raw}. Expected true or false.` };
}

/**
 * Validate a projections query string. `defaultSeason` is passed in rather than
 * imported so this module stays dependency-free; the route supplies
 * `DEFAULT_SEASON`.
 */
export function parseProjectionFilters(
  params: URLSearchParams,
  defaultSeason: string,
): ParsedProjectionFilters {
  const season = params.get("season")?.trim();
  if (season && !/^\d{4}$/.test(season)) {
    return { ok: false, error: `Invalid season: ${season}. Expected a 4-digit year.` };
  }

  const week = integer(params, "week", { min: 1, max: MAX_WEEK, fallback: null });
  if (!week.ok) return week;

  const rawScoring = params.get("scoring")?.trim().toLowerCase();
  if (rawScoring && !(SCORINGS as readonly string[]).includes(rawScoring)) {
    return {
      ok: false,
      error: `Invalid scoring: ${rawScoring}. Expected one of ${SCORINGS.join(", ")}.`,
    };
  }

  const includeStats = boolean(params, "stats");
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
  const positions = list(params, "position").map((p) => p.toUpperCase());
  const playerIds = list(params, "player_id");

  return {
    ok: true,
    filters: {
      season: season || defaultSeason,
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
