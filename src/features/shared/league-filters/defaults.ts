import { QB_ELIGIBLE_STARTING_SLOTS } from "../../../shared/ktc/roster.ts";
import {
  IDP_SLOTS,
  NON_STARTING_SLOTS,
  SLOT_POSITIONS,
} from "../../../shared/projections/slots.ts";

import type {
  CompareOp,
  LeagueFilters,
  SettingKey,
  SettingValue,
  SlotGroup,
} from "./types.ts";

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

/** The neutral value every fixed filter opens on and resets to. */
export const ALL = "all";

export const DEFAULT_LEAGUE_FILTERS: LeagueFilters = {
  season: ALL,
  type: ALL,
  bestBall: ALL,
  status: ALL,
  slots: [],
  scoring: [],
  settings: [],
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
 * The one settings key that is not in Sleeper's `settings` blob: how many
 * rosters the league holds, which is `total_rosters` on the league row.
 *
 * Named rather than spelled at the three places that read it (the reader, the
 * seed, the preview pool), and exported because `adp-controls` writes a rule on
 * it when it seeds a board from a league.
 */
export const TEAMS_KEY = "teams";

/**
 * What Sleeper stores for a league that never stops trading.
 *
 * A sentinel and not a week — see {@link SettingKey.sentinel} for why that
 * distinction has to be carried rather than left as a number.
 */
export const NO_TRADE_DEADLINE = 99;

/**
 * The two settings keys the bay must not offer, because the dialog already asks
 * about them four inches higher.
 *
 * `settings.type` is the Type rail and `settings.best_ball` is the Format rail.
 * A rule on either would be a second control over one axis, and the two
 * disagreeing reads as a bug rather than a selection: `type = 2` as a rule with
 * Redraft lit on the rail is an empty list with nothing on screen saying which
 * of them emptied it. The same argument `omit` makes for a whole row, at the
 * grain of one key.
 */
export const NON_SETTING_KEYS: ReadonlySet<string> = new Set([
  "type",
  "best_ball",
]);

/**
 * The settings keys the menu ranks and names, and what their numbers mean.
 *
 * **A ranking and a vocabulary, not a whitelist.** `settingKeyOptions` builds
 * the menu from the keys the leagues in hand actually carry, so a key absent
 * from this table is still offered — spelled with its underscores opened out and
 * read as a plain quantity. What the table adds is an order worth scanning, a
 * name worth reading, and the two things a number alone cannot say: what an
 * *absent* key means, and which of its numbers are names rather than
 * quantities.
 *
 * **Where a `values` table is a reading and where it would be a guess.**
 * `disable_trades` and `pick_trading` are flags whose own names say which way
 * they read — a `disable_*` at 1 is disabled — so naming them costs nothing and
 * buys a row a reader can check. `waiver_type`'s 0/1/2 is an *ordering*, which
 * the key's name does not carry, so it stays a quantity until somebody has read
 * the stored blobs. A quantity is never wrong here, only terse; a wrong name is
 * a filter that lies.
 *
 * `type` and `best_ball` are deliberately absent, and `settingKeyOptions` drops
 * them from the menu too: they are the Type and Format rails at the top of the
 * same dialog, and a second way to ask one question is the failure this codebase
 * keeps closing — a reader could set `type = 2` as a rule and Redraft as a rail
 * and get an empty list with nothing on screen saying which control emptied it.
 */
export const SETTING_KEYS: readonly SettingKey[] = [
  {
    key: TEAMS_KEY,
    label: "Teams",
    hint: "rosters in the league",
    // A live league always reports `total_rosters`, so a 0 is a row stored
    // before the league answered rather than a real size — see `settingValue`.
    absent: "unknown",
  },
  {
    key: "disable_trades",
    label: "Trades",
    hint: "whether the league allows trading at all",
    absent: "zero",
    values: [
      { value: 0, label: "Enabled" },
      { value: 1, label: "Disabled" },
    ],
  },
  {
    key: "trade_deadline",
    label: "Trade deadline",
    hint: "the last week trades are allowed",
    absent: "unknown",
    sentinel: { value: NO_TRADE_DEADLINE, label: "No deadline" },
  },
  {
    key: "pick_trading",
    label: "Pick trading",
    hint: "whether draft picks can be traded",
    absent: "zero",
    values: [
      { value: 0, label: "Off" },
      { value: 1, label: "On" },
    ],
  },
  {
    key: "trade_review_days",
    label: "Trade review",
    hint: "days a trade sits before it processes",
    absent: "zero",
  },
  {
    key: "waiver_type",
    label: "Waiver type",
    hint: "Sleeper's waiver code — 0, 1 or 2, unverified here",
    absent: "zero",
  },
  {
    key: "waiver_budget",
    label: "FAAB budget",
    hint: "free-agent budget per manager",
    absent: "zero",
  },
  {
    key: "playoff_teams",
    label: "Playoff teams",
    hint: "how many teams make the postseason",
    absent: "zero",
  },
  {
    key: "playoff_week_start",
    label: "Playoffs start",
    hint: "the first week of the postseason",
    absent: "unknown",
  },
  {
    key: "taxi_slots",
    label: "Taxi slots",
    hint: "taxi-squad places",
    absent: "zero",
  },
  {
    key: "reserve_slots",
    label: "IR slots",
    hint: "injured-reserve places",
    absent: "zero",
  },
  {
    key: "max_keepers",
    label: "Keepers",
    hint: "players held over from last season",
    absent: "zero",
  },
  {
    key: "draft_rounds",
    label: "Draft rounds",
    hint: "rounds in the league's draft",
    absent: "zero",
  },
];

export const SETTING_KEY_BY_KEY = new Map(
  SETTING_KEYS.map((setting) => [setting.key, setting]),
);

/** A settings key's label, or the raw key with its underscores opened out. */
export function settingKeyLabel(key: string): string {
  return SETTING_KEY_BY_KEY.get(key)?.label ?? key.replace(/_/g, " ");
}

/**
 * The named values a rule's value menu offers for a key, or null where that
 * key's numbers are quantities and the row wants a number field.
 *
 * **A sentinel is deliberately not in here**, which is the whole of what
 * separates the third value kind from the second. A label key is *only* names —
 * every number `disable_trades` can hold has one, so a menu loses nothing. A
 * sentinel key is a real scale with one value beside it: `trade_deadline ≤ 12`
 * has to stay typeable, and a menu that swallowed the weeks would only offer the
 * eighteen someone thought of. So the row keeps its number field and reaches the
 * sentinel with a key of its own — see {@link settingSentinel}.
 */
export function settingValueOptions(
  key: string,
): readonly SettingValue[] | null {
  const values = SETTING_KEY_BY_KEY.get(key)?.values;
  return values && values.length ? values : null;
}

/**
 * The one value on a key's scale that is not on the scale, or null for a key
 * with none.
 *
 * The row draws it as a key beside the number field rather than as a menu entry:
 * lit, it *is* the value and the number field stands down; unlit, it is the way
 * in. Both halves are needed because {@link settingValue} reads the sentinel as
 * an absence, so a reader who cannot press it by name cannot ask about it at all.
 */
export function settingSentinel(key: string): SettingValue | null {
  return SETTING_KEY_BY_KEY.get(key)?.sentinel ?? null;
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
