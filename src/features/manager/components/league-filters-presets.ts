import { type FilterRule, NO_TRADE_DEADLINE, TEAMS_KEY } from "@/features/shared";

/**
 * The questions worth one press, as the rules they always were.
 *
 * A preset writes an ordinary rule the reader can then edit into the question
 * they actually have — `rec = 0.5` becomes `rec ≥ 0.4`, `QB+SF ≥ 2` becomes
 * `QB+SF = 3`. That is the whole argument for a rule builder over a row of fixed
 * chips: the chips are still here, and they are no longer the only questions
 * askable.
 *
 * They live with the dialog rather than in `features/shared/league-filters`
 * because they are a UI affordance and not part of the vocabulary — the
 * predicates would evaluate them identically if they were typed by hand.
 */
export type RulePreset = { label: string; rule: FilterRule };

/** The old superflex and IDP chips. */
export const SLOT_PRESETS: readonly RulePreset[] = [
  { label: "Superflex", rule: { key: "QB+SF", op: "gte", value: 2 } },
  { label: "One QB", rule: { key: "QB+SF", op: "eq", value: 1 } },
  { label: "IDP", rule: { key: "IDP", op: "gt", value: 0 } },
  { label: "No IDP", rule: { key: "IDP", op: "eq", value: 0 } },
  { label: "No kicker", rule: { key: "K", op: "eq", value: 0 } },
];

/**
 * The reception buckets and TE premium.
 *
 * `Standard` is `rec < 0.5` rather than `rec = 0`, because a league paying a
 * quarter point is standard-ish and not PPR — the same three-way split
 * everything else that buckets receptions uses.
 */
export const SCORING_PRESETS: readonly RulePreset[] = [
  { label: "PPR", rule: { key: "rec", op: "gte", value: 1 } },
  { label: "Half PPR", rule: { key: "rec", op: "eq", value: 0.5 } },
  { label: "Standard", rule: { key: "rec", op: "lt", value: 0.5 } },
  { label: "TE premium", rule: { key: "bonus_rec_te", op: "gt", value: 0 } },
];

/**
 * The settings worth one press: the sizes nearly every league is, the two bounds
 * that split them, and the configuration questions a reader arrives with.
 *
 * **No deadline is the sentinel rule, written out.** It stores
 * `trade_deadline = 99`, which the row draws as `is · No deadline` and the
 * predicate matches by identity. It is here rather than left to be typed
 * because 99 is the one value in this bay a reader has no way to guess.
 *
 * The list stops where the readings stop. There is no waiver preset, because
 * `waiver_type`'s 0/1/2 is an ordering nobody has verified and a quick-add is
 * the worst place to guess one: a chip states its rule as a fact.
 */
export const SETTING_PRESETS: readonly RulePreset[] = [
  { label: "10-team", rule: { key: TEAMS_KEY, op: "eq", value: 10 } },
  { label: "12-team", rule: { key: TEAMS_KEY, op: "eq", value: 12 } },
  { label: "14-team", rule: { key: TEAMS_KEY, op: "eq", value: 14 } },
  { label: "≤ 10", rule: { key: TEAMS_KEY, op: "lte", value: 10 } },
  { label: "≥ 12", rule: { key: TEAMS_KEY, op: "gte", value: 12 } },
  { label: "Trades on", rule: { key: "disable_trades", op: "eq", value: 0 } },
  { label: "Trades off", rule: { key: "disable_trades", op: "eq", value: 1 } },
  {
    label: "No deadline",
    rule: { key: "trade_deadline", op: "eq", value: NO_TRADE_DEADLINE },
  },
  { label: "Taxi squad", rule: { key: "taxi_slots", op: "gt", value: 0 } },
];
