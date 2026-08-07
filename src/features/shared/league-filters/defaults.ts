import { QB_ELIGIBLE_STARTING_SLOTS } from "../../../shared/ktc/roster.ts";
import {
  IDP_SLOTS,
  NON_STARTING_SLOTS,
  SLOT_POSITIONS,
} from "../../../shared/projections/slots.ts";

import type { CompareOp, LeagueFilters, SlotGroup } from "./types.ts";

/**
 * The tables a reader picks from: the neutral selection, the fixed filters'
 * options, the comparisons, and what a slot rule can count.
 *
 * They live apart from the predicates that read them because the two are read by
 * different callers — a control renders these, a filter pass runs those — and
 * because the slot groups are the one thing here with a runtime dependency
 * (`SLOT_POSITIONS`, `IDP_SLOTS`, `QB_ELIGIBLE_STARTING_SLOTS`), which is worth
 * keeping in the module that actually needs it rather than in the one everything
 * imports.
 *
 * The two slot-vocabulary imports come in relatively with an explicit `.ts`
 * extension for the reason the tests do — Node's runner strips types but doesn't
 * resolve the `@/*` aliases — and neither drags `pg` into the bundle.
 */

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  type: "all",
  bestBall: "all",
  status: "all",
  slots: [],
  scoring: [],
  size: [],
};

/**
 * The options each fixed filter offers, in the order they're shown.
 *
 * They live here rather than in the control that renders them because the
 * vocabulary is read in two places — the modal's buttons and `filterSummary`,
 * which names the active selection outside it. A modal hides its own state, so
 * the words on the header have to come from the same table as the words in the
 * dialog or the two drift into disagreeing about what `bestBall: "no"` is
 * called.
 */
export const TYPE_OPTIONS: { value: LeagueFilters["type"]; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "0", label: "Redraft" },
  { value: "1", label: "Keeper" },
  { value: "2", label: "Dynasty" },
  { value: "3", label: "Chopped" },
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
 * The fixed filters as `(key, options)`, in the order the dialog lays them out.
 *
 * `activeFilters` walks this rather than naming each field, so a filter added
 * above is counted and summarised without a second and third edit.
 */
export const FIXED_FILTERS: {
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
 *
 * Derived from the solver's own tables rather than listed, on the terms
 * `DEFENSIVE_SLOTS` is: `QB+SF` is the KTC board's own QB-eligible slot walk and
 * `IDP` is `IDP_SLOTS`, so a new flex counts here the moment the solver learns
 * it.
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

export const SLOT_GROUP_BY_KEY = new Map(
  SLOT_GROUPS.map((group) => [group.key, group]),
);

/** A slot group's label, or the raw key for one this build doesn't know. */
export function slotGroupLabel(key: string): string {
  return SLOT_GROUP_BY_KEY.get(key)?.label ?? key;
}

/**
 * What a size rule can count. One key today — how many rosters the league holds
 * — and a table rather than that one string spelled at the four places that
 * need it (the menu, the label, the reader, the tests).
 *
 * It is a *rule* family rather than a segment of fixed sizes, which is what the
 * ADP board's own `All sizes / 10 / 12 / …` chip was: a chip can only ask for an
 * exact count, where "at least ten teams" is the question a reader arrives with
 * as often. The reader itself is in `./predicates` beside the other two, since
 * that is where every read of a league lives.
 */
export const SIZE_KEYS: { key: string; label: string; hint: string }[] = [
  { key: "teams", label: "Teams", hint: "rosters in the league" },
];

export const SIZE_KEY_BY_KEY = new Map(SIZE_KEYS.map((size) => [size.key, size]));

/** A size key's label, or the raw key for one this build doesn't know. */
export function sizeKeyLabel(key: string): string {
  return SIZE_KEY_BY_KEY.get(key)?.label ?? key;
}

/**
 * The statuses a league is still *running* under, in the order it passes through
 * them. The Complete option is their complement rather than a match on
 * `"complete"`: an end-of-season spelling this list doesn't know would otherwise
 * be reachable under "Any status" alone — visible in the total, in none of the
 * buckets, which reads as a filter losing leagues.
 */
export const LIVE_STATUSES = new Set(["pre_draft", "drafting", "in_season"]);

/**
 * The scoring keys worth offering first, in the order a reader reaches for them.
 *
 * Only a ranking — the menu itself is built from the keys the leagues in hand
 * actually carry (`scoringKeyOptions`), so a key here that no league scores is
 * never offered and a house rule this list has never heard of still is.
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
