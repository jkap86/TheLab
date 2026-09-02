/**
 * League list filtering — the barrel over the six modules the rules are split
 * into.
 *
 * Two of the filters are fixed segments over what a league *is* (type, format);
 * the other three are **lists of rules the reader builds** — a key, a comparison
 * and a number — over how a league is configured, what its lineup starts and
 * what its scoring pays. The four questions worth one press (superflex, IDP, the
 * reception bucket, TE premium) survive as quick-adds that write the equivalent
 * rule: `QB+SF ≥ 2` *is* `isSuperflexLineup`, expressed in the vocabulary the
 * reader can then edit.
 *
 * **Why six modules and not one file.** The split is by *what a thing is*, not
 * by what reads it, which is what keeps each readable on its own — and it means
 * a consumer takes only what it needs: a component threading the state around
 * imports `./types` and gets an erased module, while only the dialog pulls in
 * all of it.
 *
 * The barrel is here because importing a module's barrel rather than its
 * internals is the house rule; the deep `.ts` imports inside are the documented
 * exception for pure modules that have to resolve under Node's test runner.
 *
 * **Ported from TheLabX minus its season and status dimensions** — see
 * `./types` for why neither belongs here.
 */
export {
  ALL,
  BEST_BALL_OPTIONS,
  COMMON_SCORING_KEYS,
  COMPARE_OPS,
  DEFAULT_LEAGUE_FILTERS,
  FIXED_FILTERS,
  NON_SETTING_KEYS,
  NO_TRADE_DEADLINE,
  SETTING_KEYS,
  SETTING_KEY_BY_KEY,
  SLOT_GROUPS,
  TEAMS_KEY,
  TYPE_OPTIONS,
  settingKeyLabel,
  settingSentinel,
  settingValueOptions,
  slotGroupLabel,
} from "./defaults.ts";
export { leagueBreakdown } from "./breakdown.ts";
export {
  rankKeys,
  scoringKeyLabel,
  scoringKeyOptions,
  settingKeyOptions,
} from "./options.ts";
export {
  compare,
  isBestBall,
  isSentinelRule,
  leagueType,
  matchesFilters,
  matchesScoringRule,
  matchesSettingRule,
  matchesSlotRule,
  scoringValue,
  settingIsSentinel,
  settingValue,
  slotCount,
} from "./predicates.ts";
export {
  activeFilterCount,
  activeFilters,
  clearFilter,
  filterSummary,
  formatRuleValue,
} from "./summaries.ts";
export type { LeagueSettingsBlob } from "./predicates.ts";
export type {
  ActiveFilter,
  CompareOp,
  FilterRule,
  LeagueBreakdownRow,
  LeagueFilters,
  SettingKey,
  SettingValue,
  SlotGroup,
} from "./types.ts";
