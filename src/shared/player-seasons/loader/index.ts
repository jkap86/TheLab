// The `player_seasons` loader. Server-only — `./load`, `./players` and
// `./sleeper-source` reach Postgres and Sleeper. The three modules that carry
// the rules (`./plan`, `./season-line`, `./facts`, `./rows`) are pure and
// import relatively with `.ts`, so they resolve under Node's own test runner.

export { DEFAULT_MIN_GAMES, LOADER_VERSION, loadCompsCorpus } from "./load";
export type { CompsLoadOptions, CompsLoadReport } from "./load";
export {
  EARLIEST_SEASON,
  LAST_REGULAR_WEEK,
  latestCompleteSeason,
  planLoad,
  playersMapSeason,
} from "./plan";
export type { CompsLoadPlan, CompsLoadRequest, NflSeasonState } from "./plan";
export {
  DEFAULT_SCORING,
  SCORING_KEYS,
  foldSeasonStats,
  isCompsScoring,
  pointsPerGame,
  statNumber,
} from "./season-line";
export type {
  CompsScoring,
  SeasonAggregate,
  SleeperStatRow,
  WeekStats,
} from "./season-line";
export { ageAt, draftPick, experienceAt, playerFactsAt } from "./facts";
export type { ExperienceBasis, FactsResolution, PlayerRecord } from "./facts";
export { buildSeasonRows, mergeSkips } from "./rows";
export type { BuiltSeason, PlayerSeasonWrite, SkipCounts } from "./rows";
export { readPlayerRecords } from "./players";
export { SLEEPER_SOURCE_NAME, sleeperSeasonStats } from "./sleeper-source";
export type { SeasonStatSource } from "./sleeper-source";
