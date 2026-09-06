// The `player_seasons` loader. Server-only — `./load`, `./players`,
// `./sleeper-source` and `./draft-fetch` reach Postgres, Sleeper and GitHub.
// The modules that carry the rules (`./plan`, `./refresh`, `./season-line`,
// `./facts`, `./rows`, `./draft-source`) are pure and import relatively with
// `.ts`, so they resolve under Node's own test runner.

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
export { corpusRefresh } from "./refresh";
export type {
  CorpusRefreshDecision,
  CorpusRefreshInputs,
  CorpusRefreshProbe,
} from "./refresh";
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
export { ageAt, experienceAt, playerFactsAt } from "./facts";
export type { ExperienceBasis, FactsResolution, PlayerRecord } from "./facts";
export { buildSeasonRows, mergeSkips } from "./rows";
export type { BuiltSeason, DraftCounts, PlayerSeasonWrite, SkipCounts } from "./rows";
export { DRAFT_SOURCE_NAME, DRAFT_SOURCE_URL, parseCsv, parseDraftCapital } from "./draft-source";
export { fetchDraftCapital } from "./draft-fetch";
export type {
  DraftCapitalSource,
  KnownDraftCapital,
  ParsedDraftCapital,
} from "./draft-source";
export { readPlayerRecords } from "./players";
export { SLEEPER_SOURCE_NAME, sleeperSeasonStats } from "./sleeper-source";
export type { SeasonStatSource } from "./sleeper-source";
