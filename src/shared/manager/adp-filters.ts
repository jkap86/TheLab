/**
 * Query-string parsing for `GET /api/adp`.
 *
 * Pure and free of runtime imports so it can be unit-tested, and so `adp.ts`
 * only ever builds SQL from values that have already been validated: the enums
 * decide which fragments exist at all, and everything else is bound as a
 * parameter.
 */

const DRAFT_TYPES = ["snake", "linear", "auction"] as const;
const DRAFT_STATUSES = ["complete", "drafting", "paused", "pre_draft"] as const;
const LEAGUE_TYPES = ["redraft", "keeper", "dynasty"] as const;
const SCORING_FORMATS = ["std", "half_ppr", "ppr"] as const;

export type DraftType = (typeof DRAFT_TYPES)[number];
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
/** Sleeper's `settings.type`, named: 0 redraft, 1 keeper, 2 dynasty. */
export type LeagueType = (typeof LEAGUE_TYPES)[number];
/** Derived from the league's `scoring_settings.rec`, not stored as such. */
export type ScoringFormat = (typeof SCORING_FORMATS)[number];

/** Sleeper's numeric `settings.type` for each named league type. */
export const LEAGUE_TYPE_CODES: Record<LeagueType, number> = {
  redraft: 0,
  keeper: 1,
  dynasty: 2,
};

/**
 * A validated ADP query. A `null` list means "don't filter on this at all",
 * which is different from an empty one — an empty list can't be produced here.
 */
export type AdpFilters = {
  /** Draft seasons to include; null when the caller asked for every season. */
  seasons: string[] | null;
  draft_types: DraftType[];
  draft_statuses: DraftStatus[];
  league_ids: string[] | null;
  league_types: LeagueType[] | null;
  scoring: ScoringFormat[] | null;
  best_ball: boolean | null;
  superflex: boolean | null;
  /** Bounds on the draft's `settings.rounds`. */
  rounds_min: number | null;
  rounds_max: number | null;
  /** Bounds on the league's team count. */
  teams_min: number | null;
  teams_max: number | null;
  /** Drop players taken in fewer than this many of the matched drafts. */
  min_picks: number;
  limit: number;
  offset: number;
};

export const ADP_LIMIT_MAX = 1000;

/**
 * Defaults for everything the caller didn't say. Three are opinions worth
 * stating, and the response echoes them back so they stay visible:
 *
 *   - Auction drafts are out: their `pick_no` is nomination order, not draft
 *     position, so averaging it with a snake draft's is meaningless.
 *   - Only completed drafts count, so a half-finished draft can't drag a
 *     player's average toward the early picks.
 *   - A player needs two picks to appear. One pick isn't an average, and a
 *     single pick at 1.0 would otherwise sort above the genuine consensus 1.01.
 *     Pass `min_picks=1` for the unfiltered tail.
 */
export const ADP_FILTER_DEFAULTS: {
  draft_types: DraftType[];
  draft_statuses: DraftStatus[];
  min_picks: number;
  limit: number;
  offset: number;
} = {
  draft_types: ["snake", "linear"],
  draft_statuses: ["complete"],
  min_picks: 2,
  limit: 200,
  offset: 0,
};

export type ParsedAdpFilters =
  | { ok: true; filters: AdpFilters }
  | { ok: false; error: string };

/**
 * Values for one key: repeated params and comma-separated lists are both
 * accepted (`?scoring=ppr&scoring=half_ppr` == `?scoring=ppr,half_ppr`), so
 * callers can use whichever their HTTP client makes easy.
 */
function list(params: URLSearchParams, key: string): string[] {
  const values = params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

/** A list filter constrained to a fixed vocabulary. Absent → `fallback`. */
function enumList<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T[] | null,
): { ok: true; value: T[] | null } | { ok: false; error: string } {
  const values = list(params, key);
  if (values.length === 0) return { ok: true, value: fallback };

  const invalid = values.filter((v) => !(allowed as readonly string[]).includes(v));
  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Invalid ${key}: ${invalid.join(", ")}. Expected one of ${allowed.join(", ")}.`,
    };
  }
  return { ok: true, value: values as T[] };
}

function boolean(
  params: URLSearchParams,
  key: string,
): { ok: true; value: boolean | null } | { ok: false; error: string } {
  const raw = params.get(key)?.trim().toLowerCase();
  if (!raw) return { ok: true, value: null };
  if (["1", "true", "yes"].includes(raw)) return { ok: true, value: true };
  if (["0", "false", "no"].includes(raw)) return { ok: true, value: false };
  return { ok: false, error: `Invalid ${key}: ${raw}. Expected true or false.` };
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

/**
 * Validate an ADP query string. `defaultSeason` is passed in rather than
 * imported so this module stays dependency-free; the route supplies
 * `DEFAULT_SEASON`. Pass `season=all` to span every season on file.
 */
export function parseAdpFilters(
  params: URLSearchParams,
  defaultSeason: string,
): ParsedAdpFilters {
  const seasonValues = list(params, "season");
  const allSeasons = seasonValues.some((s) => s.toLowerCase() === "all");
  const badSeason = seasonValues.find((s) => s.toLowerCase() !== "all" && !/^\d{4}$/.test(s));
  if (badSeason) {
    return { ok: false, error: `Invalid season: ${badSeason}. Expected a 4-digit year or "all".` };
  }

  const draftTypes = enumList(params, "draft_type", DRAFT_TYPES, [
    ...ADP_FILTER_DEFAULTS.draft_types,
  ]);
  if (!draftTypes.ok) return draftTypes;

  const draftStatuses = enumList(params, "draft_status", DRAFT_STATUSES, [
    ...ADP_FILTER_DEFAULTS.draft_statuses,
  ]);
  if (!draftStatuses.ok) return draftStatuses;

  const leagueTypes = enumList(params, "league_type", LEAGUE_TYPES, null);
  if (!leagueTypes.ok) return leagueTypes;

  const scoring = enumList(params, "scoring", SCORING_FORMATS, null);
  if (!scoring.ok) return scoring;

  const bestBall = boolean(params, "best_ball");
  if (!bestBall.ok) return bestBall;

  const superflex = boolean(params, "superflex");
  if (!superflex.ok) return superflex;

  const roundsMin = integer(params, "rounds_min", { min: 1, fallback: null });
  if (!roundsMin.ok) return roundsMin;
  const roundsMax = integer(params, "rounds_max", { min: 1, fallback: null });
  if (!roundsMax.ok) return roundsMax;

  const teamsMin = integer(params, "teams_min", { min: 1, fallback: null });
  if (!teamsMin.ok) return teamsMin;
  const teamsMax = integer(params, "teams_max", { min: 1, fallback: null });
  if (!teamsMax.ok) return teamsMax;

  const minPicks = integer(params, "min_picks", {
    min: 1,
    fallback: ADP_FILTER_DEFAULTS.min_picks,
  });
  if (!minPicks.ok) return minPicks;

  const limit = integer(params, "limit", {
    min: 1,
    max: ADP_LIMIT_MAX,
    fallback: ADP_FILTER_DEFAULTS.limit,
  });
  if (!limit.ok) return limit;

  const offset = integer(params, "offset", { min: 0, fallback: ADP_FILTER_DEFAULTS.offset });
  if (!offset.ok) return offset;

  const leagueIds = list(params, "league_id");

  return {
    ok: true,
    filters: {
      seasons: allSeasons
        ? null
        : seasonValues.length > 0
          ? seasonValues
          : [defaultSeason],
      draft_types: draftTypes.value ?? [],
      draft_statuses: draftStatuses.value ?? [],
      league_ids: leagueIds.length > 0 ? leagueIds : null,
      league_types: leagueTypes.value,
      scoring: scoring.value,
      best_ball: bestBall.value,
      superflex: superflex.value,
      rounds_min: roundsMin.value,
      rounds_max: roundsMax.value,
      teams_min: teamsMin.value,
      teams_max: teamsMax.value,
      min_picks: minPicks.value ?? ADP_FILTER_DEFAULTS.min_picks,
      limit: limit.value ?? ADP_FILTER_DEFAULTS.limit,
      offset: offset.value ?? ADP_FILTER_DEFAULTS.offset,
    },
  };
}
