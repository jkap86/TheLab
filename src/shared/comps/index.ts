// The comps arithmetic and vocabulary. **Pure throughout** — nothing here
// reaches Postgres or the network, which is what lets a `"use client"` module
// import this barrel where every other `shared/` barrel with a database behind
// it is server-only. The corpus reads live in `shared/player-seasons`, which is
// the half that drags `pg` in; the route composes the two.

export {
  COMP_POSITIONS,
  CRITERIA,
  CRITERION_IDS,
  DEFAULT_K,
  DEFAULT_PAIR_WEIGHT,
  K_MAX,
  K_MIN,
  POSITION_CRITERIA,
  POSITION_PRESETS,
  UDFA_PICK,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  WINDOWS,
  WINDOW_FIELDS,
  WINDOW_IDS,
  criterionAppliesTo,
  criterionById,
  defaultCriteriaFor,
  isCompPosition,
  isCriterionId,
  isStatField,
  isWindowId,
  isWindowed,
  pairKey,
  windowById,
} from "./criteria";
export type {
  CompCriterion,
  CompFactField,
  CompField,
  CompPosition,
  CompWindow,
  WeightedWindow,
} from "./criteria";
export {
  COVERAGE_EPSILON,
  MIN_WEIGHTED_COVERAGE,
  meetsMinimumCoverage,
  weightedCoverage,
} from "./coverage";
export { observationTag, windowTag, windowValue, windowReading } from "./windows";
export type { CompRow, WindowReading } from "./windows";
export {
  SIMILARITY_ANCHOR_PERCENT,
  SIMILARITY_ANCHOR_QUANTILE,
  SIMILARITY_DECAY_MAX,
  SIMILARITY_DECAY_MIN,
  SIMILARITY_FALLBACK_DECAY,
  SIMILARITY_MIN_SAMPLE,
  calibrateSimilarity,
  quantile,
  similarityPercent,
} from "./similarity";
export type { SimilarityScale } from "./similarity";
export { closenessBars, isEligible, rankComps, zStats } from "./knn";
export type { CompRanking, PoolBounds, PoolSeason, RankedComp } from "./knn";
export { compsQueryParams, parseCompsQuery } from "./params";
export type { CompsRequest, ParsedCompsQuery } from "./params";
