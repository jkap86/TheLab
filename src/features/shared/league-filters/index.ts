/**
 * League list filtering — the barrel over the six modules the rules were split
 * into.
 *
 * Three of the filters are fixed segments over what a league *is* (status, type,
 * format); the other two are **lists of rules the reader builds** — a slot group,
 * a comparison and a number — over what its lineup starts and what its scoring
 * pays. The fixed pairs that used to sit there (superflex/one-QB, IDP/offense,
 * the reception bucket, TE premium) were four hard-coded questions out of a space
 * a reader arrives with their own question in: "two-QB leagues that also start a
 * linebacker", "half PPR with a TE bonus over half a point", "no kicker". Each is
 * a rule now, and the four old chips survive as quick-adds that write the
 * equivalent one — `qb+sf ≥ 2` *is* `isSuperflexLineup`, expressed in the
 * vocabulary the reader can edit.
 *
 * **Why six modules and not one file.** It was one, at 640 lines mixing the
 * types, the option tables, the matching rules, the summary strings, the menu
 * builders and the breakdown counts — which is six audiences for one import.
 * Split, a consumer takes what it needs: a component threading the state around
 * imports `./types` and gets an erased module, `trade-query` imports
 * `./predicates` and gets no option tables, and the dialog (which is
 * dynamically imported and off the first-paint bundle) is the only thing that
 * pulls in all of it.
 *
 * The barrel is here so the existing call sites don't move — importing a
 * module's barrel rather than its internals is the house rule, and the deep
 * imports above are the documented exception for pure modules that have to
 * resolve under Node's test runner.
 */
export {
  BEST_BALL_OPTIONS,
  COMMON_SCORING_KEYS,
  COMPARE_OPS,
  DEFAULT_LEAGUE_FILTERS,
  SLOT_GROUPS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  slotGroupLabel,
} from "./defaults.ts";
export { leagueBreakdown } from "./breakdown.ts";
export { scoringKeyLabel, scoringKeyOptions } from "./options.ts";
export {
  compare,
  deriveScoring,
  leagueAdpBoard,
  leagueType,
  matchesFilters,
  matchesScoringRule,
  matchesSlotRule,
  scoringValue,
  slotCount,
} from "./predicates.ts";
export {
  activeFilterCount,
  activeFilters,
  clearFilter,
  filterSummary,
  formatRuleValue,
} from "./summaries.ts";
export type {
  ActiveFilter,
  CompareOp,
  FilterRule,
  LeagueBreakdownRow,
  LeagueFilters,
  SlotGroup,
} from "./types.ts";
