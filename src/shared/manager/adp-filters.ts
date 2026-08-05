/**
 * Query-string parsing for `GET /api/adp`.
 *
 * Pure so it can be unit-tested, and so `adp.ts` only ever builds SQL from
 * values that have already been validated: the enums decide which fragments
 * exist at all, and everything else is bound as a parameter. The parsing
 * primitives come from `shared/query`, imported relatively with a `.ts`
 * extension so Node's test runner can resolve the chain.
 */

import {
  booleanFilter,
  enumList,
  integer,
  isoDate,
  isSeason,
  list,
} from "../query/parse.ts";

const DRAFT_TYPES = ["snake", "linear", "auction"] as const;
const DRAFT_STATUSES = ["complete", "drafting", "paused", "pre_draft"] as const;
const SCORING_FORMATS = ["std", "half_ppr", "ppr"] as const;

export type DraftType = (typeof DRAFT_TYPES)[number];
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
/** Derived from the league's `scoring_settings.rec`, not stored as such. */
export type ScoringFormat = (typeof SCORING_FORMATS)[number];

/**
 * The two league-type populations every ADP read is split into. A dynasty
 * startup drafts from rosters that persist and prices rookies a redraft never
 * sees, so the two are different markets and every fetch averages them apart —
 * there is no league-type *filter* any more, the answer simply carries both.
 *
 * Keeper leagues (Sleeper `settings.type` 1) count into the redraft board: a
 * keeper draft prices the same season-long game with a few players withheld,
 * where a dynasty draft is a different game entirely. Bucketing them into
 * neither board would leave their drafts visible in `draft_count` and absent
 * from both columns — the same "in the total, in none of the buckets" failure
 * the league filters' Complete status guards against.
 */
export const ADP_BOARDS = ["redraft", "dynasty"] as const;
export type AdpBoardType = (typeof ADP_BOARDS)[number];

/**
 * A validated ADP query. A `null` list means "don't filter on this at all",
 * which is different from an empty one — an empty list can't be produced here.
 */
export type AdpFilters = {
  /** Draft seasons to include; null when the caller asked for every season. */
  seasons: string[] | null;
  /**
   * Bounds on *when the draft happened*, as `YYYY-MM-DD` — a different cut from
   * `seasons`, which is the season a draft is *for*. A 2026 rookie draft in May
   * and a 2026 startup in August are one season and two very different markets,
   * which is what a date range separates. Either half may be null for an open
   * end; both null leaves the board unbounded in time.
   */
  start_after: string | null;
  start_before: string | null;
  draft_types: DraftType[];
  draft_statuses: DraftStatus[];
  league_ids: string[] | null;
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
 * Whether {@link parseAdpFilters} will read its `defaultSeason` argument.
 *
 * **Exported so the route can decide whether to resolve one at all**, and used
 * by the parser itself so the two cannot come to different views of it. The
 * season the app is operating in is a *fetched* value — `shared/season` asks
 * Sleeper — so a caller that has bounded the board has nothing to gain by
 * waiting on that, and a historical read stays deterministic. `/api/adp` gates
 * on this; the trades routes spell the equivalent inline because their default
 * is a plain "no season given".
 *
 * A date bound counts as bounding the board, which is the whole subtlety: the
 * predicate is not "is `season` absent".
 */
export function usesDefaultSeason(params: URLSearchParams): boolean {
  if (list(params, "season").length > 0) return false;
  // Trimmed, not merely present: `isoDate` reads a blank bound as no bound, and
  // a predicate that disagreed with it would leave `?start_after=` spanning
  // every season on file rather than taking the default.
  return !params.get("start_after")?.trim() && !params.get("start_before")?.trim();
}

/**
 * Validate an ADP query string. `defaultSeason` is passed in rather than
 * imported so this module stays dependency-free; the route supplies the season
 * the app is operating in. Pass `season=all` to span every season on file.
 *
 * The boolean filters are tri-state (`booleanFilter`): leaving `best_ball` off
 * must narrow nothing, which is different from `best_ball=false`.
 *
 * `defaultSeason` applies only when the caller bounded the board *neither* way —
 * no `season` and no date range. A caller asking for "drafts since June" means
 * exactly that, and quietly intersecting it with this season would hand back a
 * range that silently isn't the one requested. Bounding nothing at all is still
 * the expensive case, so that one keeps its default.
 *
 * It may therefore be `null`, meaning the caller checked {@link usesDefaultSeason}
 * and found none was wanted. Null on the path that *does* want one is a caller
 * bug rather than a bad request, and it is refused rather than left to fall
 * through: an unbounded board with no season spans every season on file, which
 * is the one wrong answer here that looks like a working one.
 */
export function parseAdpFilters(
  params: URLSearchParams,
  defaultSeason: string | null,
): ParsedAdpFilters {
  const seasonValues = list(params, "season");
  const allSeasons = seasonValues.some((s) => s.toLowerCase() === "all");
  const badSeason = seasonValues.find((s) => s.toLowerCase() !== "all" && !isSeason(s));
  if (badSeason) {
    return { ok: false, error: `Invalid season: ${badSeason}. Expected a 4-digit year or "all".` };
  }

  const startAfter = isoDate(params, "start_after");
  if (!startAfter.ok) return startAfter;
  const startBefore = isoDate(params, "start_before");
  if (!startBefore.ok) return startBefore;
  if (
    startAfter.value !== null &&
    startBefore.value !== null &&
    startAfter.value > startBefore.value
  ) {
    // String order is date order for `YYYY-MM-DD`. An inverted range matches
    // nothing, which reads as "no drafts crawled" rather than as the mistake.
    return {
      ok: false,
      error: `Invalid range: start_after (${startAfter.value}) is later than start_before (${startBefore.value}).`,
    };
  }

  const draftTypes = enumList(params, "draft_type", DRAFT_TYPES, [
    ...ADP_FILTER_DEFAULTS.draft_types,
  ]);
  if (!draftTypes.ok) return draftTypes;

  const draftStatuses = enumList(params, "draft_status", DRAFT_STATUSES, [
    ...ADP_FILTER_DEFAULTS.draft_statuses,
  ]);
  if (!draftStatuses.ok) return draftStatuses;

  const scoring = enumList(params, "scoring", SCORING_FORMATS, null);
  if (!scoring.ok) return scoring;

  const bestBall = booleanFilter(params, "best_ball");
  if (!bestBall.ok) return bestBall;

  const superflex = booleanFilter(params, "superflex");
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

  // Written as a branch on {@link usesDefaultSeason} rather than as a chain
  // ending in a default, so the predicate the route gates on and the path that
  // reads its answer are one decision. The order of the rest is load-bearing:
  // an explicit season beats a date bound, since `?season=2024&start_after=…`
  // means both, and only a request carrying neither takes the default.
  let seasons: string[] | null;
  if (usesDefaultSeason(params)) {
    if (defaultSeason === null) {
      return { ok: false, error: "No season resolved for an unbounded board." };
    }
    seasons = [defaultSeason];
  } else if (allSeasons) {
    seasons = null;
  } else if (seasonValues.length > 0) {
    seasons = seasonValues;
  } else {
    // A date bound and no season: the window spans whatever seasons it covers.
    seasons = null;
  }

  return {
    ok: true,
    filters: {
      seasons,
      start_after: startAfter.value,
      start_before: startBefore.value,
      draft_types: draftTypes.value ?? [],
      draft_statuses: draftStatuses.value ?? [],
      league_ids: leagueIds.length > 0 ? leagueIds : null,
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
