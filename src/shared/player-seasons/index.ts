// The comps corpus: historical player-seasons, stored in `player_seasons` and
// read back as the shape `shared/comps` ranks over. **Server-only** — the read
// reaches Postgres. The arithmetic it feeds is in `shared/comps`, which is pure
// and is what a client module imports.

export { COMPS_SAMPLE_CORPUS_ENV, sampleCorpusAccess } from "./availability";
export type { SampleCorpusAccess } from "./availability";
export { buildCorpus, corpusBounds, toCompMatch, toCompSubject } from "./corpus";
export type {
  BuildCorpusOptions,
  CompCorpus,
  CorpusSeason,
  CorpusSubject,
  StoredSeason,
} from "./corpus";
export {
  COMPS_ANSWER_MAX,
  COMPS_ANSWER_TTL_MS,
  compsAnswerCache,
  compsAnswerKey,
} from "./answer-cache";
export { CORPUS_NAME, probeCorpus } from "./queries";
export type { CorpusProbe } from "./queries";
export {
  COMPS_CORPUS_CHECK_MS,
  COMPS_CORPUS_LOAD_VAR,
  startCompsCorpusScheduler,
} from "./scheduler";
export {
  CORPUS_META_TTL_MS,
  CORPUS_TTL_MS,
  getCompCorpus,
  refreshCompCorpus,
} from "./read";
export type { CorpusRead } from "./read";
export { SAMPLE_CORPUS } from "./sample";
export {
  DEFAULT_MIN_GAMES,
  DEFAULT_SCORING,
  EARLIEST_SEASON,
  LOADER_VERSION,
  SCORING_KEYS,
  SLEEPER_SOURCE_NAME,
  ageAt,
  buildSeasonRows,
  corpusRefresh,
  draftPick,
  experienceAt,
  foldSeasonStats,
  isCompsScoring,
  latestCompleteSeason,
  loadCompsCorpus,
  planLoad,
  playerFactsAt,
  playersMapSeason,
  pointsPerGame,
  readPlayerRecords,
  sleeperSeasonStats,
} from "./loader";
export type {
  BuiltSeason,
  CompsLoadOptions,
  CompsLoadPlan,
  CompsLoadReport,
  CompsLoadRequest,
  CompsScoring,
  CorpusRefreshDecision,
  CorpusRefreshInputs,
  CorpusRefreshProbe,
  NflSeasonState,
  PlayerRecord,
  PlayerSeasonWrite,
  SeasonAggregate,
  SeasonStatSource,
  SkipCounts,
  SleeperStatRow,
  WeekStats,
} from "./loader";
