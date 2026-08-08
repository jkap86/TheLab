import {
  COMPARE_OPS,
  FIXED_FILTERS,
  SETTING_KEY_BY_KEY,
  settingKeyLabel,
  slotGroupLabel,
} from "./defaults.ts";
import { scoringKeyLabel } from "./options.ts";
import { isSentinelRule } from "./predicates.ts";
import type { ActiveFilter, FilterRule, LeagueFilters } from "./types.ts";

/**
 * What the page says about a selection, outside the dialog that holds it.
 *
 * A modal hides its own state, so the count on the trigger, the words beside the
 * header's record and the chips in the readout rail are all there is to say what
 * a reader has narrowed to. All three are derived from one walk
 * ({@link activeFilters}) rather than from three, which is the difference
 * between a filter added later being counted and named and it being counted and
 * not named.
 */

/**
 * A rule's number as typed rather than as floated: `0.5`, not `0.5000000001`,
 * and `1` rather than `1.0`. Three decimals is past the finest rate a league
 * uses (a passing yard at 0.04).
 */
export function formatRuleValue(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(3)));
}

/** A rule in words: `qb+sf ≥ 2`, `bonus rec te > 0`. */
function ruleText(rule: FilterRule, label: (key: string) => string): string {
  const symbol = COMPARE_OPS.find((o) => o.value === rule.op)?.symbol ?? "=";
  return `${label(rule.key)} ${symbol} ${formatRuleValue(rule.value)}`;
}

/**
 * A settings rule in words, which is the one family where the *number* may have
 * a name: `trade deadline is no deadline`, `trades is disabled`, `teams ≥ 12`.
 *
 * The chip in the readout rail is the only place outside the dialog that says
 * what a settings rule narrowed to, so it has to be the sentence the row shows
 * rather than the pair of digits underneath it — "trade deadline = 99" is a
 * filter a reader cannot check, and it is the same rule the row renders as a
 * menu. Both read the one table, so neither can name it differently.
 */
function settingRuleText(rule: FilterRule): string {
  const spec = SETTING_KEY_BY_KEY.get(rule.key);
  const named =
    (isSentinelRule(rule) ? spec?.sentinel : undefined) ??
    spec?.values?.find((option) => option.value === rule.value);
  if (named && (rule.op === "eq" || rule.op === "ne")) {
    const verb = rule.op === "eq" ? "is" : "is not";
    return `${settingKeyLabel(rule.key)} ${verb} ${named.label}`;
  }
  return ruleText(rule, settingKeyLabel);
}

/**
 * Every filter narrowing the list, fixed ones first, in the dialog's order.
 *
 * `label` is already lower case, because the summary reads mid-sentence
 * ("counting dynasty · qb+sf ≥ 2") and a chip beside it saying "Dynasty" would
 * be the same selection under two spellings. A rule reads as its symbol form for
 * the reason the rows do: a list of six is scanned, not read.
 */
export function activeFilters(filters: LeagueFilters): ActiveFilter[] {
  // The season is a fixed filter that is not in `FIXED_FILTERS`, because its
  // options are whatever the leagues in hand carry rather than a table this
  // build can enumerate — and it needs no table anyway, since a season's label
  // *is* its value. It leads for the reason the band leads the panel: it is the
  // population the rest of the list narrows within.
  const season: ActiveFilter[] =
    filters.season === "all"
      ? []
      : [{ kind: "fixed", field: "season", label: filters.season }];
  const fixed = FIXED_FILTERS.flatMap(({ key, options }): ActiveFilter[] => {
    const value = filters[key];
    if (value === "all") return [];
    const label = options.find((o) => o.value === value)?.label;
    return label
      ? [{ kind: "fixed", field: key, label: label.toLowerCase() }]
      : [];
  });
  const slots = filters.slots.map(
    (rule, index): ActiveFilter => ({
      kind: "slot",
      index,
      label: ruleText(rule, slotGroupLabel).toLowerCase(),
    }),
  );
  const scoring = filters.scoring.map(
    (rule, index): ActiveFilter => ({
      kind: "scoring",
      index,
      label: ruleText(rule, scoringKeyLabel).toLowerCase(),
    }),
  );
  const settings = filters.settings.map(
    (rule, index): ActiveFilter => ({
      kind: "setting",
      index,
      label: settingRuleText(rule).toLowerCase(),
    }),
  );
  return [...season, ...fixed, ...settings, ...slots, ...scoring];
}

/**
 * The selection with one filter lifted out — what a readout chip's `×` applies.
 *
 * A fixed filter goes back to `"all"` rather than being deleted, since it is a
 * field with a neutral value and not a member of a list. The switch is spelled
 * out per field rather than written as a computed key so the compiler keeps
 * checking that `"all"` is a value each of the three unions actually holds.
 */
export function clearFilter(
  filters: LeagueFilters,
  active: ActiveFilter,
): LeagueFilters {
  if (active.kind === "slot") {
    return {
      ...filters,
      slots: filters.slots.filter((_, i) => i !== active.index),
    };
  }
  if (active.kind === "scoring") {
    return {
      ...filters,
      scoring: filters.scoring.filter((_, i) => i !== active.index),
    };
  }
  if (active.kind === "setting") {
    return {
      ...filters,
      settings: filters.settings.filter((_, i) => i !== active.index),
    };
  }
  switch (active.field) {
    case "season":
      return { ...filters, season: "all" };
    case "type":
      return { ...filters, type: "all" };
    case "bestBall":
      return { ...filters, bestBall: "all" };
    case "status":
      return { ...filters, status: "all" };
  }
}

/**
 * How many filters are narrowing the list — the count on the modal's trigger.
 *
 * A rule counts as one, so eight slot rules read as eight: they are eight
 * independent narrowings, and rolling the whole list up as "1" would understate
 * a selection that is doing most of the work.
 *
 * Counted without building the labels, which the walk above spends most of its
 * work on. It is read on every render of two pages' headers — and on the trades
 * page it decides whether a request is narrowed at all — where the strings it
 * would allocate are never looked at.
 */
export function activeFilterCount(filters: LeagueFilters): number {
  let count =
    filters.slots.length + filters.scoring.length + filters.settings.length;
  if (filters.season !== "all") count += 1;
  for (const { key } of FIXED_FILTERS) if (filters[key] !== "all") count += 1;
  return count;
}

/**
 * The active selection in words, e.g. `"dynasty · qb+sf ≥ 2"` or `"all leagues"`.
 *
 * With the controls behind a modal, this is the only thing on the page saying
 * what the header's record and win pct are counted over — so it names the
 * *scope* of those numbers rather than decorating the trigger button.
 */
export function filterSummary(filters: LeagueFilters): string {
  const parts = activeFilters(filters).map((f) => f.label);
  return parts.length ? parts.join(" · ") : "all leagues";
}
