import { QB_ELIGIBLE_STARTING_SLOTS } from "../../shared/ktc/roster.ts";
import {
  IDP_SLOTS,
  NON_STARTING_SLOTS,
  SLOT_POSITIONS,
} from "../../shared/projections/slots.ts";
import type { ManagerLeague } from "@/shared/manager";

/**
 * League list filtering. Kept apart from the control that renders it so the
 * matching rules — which encode Sleeper's settings quirks — can be read and
 * tested on their own.
 *
 * Three of the filters are fixed segments over what a league *is* (status, type,
 * format); the other two are **lists of rules the reader builds** — a slot group,
 * a comparison and a number — over what its lineup starts and what its scoring
 * pays. The fixed pairs that used to sit there (superflex/one-QB, IDP/offense,
 * the reception bucket, TE premium) were four hard-coded questions out of a space
 * a reader arrives with their own question in: "two-QB leagues that also start a
 * linebacker", "half PPR with a TE bonus over half a point", "no kicker". Each is
 * a rule here, and the four old chips survive as quick-adds that write the
 * equivalent rule — `qb+sf ≥ 2` *is* `isSuperflexLineup`, expressed in the
 * vocabulary the reader can now edit.
 *
 * The slot groups are derived from the solver's own tables rather than listed, on
 * the terms `DEFENSIVE_SLOTS` is: `QB+SF` is the KTC board's own QB-eligible slot
 * walk and `IDP` is `IDP_SLOTS`, so a new flex counts here the moment the solver
 * learns it. Those come in relatively with an explicit `.ts` extension for the
 * reason the tests do — Node's test runner strips types but doesn't know the
 * `@/*` aliases — and neither drags `pg` into the bundle. The `ManagerLeague`
 * import is type-only, so it is erased and the alias costs nothing.
 */

/** How a rule compares a league's number against the one the reader typed. */
export type CompareOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

/**
 * One rule: a key, a comparison and a number.
 *
 * The same shape serves both lists — what differs is only which number the key
 * names (a count of slots, a scoring rate), which is why the two families are
 * two arrays of one type rather than two types.
 */
export type FilterRule = {
  /** A {@link SLOT_GROUPS} key, or a Sleeper `scoring_settings` key. */
  key: string;
  op: CompareOp;
  value: number;
};

export type LeagueFilters = {
  /** Sleeper `settings.type`: "all" or a stringified 0=redraft, 1=keeper, 2=dynasty. */
  type: "all" | "0" | "1" | "2";
  /** Sleeper `settings.best_ball`: "all", or filter by best-ball on/off. */
  bestBall: "all" | "yes" | "no";
  /** Where the league is in its season — see {@link LIVE_STATUSES}. */
  status: "all" | "pre_draft" | "drafting" | "in_season" | "done";
  /** Rules over how many of a slot group `roster_positions` holds. */
  slots: readonly FilterRule[];
  /** Rules over what `scoring_settings` pays for a stat. */
  scoring: readonly FilterRule[];
};

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  type: "all",
  bestBall: "all",
  status: "all",
  slots: [],
  scoring: [],
};

/**
 * The options each fixed filter offers, in the order they're shown.
 *
 * They live here rather than in the control that renders them because the
 * vocabulary is now read in two places — the modal's buttons and
 * {@link filterSummary}, which names the active selection outside it. A modal
 * hides its own state, so the words on the header have to come from the same
 * table as the words in the dialog or the two drift into disagreeing about what
 * `bestBall: "no"` is called.
 */
export const TYPE_OPTIONS: { value: LeagueFilters["type"]; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
];

export const BEST_BALL_OPTIONS: {
  value: LeagueFilters["bestBall"];
  label: string;
}[] = [
  { value: "all", label: "All formats" },
  { value: "yes", label: "Best ball" },
  { value: "no", label: "Lineup" },
];

export const STATUS_OPTIONS: {
  value: LeagueFilters["status"];
  label: string;
}[] = [
  { value: "all", label: "Any status" },
  { value: "pre_draft", label: "Pre-draft" },
  { value: "drafting", label: "Drafting" },
  { value: "in_season", label: "In season" },
  { value: "done", label: "Complete" },
];

/**
 * The comparisons a rule can make, in the order the row's menu lists them.
 *
 * `symbol` is what the row and the summary show — a rule reads as `qb+sf ≥ 2`
 * rather than as a sentence, because a list of six of them is scanned and not
 * read. `label` is the accessible name behind it, since "≥" has no useful
 * pronunciation.
 */
export const COMPARE_OPS: {
  value: CompareOp;
  symbol: string;
  label: string;
}[] = [
  { value: "eq", symbol: "=", label: "equals" },
  { value: "ne", symbol: "≠", label: "is not" },
  { value: "gte", symbol: "≥", label: "at least" },
  { value: "lte", symbol: "≤", label: "at most" },
  { value: "gt", symbol: ">", label: "more than" },
  { value: "lt", symbol: "<", label: "fewer than" },
];

/**
 * Scoring rates are fractions Sleeper stores as floats — 0.1 a rushing yard,
 * 0.04 a passing yard — so an exact `===` is one binary representation away from
 * reporting that a half-PPR league doesn't pay 0.5. Every comparison is made with
 * a tolerance far below any rate a league actually uses.
 */
const EPSILON = 1e-9;

/** Whether a league's number satisfies a rule's comparison. */
export function compare(
  actual: number,
  op: CompareOp,
  target: number,
): boolean {
  switch (op) {
    case "eq":
      return Math.abs(actual - target) < EPSILON;
    case "ne":
      return Math.abs(actual - target) >= EPSILON;
    case "gte":
      return actual >= target - EPSILON;
    case "lte":
      return actual <= target + EPSILON;
    case "gt":
      return actual > target + EPSILON;
    case "lt":
      return actual < target - EPSILON;
  }
}

/**
 * A group of lineup slots a rule can count, with the predicate that decides
 * membership.
 *
 * A predicate rather than a list because the useful groups aren't all
 * enumerations: `Starters` is "not a bench slot", which has to keep counting a
 * slot spelling this build has never seen, and the rest are derived from the
 * solver's tables so they can't drift from what the lineup solve does.
 */
export type SlotGroup = {
  /** Stable — a stored rule names it. */
  key: string;
  label: string;
  /** What the group covers, shown under the menu entry. */
  hint: string;
  matches: (slot: string) => boolean;
};

/**
 * The flexes only offensive skill players fill, derived rather than listed:
 * multi-position, no quarterback, no individual defenders. Leagues spell the same
 * idea `FLEX`, `WRRB_FLEX` or `REC_FLEX`, so counting them as one group is what
 * makes "leagues that start three flexes" a question you can ask at all.
 */
const OFFENSIVE_FLEX_SLOTS = new Set(
  Object.entries(SLOT_POSITIONS)
    .filter(
      ([slot, positions]) =>
        positions.length > 1 &&
        !positions.includes("QB") &&
        !IDP_SLOTS.has(slot),
    )
    .map(([slot]) => slot),
);

const exactGroup = (key: string, label: string, hint: string): SlotGroup => ({
  key,
  label,
  hint,
  matches: (slot) => slot === key,
});

/**
 * What a slot rule can count, in the order the menu lists it: the two questions
 * that decide what game a league is playing first, then the positions, then the
 * slots that start nobody.
 */
export const SLOT_GROUPS: SlotGroup[] = [
  {
    key: "QB+SF",
    label: "QB+SF",
    hint: "QB-eligible starting slots — 2 or more is superflex",
    matches: (slot) => QB_ELIGIBLE_STARTING_SLOTS.includes(slot),
  },
  {
    key: "IDP",
    label: "IDP",
    hint: "individual defender slots, DEF not counting",
    matches: (slot) => IDP_SLOTS.has(slot),
  },
  exactGroup("QB", "QB", "bare QB slots"),
  exactGroup("RB", "RB", "bare RB slots"),
  exactGroup("WR", "WR", "bare WR slots"),
  exactGroup("TE", "TE", "bare TE slots"),
  {
    key: "FLEX",
    label: "FLEX",
    hint: "any offensive flex (FLEX, WRRB_FLEX, REC_FLEX)",
    matches: (slot) => OFFENSIVE_FLEX_SLOTS.has(slot),
  },
  exactGroup("SUPER_FLEX", "SUPER_FLEX", "the superflex slot itself"),
  exactGroup("DEF", "DEF", "team defence"),
  exactGroup("K", "K", "kicker"),
  exactGroup("DL", "DL", "defensive line"),
  exactGroup("LB", "LB", "linebacker"),
  exactGroup("DB", "DB", "defensive back"),
  {
    key: "STARTERS",
    label: "Starters",
    hint: "every slot that starts somebody",
    matches: (slot) => !NON_STARTING_SLOTS.has(slot),
  },
  exactGroup("BN", "BN", "bench"),
  exactGroup("IR", "IR", "injured reserve"),
  exactGroup("TAXI", "TAXI", "taxi squad"),
];

const SLOT_GROUP_BY_KEY = new Map(SLOT_GROUPS.map((group) => [group.key, group]));

/** A slot group's label, or the raw key for one this build doesn't know. */
export function slotGroupLabel(key: string): string {
  return SLOT_GROUP_BY_KEY.get(key)?.label ?? key;
}

/**
 * How many of a group's slots a league starts, or null when it can't be known.
 *
 * Null and zero are different answers, and keeping them apart is what stops
 * `k = 0` — "leagues without a kicker" — from sweeping in every league whose
 * lineup simply hasn't been synced. A rule against an unknown lineup fails
 * rather than passing on an assumed zero.
 */
export function slotCount(
  league: ManagerLeague,
  key: string,
): number | null {
  const group = SLOT_GROUP_BY_KEY.get(key);
  const slots = league.roster_positions;
  if (!group || !slots) return null;
  return slots.filter((slot) => group.matches(slot)).length;
}

/**
 * What a league pays for a stat, or null when its scoring isn't stored.
 *
 * A key *absent from a stored blob* is 0, not unknown: Sleeper omits what a
 * league doesn't pay for, which is exactly why `bonus_rec_te > 0` is how TE
 * premium is asked. A missing blob is unknown, and fails the rule for the reason
 * an unsynced lineup does.
 */
export function scoringValue(
  league: ManagerLeague,
  key: string,
): number | null {
  const scoring = league.scoring_settings;
  if (!scoring) return null;
  const value = scoring[key];
  return typeof value === "number" ? value : 0;
}

/** Whether a league's lineup satisfies one slot rule. */
export function matchesSlotRule(
  league: ManagerLeague,
  rule: FilterRule,
): boolean {
  const count = slotCount(league, rule.key);
  return count !== null && compare(count, rule.op, rule.value);
}

/** Whether a league's scoring satisfies one scoring rule. */
export function matchesScoringRule(
  league: ManagerLeague,
  rule: FilterRule,
): boolean {
  const value = scoringValue(league, rule.key);
  return value !== null && compare(value, rule.op, rule.value);
}

/**
 * The scoring keys worth offering first, in the order a reader reaches for them.
 *
 * Only a ranking — the menu itself is built from the keys the leagues in hand
 * actually carry ({@link scoringKeyOptions}), so a key here that no league scores
 * is never offered and a house rule this list has never heard of still is.
 */
export const COMMON_SCORING_KEYS: readonly string[] = [
  "rec",
  "bonus_rec_te",
  "pass_td",
  "pass_yd",
  "pass_int",
  "rush_td",
  "rush_yd",
  "rec_td",
  "rec_yd",
  "fum_lost",
  "bonus_rec_rb",
  "bonus_rec_wr",
  "te_rec_td",
  "sack",
  "def_td",
];

/**
 * The scoring keys a rule can name, taken off the leagues in hand.
 *
 * Read off the data for the reason the trades page's menus are: what a league
 * pays for is a house rule, and a fixed list would offer keys nobody scores while
 * hiding the one someone actually wants to filter on. The fallback matters on a
 * cold load — with no leagues streamed yet the dialog still has to offer
 * something, so it falls back to the ranking above.
 */
export function scoringKeyOptions(
  leagues: readonly ManagerLeague[],
): string[] {
  const present = new Set<string>();
  for (const league of leagues) {
    for (const key of Object.keys(league.scoring_settings ?? {})) present.add(key);
  }
  const keys = present.size ? [...present] : [...COMMON_SCORING_KEYS];
  const rank = (key: string) => {
    const i = COMMON_SCORING_KEYS.indexOf(key);
    return i === -1 ? COMMON_SCORING_KEYS.length : i;
  };
  return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * A scoring key as a person reads it. Sleeper's keys are already the vocabulary
 * a league's own settings page uses, so they're shown as they are with the
 * underscores opened out — inventing display names for ~60 keys would be a table
 * to maintain and a second thing to look a key up under.
 */
export function scoringKeyLabel(key: string): string {
  return key.replace(/_/g, " ");
}

/**
 * A rule's number as typed rather than as floated: `0.5`, not `0.5000000001`,
 * and `1` rather than `1.0`. Three decimals is past the finest rate a league
 * uses (a passing yard at 0.04).
 */
export function formatRuleValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** A rule in words: `qb+sf ≥ 2`, `bonus rec te > 0`. */
function ruleText(rule: FilterRule, label: (key: string) => string): string {
  const symbol = COMPARE_OPS.find((o) => o.value === rule.op)?.symbol ?? "=";
  return `${label(rule.key)} ${symbol} ${formatRuleValue(rule.value)}`;
}

/**
 * The fixed filters as `(key, options)`, in the order the dialog lays them out.
 *
 * The two readouts below walk this rather than naming each field, so a filter
 * added above is counted and summarised without a second and third edit — which
 * is how the count on the trigger and the words on the header came to be worth
 * one table in the first place.
 */
const FILTERS: {
  [K in "type" | "bestBall" | "status"]: {
    key: K;
    options: { value: LeagueFilters[K]; label: string }[];
  };
}["type" | "bestBall" | "status"][] = [
  { key: "status", options: STATUS_OPTIONS },
  { key: "type", options: TYPE_OPTIONS },
  { key: "bestBall", options: BEST_BALL_OPTIONS },
];

/**
 * How many filters are narrowing the list — the count on the modal's trigger.
 *
 * A rule counts as one, so eight slot rules read as eight: they are eight
 * independent narrowings, and rolling the whole list up as "1" would understate
 * a selection that is doing most of the work.
 */
export function activeFilterCount(filters: LeagueFilters): number {
  return (
    FILTERS.filter(({ key }) => filters[key] !== "all").length +
    filters.slots.length +
    filters.scoring.length
  );
}

/**
 * The active selection in words, e.g. `"dynasty · qb+sf ≥ 2"` or `"all leagues"`.
 *
 * With the controls behind a modal, this is the only thing on the page saying
 * what the header's record and win pct are counted over — so it names the
 * *scope* of those numbers rather than decorating the trigger button.
 *
 * Lower case because it is read mid-sentence ("counting dynasty · qb+sf ≥ 2"),
 * where the buttons' own capitalised labels read as proper nouns. Same tables
 * either way, so a renamed option or slot group can't say two different things.
 */
export function filterSummary(filters: LeagueFilters): string {
  const fixed = FILTERS.flatMap(({ key, options }) => {
    const value = filters[key];
    if (value === "all") return [];
    const label = options.find((o) => o.value === value)?.label;
    return label ? [label.toLowerCase()] : [];
  });
  const slots = filters.slots.map((rule) =>
    ruleText(rule, slotGroupLabel).toLowerCase(),
  );
  const scoring = filters.scoring.map((rule) =>
    ruleText(rule, scoringKeyLabel).toLowerCase(),
  );
  const parts = [...fixed, ...slots, ...scoring];
  return parts.length ? parts.join(" · ") : "all leagues";
}

/** Read a numeric field out of a league's Sleeper `settings` blob. */
function settingNumber(league: ManagerLeague, key: string): number | undefined {
  const value = league.settings?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * A league's Sleeper type as a number: 0 redraft, 1 keeper, 2 dynasty.
 *
 * Sleeper omits `type` for standard redraft leagues, so a missing value is 0 —
 * the same assumption `/api/adp` makes in SQL, and the reason this is a function
 * rather than a field read at each call site: the share cards count dynasty and
 * redraft leagues off it too, and a second copy of the fallback is a second
 * chance to forget it.
 */
export function leagueType(league: ManagerLeague): number {
  return settingNumber(league, "type") ?? 0;
}

/**
 * The statuses a league is still *running* under, in the order it passes through
 * them. The Complete option is their complement rather than a match on
 * `"complete"`: an end-of-season spelling this list doesn't know would otherwise
 * be reachable under "Any status" alone — visible in the total, in none of the
 * buckets, which reads as a filter losing leagues.
 */
const LIVE_STATUSES = new Set(["pre_draft", "drafting", "in_season"]);

/**
 * The scoring bucket a league falls in, from its `rec` points. Mirrors the
 * `SCORING_SQL` `/api/adp` groups by exactly — absent/unparseable and anything
 * under half a point is standard — so a filter seeded from a league matches the
 * league it came from rather than landing a bucket off.
 *
 * It lives here rather than in `manager/adp-controls`, where it started, because
 * both ends of the app bucket a league this way. `features/shared` can't import a
 * feature, so the definition moved down and `adp-controls` re-exports it — the
 * same trade the date primitives made, and for the same reason. The league
 * filters themselves no longer bucket at all: a `rec` rule says what it means
 * without rounding three rates into three names.
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

/** Whether a league passes the active filters. */
export function matchesFilters(
  league: ManagerLeague,
  filters: LeagueFilters,
): boolean {
  if (filters.type !== "all") {
    if (leagueType(league) !== Number(filters.type)) return false;
  }
  if (filters.bestBall !== "all") {
    const isBestBall = settingNumber(league, "best_ball") === 1;
    if (filters.bestBall === "yes" ? !isBestBall : isBestBall) return false;
  }
  if (filters.status !== "all") {
    const matches =
      filters.status === "done"
        ? !LIVE_STATUSES.has(league.status)
        : league.status === filters.status;
    if (!matches) return false;
  }
  // Every rule narrows — the lists are an AND, like the fixed filters above them.
  // An OR would need a rule to say which group it joins, and "dynasty leagues
  // that start two QBs" is the question people actually arrive with.
  for (const rule of filters.slots) {
    if (!matchesSlotRule(league, rule)) return false;
  }
  for (const rule of filters.scoring) {
    if (!matchesScoringRule(league, rule)) return false;
  }
  return true;
}
