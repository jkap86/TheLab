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
  "font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40";

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
 * The three sizes nearly every league is, and the two bounds that split them.
 *
 * The exact counts are what the ADP board's retired size chip offered, so the
 * one-press path is unchanged for a reader who wants "12-team drafts". The two
 * bounds are what the chip could not express at all and what a *rule* is for —
 * "10 or fewer" is the shallow-league question, and the two of them together
 * name the band this list otherwise leaves out.
 */
export const SIZE_PRESETS: RulePreset[] = [
  { label: "10-team", rule: { key: "teams", op: "eq", value: 10 } },
  { label: "12-team", rule: { key: "teams", op: "eq", value: 12 } },
  { label: "14-team", rule: { key: "teams", op: "eq", value: 14 } },
  { label: "≤ 10", rule: { key: "teams", op: "lte", value: 10 } },
  { label: "≥ 12", rule: { key: "teams", op: "gte", value: 12 } },
];
