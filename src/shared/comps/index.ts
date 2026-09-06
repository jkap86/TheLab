// The comps arithmetic and vocabulary. **Pure throughout** — nothing here
// reaches Postgres or the network, which is what lets a `"use client"` module
// import this barrel where every other `shared/` barrel with a database behind
// it is server-only. The corpus reads live in `shared/player-seasons`, which is
// the half that drags `pg` in; the route composes the two.

export {
  CRITERIA,
  CRITERION_IDS,
  DEFAULT_K,
  DEFAULT_PAIR_WEIGHT,
  K_MAX,
  K_MIN,
  UDFA_PICK,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_STEP,
  WINDOWS,
  WINDOW_FIELDS,
  WINDOW_IDS,
  criterionById,
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
  CompWindow,
  WeightedWindow,
} from "./criteria";
export { windowTag, windowValue } from "./windows";
export type { CompRow } from "./windows";
export {
  SIMILARITY_DECAY,
  closenessBars,
  isEligible,
  rankComps,
  similarityPercent,
  zStats,
} from "./knn";
export type { PoolBounds, PoolSeason, RankedComp } from "./knn";
export { compsQueryParams, parseCompsQuery } from "./params";
export type { CompsRequest, ParsedCompsQuery } from "./params";
