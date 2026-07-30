import type { ManagerLeague } from "./types";

/**
 * The ADP board controls on the Players tab: which crawled drafts the column's
 * average is taken over.
 *
 * Kept apart from the bar that renders it, and pure, for the same reason
 * `filters` is — the query it builds and the league-seeding it does encode
 * `/api/adp`'s own vocabulary (the scoring buckets, the league-type codes, the
 * auction exclusion), and that is worth reading and testing without a fetch
 * behind it. Every field is a single-select the bar drives; a `null`/`"all"`
 * value means "don't narrow on this", which the query builder turns into an
 * omitted parameter — the same tri-state the route parses.
 *
 * These are a different concern from the header's {@link LeagueFilters}: those
 * narrow *which of this manager's leagues* a share is counted over; these narrow
 * *which drafts in the database* the ADP is averaged from. One is about the
 * manager, the other about the market — so they don't share state.
 */
export type AdpControls = {
  /** A 4-digit season, or `"all"` for every season on file. */
  season: string;
  /**
   * `"snakelinear"` is the default the route applies when `draft_type` is
   * omitted — auction is left out because its `pick_no` is nomination order, not
   * a draft slot. The three explicit values narrow to one type.
   */
  draftType: "snakelinear" | "snake" | "linear" | "auction";
  /** Sleeper `settings.type`: `"all"`, or 0 redraft / 1 keeper / 2 dynasty. */
  leagueType: "all" | "0" | "1" | "2";
  /** Derived from the league's `scoring_settings.rec`, not stored as such. */
  scoring: "all" | "std" | "half_ppr" | "ppr";
  superflex: "all" | "yes" | "no";
  bestBall: "all" | "yes" | "no";
  /** `"all"`, or an exact team count (`teams_min` = `teams_max`). */
  teams: "all" | string;
  /**
   * The draft's round count, bucketed. A rookie draft's pick 1 and a startup's
   * pick 1 are different games — the doc's own example — so the board can split
   * the short rookie drafts from the full ones rather than average across them.
   */
  rounds: "all" | "rookie" | "full";
};

/** The `rounds_min`/`rounds_max` bounds each rounds bucket sends. */
const ROUNDS_BOUNDS: Record<"rookie" | "full", { min?: number; max?: number }> = {
  // Rookie drafts are a handful of rounds; startups and redrafts fill a roster.
  // The gap between is left to "all" rather than claimed by either side.
  rookie: { max: 5 },
  full: { min: 12 },
};

/** The `league_type` name `/api/adp` expects for each Sleeper `settings.type`. */
const LEAGUE_TYPE_NAME: Record<"0" | "1" | "2", string> = {
  "0": "redraft",
  "1": "keeper",
  "2": "dynasty",
};

/**
 * The starting board: this season, every meaningful draft (snake + linear), no
 * league narrowing. `season` is the manager's viewed season so the timeframe
 * matches the leagues on screen.
 */
export function defaultAdpControls(season: string): AdpControls {
  return {
    season,
    draftType: "snakelinear",
    leagueType: "all",
    scoring: "all",
    superflex: "all",
    bestBall: "all",
    teams: "all",
    rounds: "all",
  };
}

/**
 * The seasons the timeframe control offers: the viewed season and the two before
 * it, plus `"all"`. A season with no crawled drafts simply comes back empty —
 * the caption says how many drafts matched, so an empty timeframe reads as "0
 * drafts" rather than a broken control.
 */
export function seasonOptions(season: string): string[] {
  const year = Number(season);
  if (!Number.isInteger(year)) return [season, "all"];
  return [String(year), String(year - 1), String(year - 2), "all"];
}

/**
 * The scoring bucket a league falls in, from its `rec` points. Mirrors the
 * `SCORING_SQL` the endpoint groups by exactly — absent/unparseable and
 * anything under half a point is standard — so a filter seeded from a league
 * matches the league it came from rather than landing a bucket off.
 */
export function deriveScoring(
  scoring: Record<string, number> | null,
): "std" | "half_ppr" | "ppr" {
  const rec = scoring?.rec;
  if (typeof rec !== "number") return "std";
  if (rec >= 1) return "ppr";
  if (rec >= 0.5) return "half_ppr";
  return "std";
}

/**
 * Fill the league-setting controls from one of the manager's leagues — the
 * "associated league setting" shortcut. It sets only what a league payload
 * carries: type, scoring, best ball and size. `season`, `draftType` and
 * `superflex` are left as they were: the first two aren't league settings, and
 * superflex lives in `roster_positions`, which the client league doesn't carry,
 * so it stays a deliberate manual choice.
 */
export function seedFromLeague(
  controls: AdpControls,
  league: ManagerLeague,
): AdpControls {
  const settings = league.settings ?? {};
  // Sleeper omits `type` for standard redraft leagues; a non-number is redraft.
  const typeRaw = settings.type;
  const typeNum = typeof typeRaw === "number" ? typeRaw : 0;
  const leagueType: AdpControls["leagueType"] =
    typeNum === 1 ? "1" : typeNum === 2 ? "2" : "0";

  return {
    ...controls,
    leagueType,
    scoring: deriveScoring(league.scoring_settings),
    bestBall: settings.best_ball === 1 ? "yes" : "no",
    teams: String(league.total_rosters),
  };
}

/**
 * The `/api/adp` query string for a board. An `"all"` control is left out so the
 * route's tri-state parser reads it as "don't narrow"; `draftType` and `season`
 * are always sent because they always mean something. `limit` is the board's max
 * so a deep-roster player still gets a number — the tail past 1,000 is beyond
 * any real draft.
 */
export function adpQueryString(controls: AdpControls): string {
  const params = new URLSearchParams();
  params.set("limit", "1000");
  params.set("season", controls.season);

  params.set(
    "draft_type",
    controls.draftType === "snakelinear" ? "snake,linear" : controls.draftType,
  );

  if (controls.leagueType !== "all") {
    params.set("league_type", LEAGUE_TYPE_NAME[controls.leagueType]);
  }
  if (controls.scoring !== "all") params.set("scoring", controls.scoring);
  if (controls.superflex !== "all") {
    params.set("superflex", controls.superflex === "yes" ? "1" : "0");
  }
  if (controls.bestBall !== "all") {
    params.set("best_ball", controls.bestBall === "yes" ? "1" : "0");
  }
  if (controls.teams !== "all") {
    params.set("teams_min", controls.teams);
    params.set("teams_max", controls.teams);
  }
  if (controls.rounds !== "all") {
    const { min, max } = ROUNDS_BOUNDS[controls.rounds];
    if (min !== undefined) params.set("rounds_min", String(min));
    if (max !== undefined) params.set("rounds_max", String(max));
  }

  return params.toString();
}
