import { NO_TRADE_DEADLINE, TEAMS_KEY } from "../../league-filters";

import type { RulePreset } from "./league-filters-modal.types.ts";

/**
 * The tables and the one shared class string the dialog's sections read.
 *
 * They sit apart from the sections that render them for the reason the filter
 * package's own `defaults` do: `CAPTION` is read by three of them, and two
 * copies of it is how the panel's labels drift into three sizes as sections are
 * added — which is the drift it was written once to stop.
 */

/**
 * The uppercase caption over every group, slot and readout in the panel.
 *
 * One string rather than the same six utilities retyped nine times: these are
 * the only labels in the dialog and they are the thing that would drift into
 * three sizes as sections were added.
 */
export const CAPTION =
  "font-mono text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-foreground/40";

/** The old superflex and IDP chips, as the rules they always were. */
export const SLOT_PRESETS: RulePreset[] = [
  { label: "Superflex", rule: { key: "QB+SF", op: "gte", value: 2 } },
  { label: "One QB", rule: { key: "QB+SF", op: "eq", value: 1 } },
  { label: "IDP", rule: { key: "IDP", op: "gt", value: 0 } },
  { label: "No IDP", rule: { key: "IDP", op: "eq", value: 0 } },
  { label: "No kicker", rule: { key: "K", op: "eq", value: 0 } },
];

/** The reception buckets and TE premium, likewise. */
export const SCORING_PRESETS: RulePreset[] = [
  { label: "PPR", rule: { key: "rec", op: "gte", value: 1 } },
  { label: "Half PPR", rule: { key: "rec", op: "eq", value: 0.5 } },
  { label: "Standard", rule: { key: "rec", op: "lt", value: 0.5 } },
  { label: "TE premium", rule: { key: "bonus_rec_te", op: "gt", value: 0 } },
];

/**
 * The settings worth one press: the sizes nearly every league is, the two bounds
 * that split them, and the four configuration questions a reader arrives with.
 *
 * The exact counts are what the ADP board's retired size chip offered, so the
 * one-press path is unchanged for a reader who wants "12-team drafts". The two
 * bounds are what the chip could not express at all and what a *rule* is for —
 * "10 or fewer" is the shallow-league question, and the two of them together
 * name the band this list otherwise leaves out.
 *
 * **No trade deadline is the sentinel rule, written out.** It stores
 * `trade_deadline = 99`, which the row draws as `is · No deadline` and the
 * predicate matches by identity — see {@link SettingKey.sentinel}. It is here
 * rather than left to be typed because 99 is the one value in this bay a reader
 * has no way to guess.
 *
 * The list stops where the readings stop. There is no waiver preset, because
 * `waiver_type`'s 0/1/2 is an ordering nobody has verified and a quick-add is
 * the worst place to guess one: a chip states its rule as a fact.
 */
export const SETTING_PRESETS: RulePreset[] = [
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
