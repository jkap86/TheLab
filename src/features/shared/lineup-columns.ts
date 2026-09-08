"use client";

import { useMemo } from "react";

import type {
  KtcBoardChoice,
  KtcFormat,
  KtcLineupChoice,
  LineupColumn,
  LineupMetricId,
  LineupPosition,
  LineupSlot,
} from "@/shared/contract";
// Relative with an explicit extension, the way `shares-columns.ts` beside it
// reaches the same store: the rules below are read by Node's own test runner,
// which resolves neither the `@/*` aliases nor an extensionless specifier. The
// key spelling is `shared/ktc/columns` because the *server* writes the same
// keys — see the note above — and it is pure for exactly this reason.
import {
  isKtcMetric,
  lineupColumnKey,
  normalizeLineupPositions,
  normalizeLineupSlots,
  readsQbBoard,
} from "../../shared/ktc/columns.ts";
import { FANTASY_POSITIONS } from "../../shared/projections/positions.ts";
import {
  STARTING_SLOTS,
  startingSlotsOf,
} from "../../shared/projections/starting-slots.ts";

import { useLocalValue, writeLocal } from "./local-store.ts";

// Which rank columns the league cards show, remembered on the device. The
// storage mechanics live in `local-store.ts`; what is here is only what this
// key holds and the rules that keep it honest.
//
// **A column is a metric and four axes now, not a metric id** — which market
// and which QB board it is priced on, and which seats and which positions it
// counts. That is
// what lets one metric occupy two bays: a reader comparing their roster's
// dynasty superflex worth against its 1QB worth is asking two questions, and
// until the axes moved into the column there was one global board and no way to
// ask both. A metric that does not read an axis has it folded back to `auto` by
// `column()` and out of its key by `lineupColumnKey`, so it can never duplicate
// itself on one — which is the three projection metrics on both axes, and the
// three capital ones on the market alone. Capital reads the *QB board*, because
// the ADP fold aggregates superflex drafts apart from standard ones: pricing a
// roster's draft capital on the superflex board while sitting in a 1QB league is
// the same comparison the KeepTradeCut bays make one market over.
//
// **The last two axes narrow what is counted rather than how it is priced**,
// and both are in the key for the same reason the first two are: two bays
// narrowed differently are two readings of one roster, and without it they
// would dedupe into one with the rank shown under one narrowing being the
// other's. An empty set is the absence of a narrowing rather than an extra
// value, which is what keeps every un-narrowed column keyed exactly as it
// always was — and therefore what keeps the ten base ranks the route always
// ships readable.
//
// **The two narrowings are a seat and a player, and they compose.** A slot set
// picks which starting seats are counted and a position set picks who, in them,
// is counted — so `FLEX` with `WR` is the wide receivers occupying flex seats,
// which is a question neither axis can ask alone. Only a `starters` column can
// carry a slot set, because a seat is a thing only a starting lineup has.
//
// The selection is still a *set*, not an arrangement: columns render in
// canonical order, so `normalize` sorts on write and read alike and a
// hand-edited or stale stored value cannot invent an ordering the UI never
// offered. What this file used to add — that bays are numbered by that order,
// so an edit renumbers them, "the cheaper of the two readings the design
// considered" — was the cheaper reading right up until somebody used it: a
// press that moves a column's place in the sort teleports the tile being
// edited across the rack and shifts the other three under it, which is a
// picker rearranging itself under the reader's finger. The store's order is
// unchanged; the *rack* holds its sockets for a sitting, and
// {@link arrangeLineupColumns} is the one place the two are reconciled.
//
// It lives in `features/shared` because the metric-id list is the client half
// of the contract's compiler seam (see `LineupMetricId`) and the
// wrapper-over-`local-store` pattern is this folder's to own — `account.ts` is
// the template. The key spelling itself is `shared/ktc/columns`, deep-imported
// the way `@/shared/ktc/roster` already is, because the server writes the same
// keys and a second spelling is a rank attributed to the wrong board.
const STORAGE_KEY = "thelab:lineup-columns";

/**
 * The most columns a card can carry before the grid stops reading.
 *
 * **Unmoved by the two KTC axes arriving**, deliberately: the cap is about how
 * much a card's tile row can hold at 390px — four 75px tiles is the row, and
 * the fifth is what pushes the strip past the fold — not about how many
 * readings exist to choose between. It is also the picker's own shape now: four
 * bays, always four, so the budget is the UI rather than a rule the UI has to
 * state.
 *
 * **It means *exactly* four now, not at most four.** The picker has no empty
 * socket and no `Clear`: every bay is always set, so the store can never answer
 * fewer — see {@link normalizeLineupColumns}, which tops a short selection back
 * up rather than handing the panel a bay it has no way to fill.
 */
export const MAX_LINEUP_COLUMNS = 4;

// Exhaustive by construction — the client half of the contract's compiler
// seam: a new `LineupMetricId` breaks this Record until it is placed.
const METRIC_ORDER: Record<LineupMetricId, number> = {
  // Each family leads with its own total, which is the one ordering all three
  // can share — and inserting `ros_total` at the head moves nothing for an
  // existing reader, since the sort is by these numbers and nobody's stored
  // selection holds a metric that did not exist.
  ros_total: 0,
  ros_starters: 1,
  ros_bench: 2,
  capital_total: 3,
  capital_bench: 4,
  capital_starters: 5,
  ktc_total: 6,
  ktc_starters: 7,
  ktc_bench: 8,
  ktc_picks: 9,
};

/** Every metric the columns dialog offers, in canonical column order. */
export const LINEUP_METRIC_IDS: readonly LineupMetricId[] = (
  Object.keys(METRIC_ORDER) as LineupMetricId[]
).sort((a, b) => METRIC_ORDER[a] - METRIC_ORDER[b]);

/**
 * Words for the rank metrics: the tile's two lines, the chip's short name and
 * the bay's sentence.
 *
 * Beside `METRIC_ORDER` because the two are the same seam seen twice: this file
 * already holds the client half of the contract's compiler list, and the labels
 * are the other exhaustive `Record<LineupMetricId, …>` a new id has to be
 * placed in.
 *
 * **`unit` over `scope` is the tile's whole grammar**, and it is what the row
 * of four is legible at 9px for: the first line names what is being counted and
 * the second names how much of the roster it was counted over, so two tiles
 * from one family read as one instrument rather than as two labels a reader has
 * to tell apart. On the four KeepTradeCut metrics the second line is spent on
 * the market pair instead — `Dyn·SF` — because which board priced a number is
 * the thing a reader cannot infer and the scope is already in the unit's own
 * words. `scope` is therefore empty on exactly those four, and `isKtcMetric` is
 * what says so rather than the emptiness being read as a signal.
 *
 * `column` is the longer name, for the chips and the picker's key list, where
 * there is room for it and where the metric is being *chosen* rather than read.
 */
export const LINEUP_METRIC_LABELS: Record<
  LineupMetricId,
  { column: string; unit: string; scope: string; option: string }
> = {
  ros_total: {
    column: "ROS total",
    unit: "Proj pts",
    scope: "Roster",
    option: "Projected points — the whole roster, rest of season.",
  },
  ros_starters: {
    column: "ROS starters",
    unit: "Proj pts",
    scope: "Starters",
    option: "Projected points — starters, rest of season.",
  },
  ros_bench: {
    column: "ROS bench",
    unit: "Proj pts",
    scope: "Bench",
    option: "Projected points — bench, rest of season.",
  },
  capital_total: {
    column: "Capital",
    unit: "Draft cap",
    scope: "Roster",
    option: "Draft capital off ADP — the whole roster.",
  },
  capital_bench: {
    column: "Bench capital",
    unit: "Draft cap",
    scope: "Bench",
    option: "Draft capital off ADP — the bench only.",
  },
  capital_starters: {
    column: "Starter capital",
    unit: "Draft cap",
    scope: "Starters",
    option: "Draft capital off ADP — the starters only.",
  },
  ktc_total: {
    column: "KTC total",
    unit: "KTC",
    scope: "",
    option: "KeepTradeCut — roster and picks.",
  },
  ktc_starters: {
    column: "KTC starters",
    unit: "KTC start",
    scope: "",
    option: "KeepTradeCut — the starters only.",
  },
  ktc_bench: {
    column: "KTC bench",
    unit: "KTC bench",
    scope: "",
    option: "KeepTradeCut — the bench only.",
  },
  ktc_picks: {
    column: "KTC picks",
    unit: "KTC picks",
    scope: "",
    option: "KeepTradeCut — future draft picks.",
  },
};

/**
 * The two axes a metric is composed from, and the grid they index.
 *
 * The ten ids are not ten unrelated readings: they are a *value* (what a number
 * is priced in) crossed with a *scope* (how much of a roster it was counted
 * over), and the picker asks those two questions rather than listing the
 * products. The grid makes its own gaps visible, which is what it is for:
 *
 * - **Projection × All used to be a hole and is `ros_total` now.** The grid is
 *   what made the absence legible — a greyed key reading "there is no
 *   whole-roster projection", where the nine-key list it replaced simply did
 *   not offer one and nobody could see what was missing. Filling it was the
 *   server work that note predicted: an id in the contract, a total in
 *   `lineupMetricTotals`, a rank in the literal, and a place in each of the
 *   exhaustive `Record<LineupMetricId, …>`s.
 * - **Picks are not a roster scope.** They are the one thing on a card that is
 *   not a player, and only KeepTradeCut prices them — there is no ADP pick
 *   ladder in this repo and a pick has no projection because it is not a player
 *   yet. So `Picks` is a fourth scope key, live under KTC and greyed under the
 *   other two. That is the grid's one remaining gap, and it is a reading that
 *   cannot exist rather than one this app has not built.
 *
 * {@link METRIC_AXES} is the **fifth** exhaustive `Record<LineupMetricId, …>`
 * in the compiler seam, and the grid is derived from it rather than written
 * twice: a metric that named one pairing in the table and another in the grid
 * would be a picker whose keys light on a column it does not set.
 */
export type ColumnValue = "projection" | "capital" | "ktc";
export type ColumnScope = "starters" | "bench" | "all" | "picks";

export const COLUMN_VALUES: readonly ColumnValue[] = [
  "projection",
  "capital",
  "ktc",
];
export const COLUMN_SCOPES: readonly ColumnScope[] = [
  "starters",
  "bench",
  "all",
  "picks",
];

export const COLUMN_VALUE_LABELS: Record<ColumnValue, string> = {
  projection: "Proj",
  capital: "Capital",
  ktc: "KTC",
};

export const COLUMN_SCOPE_LABELS: Record<ColumnScope, string> = {
  starters: "Starters",
  bench: "Bench",
  all: "All",
  picks: "Picks",
};

/**
 * The third axis: which positions a column counts.
 *
 * **Multi-select, and `All` is not a tenth key.** It is the absence of a
 * narrowing — pressing it empties the set, turning the last lit position off
 * returns there, and it is lit exactly when the set is empty. A tenth value
 * would be a second spelling of "every position" that the key, the stored
 * value and the rank would each have to agree about.
 *
 * The list is {@link FANTASY_POSITIONS}, which is derived from the solver's own
 * `SLOT_POSITIONS` rather than written here — so a position the solver learns
 * is offerable the same day, and one this panel offered that no slot admits
 * could never seat anybody. The cast is the union the contract declares, tied
 * to that derivation by `positions.test.ts`.
 *
 * **The three individual-defender families are broken out** rather than folded
 * into one `IDP` key, because `DL`, `LB` and `DB` are the groups a league
 * actually starts: one key would name a bucket rather than a board.
 */
export const LINEUP_POSITIONS = FANTASY_POSITIONS as readonly LineupPosition[];

/**
 * Where the milled hairlines fall in the position track: after the four skill
 * positions plus the kicker and the team defence, and before the individual
 * defenders.
 *
 * Read off the vocabulary rather than spelled as indices, so a position the
 * solver learns lands on the correct side of the cut instead of shifting a
 * number nobody would think to update.
 */
export const IDP_LINEUP_POSITIONS: readonly LineupPosition[] = [
  "DL",
  "LB",
  "DB",
];

/** Each position as the key spells it — the axis's own words, and the card's. */
export const LINEUP_POSITION_LABELS: Record<LineupPosition, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
  DL: "DL",
  LB: "LB",
  DB: "DB",
};

/**
 * The position clause a bay's second line and the card's tile both print —
 * `QB/TE` — or nothing at all where the column counts every position.
 *
 * Slash-joined and tight, because it shares a 59px line with the scope or the
 * board pair it follows. One spelling, so the two surfaces cannot come to
 * describe one column two ways.
 */
export function positionsLabel(
  positions: readonly LineupPosition[],
): string {
  return positions.map((one) => LINEUP_POSITION_LABELS[one]).join("/");
}

/**
 * The same set as a sentence's tail — ` QB and TE only.` — or nothing.
 *
 * A comma list with `and` before the last, which is what the `Reads` window
 * needs and what a slash-joined label cannot be read as. Leading space and
 * trailing stop included, so the caller appends rather than punctuating.
 */
export function positionsClause(
  positions: readonly LineupPosition[],
): string {
  if (positions.length === 0) return "";
  const words = positions.map((one) => LINEUP_POSITION_LABELS[one]);
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return ` ${list} only.`;
}

/**
 * The fourth axis: which starting seats a column counts.
 *
 * **A seat, where the position axis picks a player — and the two compose.** A
 * column narrowed to `FLEX` and to `WR` counts the wide receivers *occupying
 * flex seats*, which is what a reader asking "how does my flex seat rank across
 * my leagues" is after and which neither axis answers alone. Multi-select with
 * an `All` key on {@link LINEUP_POSITIONS}' exact terms: `All` is the absence
 * of a narrowing rather than a fifteenth value, so pressing it empties the set
 * and turning the last lit slot off returns there by arithmetic.
 *
 * **The whole vocabulary lives here and the *offered* one does not** — see
 * {@link slotsInHand}, which is the leagues' own union. The two are different
 * questions: this is every seat a lineup can have, which is what a stored value
 * is validated against, and that is every seat the reader's leagues actually
 * start, which is what the picker draws. Offering a key for a seat nobody
 * starts would be a narrowing that could never seat anybody; validating against
 * the leagues in hand would silently widen a column the day an IDP league left
 * the account.
 */
export const LINEUP_SLOTS = STARTING_SLOTS as readonly LineupSlot[];

/**
 * Which of the three runs a slot belongs to, and therefore where the picker's
 * milled hairlines fall: the bare skill seats, the flexes that recombine them,
 * then the special units and the individual defenders.
 *
 * A group per slot rather than two constants naming the first of each run,
 * which is where this parts company with `IDP_LINEUP_POSITIONS` beside it and
 * the reason is that **the track offers a subset**. A cut spelled as "before
 * `FLEX`" falls nowhere at all in an account whose only flex is a superflex,
 * and the two runs read as one. Asked per key, the cut lands before the first
 * *offered* slot of each run whatever the account holds.
 *
 * Exhaustive by construction, so a slot the solver learns has to be placed in a
 * run before this compiles.
 */
export type SlotGroup = "bare" | "flex" | "unit";

export const LINEUP_SLOT_GROUPS: Record<LineupSlot, SlotGroup> = {
  QB: "bare",
  RB: "bare",
  WR: "bare",
  TE: "bare",
  FLEX: "flex",
  WRRB_FLEX: "flex",
  REC_FLEX: "flex",
  SUPER_FLEX: "flex",
  K: "unit",
  DEF: "unit",
  DL: "unit",
  LB: "unit",
  DB: "unit",
  IDP_FLEX: "unit",
};

/**
 * Each slot as a key spells it — the track's own words, and the card's.
 *
 * **`SUPER_FLEX` cannot be spelled**, which is what the two abbreviations are
 * for: the track is 412px at the panel's desktop width across as many as
 * fifteen keys, and the tile's second line is ten and a half characters at a
 * phone's. `SF` is the app's own word for that board already ({@link
 * qbBoardWord}, `LINEUP_WORDS`), so it is not new vocabulary a reader has to
 * learn; `IDP` is the name the league filters give that slot group.
 */
export const LINEUP_SLOT_LABELS: Record<LineupSlot, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  SUPER_FLEX: "SF",
  K: "K",
  DEF: "DEF",
  DL: "DL",
  LB: "LB",
  DB: "DB",
  IDP_FLEX: "IDP",
};

/**
 * The same fourteen as a sentence says them.
 *
 * A second Record rather than the labels reused, because a label is a key cap
 * and a word is prose: `SF` is right on a 27px key and wrong in "in the SF
 * seat", where the sentence has room to name the thing. The two flexes that
 * abbreviate to a slash on a key are spelled out here for the same reason.
 */
export const LINEUP_SLOT_WORDS: Record<LineupSlot, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  WRRB_FLEX: "RB/WR flex",
  REC_FLEX: "WR/TE flex",
  SUPER_FLEX: "superflex",
  K: "K",
  DEF: "DEF",
  DL: "DL",
  LB: "LB",
  DB: "DB",
  IDP_FLEX: "IDP flex",
};

/**
 * The startable slots this account's leagues actually run, in canonical order.
 *
 * The picker's own vocabulary, and it is the leagues' rather than the table's
 * for the rule the position axis already lives by: a key for a seat no league
 * starts is a narrowing that could never seat anybody, so a slot absent from
 * every league in hand is *absent* rather than greyed.
 *
 * **The unfiltered league list, never the narrowed one.** A column is a device
 * preference that outlives any filter — the same four bays answer every card on
 * the page — so a vocabulary that moved with the Filters dialog would take keys
 * off a track for reasons the panel cannot state, and a reader who had narrowed
 * to redraft would find the superflex seat they were comparing had vanished.
 *
 * A thin wrapper on {@link startingSlotsOf}, which is where the three
 * exclusions live; what this adds is the cast to the union the contract
 * declares, tied to that derivation by `starting-slots.test.ts`.
 */
export function slotsInHand(
  rosterPositions: readonly (readonly string[] | null)[],
): readonly LineupSlot[] {
  return startingSlotsOf(rosterPositions) as LineupSlot[];
}

/**
 * The slot clause a bay's second line and the card's tile both print —
 * `FLEX/SF` — or nothing at all where the column counts every seat.
 *
 * Slash-joined and tight, {@link positionsLabel}'s spelling one axis over,
 * because the two share a 59px line.
 */
export function slotsLabel(slots: readonly LineupSlot[]): string {
  return slots.map((one) => LINEUP_SLOT_LABELS[one]).join("/");
}

/**
 * The two narrowings as one sentence's tail — ` In the FLEX and superflex
 * seats, WR only.` — or nothing at all.
 *
 * **One clause rather than two, because they are one intersection.** A slot
 * picks the seats and a position picks who is sitting in them, so two sentences
 * would read as two independent filters a reader has to multiply out for
 * themselves. Singular where one seat is lit, since "in the superflex seats" is
 * wrong about a lineup that has one.
 *
 * It supersedes {@link positionsClause} rather than joining it: that function
 * is still the positions-only arm and is unchanged, and this is what the
 * `Reads` window calls. Leading space and trailing stop included, so the caller
 * appends rather than punctuating — the contract `positionsClause` already has.
 */
export function narrowingClause(
  slots: readonly LineupSlot[],
  positions: readonly LineupPosition[],
): string {
  if (slots.length === 0) return positionsClause(positions);
  const seats = wordList(slots.map((one) => LINEUP_SLOT_WORDS[one]));
  const noun = slots.length === 1 ? "seat" : "seats";
  if (positions.length === 0) return ` In the ${seats} ${noun} only.`;
  const who = wordList(positions.map((one) => LINEUP_POSITION_LABELS[one]));
  return ` In the ${seats} ${noun}, ${who} only.`;
}

/** A comma list with `and` before the last — both clauses' one spelling. */
function wordList(words: readonly string[]): string {
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Why the slot axis is off for a column, or null where it can be pressed.
 *
 * **A seat is a thing only a starting lineup has**, which is the whole of the
 * rule: a bench player occupies none, a whole-roster total spans both halves of
 * a partition only one of which has seats, and a draft pick is not a player at
 * all. So the axis is in force on the `starters` scope and out of force on the
 * other three — and out of force *in place*, keeping its row, because
 * `Starters` unlit one track above is what explains the dim and a track that
 * appeared under a press would resize the panel mid-sitting.
 *
 * Whole-axis rather than per-key, which is the distinction `SwitchTrack`
 * documents: this is a fact about the column being edited, not about any one
 * seat.
 */
export function slotGapReason(scope: ColumnScope): string | null {
  return scope === "starters" ? null : "Only a starters column counts slots";
}

/**
 * Why the position axis is off for a column, or null where it can be pressed.
 *
 * One reason and one column it applies to: `ktc_picks` is the single metric on
 * the grid that is not about players, and a draft pick has no position yet —
 * which is the same fact the scope axis already states by having `Picks` live
 * under KeepTradeCut alone. `All` stays pressable there, because it is the
 * absence of a narrowing rather than a narrowing to everything.
 */
export function positionGapReason(scope: ColumnScope): string | null {
  return scope === "picks" ? "A draft pick has no position" : null;
}

const METRIC_AXES: Record<LineupMetricId, [ColumnValue, ColumnScope]> = {
  ros_total: ["projection", "all"],
  ros_starters: ["projection", "starters"],
  ros_bench: ["projection", "bench"],
  capital_total: ["capital", "all"],
  capital_bench: ["capital", "bench"],
  capital_starters: ["capital", "starters"],
  ktc_total: ["ktc", "all"],
  ktc_starters: ["ktc", "starters"],
  ktc_bench: ["ktc", "bench"],
  ktc_picks: ["ktc", "picks"],
};

/** Which cell of the grid a metric sits in. */
export function metricAxes(metric: LineupMetricId): {
  value: ColumnValue;
  scope: ColumnScope;
} {
  const [value, scope] = METRIC_AXES[metric];
  return { value, scope };
}

/** The metric at one cell, or null where the grid has a hole. */
export function metricAt(
  value: ColumnValue,
  scope: ColumnScope,
): LineupMetricId | null {
  for (const id of LINEUP_METRIC_IDS) {
    const [v, s] = METRIC_AXES[id];
    if (v === value && s === scope) return id;
  }
  return null;
}

/**
 * Why a cell has no metric — the key's title, and never a silent grey.
 *
 * Null where the cell exists. Only one gap is left on the grid — a pick priced
 * on anything but KeepTradeCut, which is a reading that cannot exist rather
 * than one this app has not built. The fallback under it is not dead code but
 * the thing that keeps this total: a value or scope added without a metric
 * behind it greys with a word rather than with nothing.
 */
export function cellGapReason(
  value: ColumnValue,
  scope: ColumnScope,
): string | null {
  if (metricAt(value, scope)) return null;
  if (scope === "picks") return "Only KeepTradeCut prices a draft pick";
  return "No column reads that";
}

/** The market half of a bay's label, as the switch keys spell it. */
const MARKET_WORDS: Record<KtcBoardChoice, string> = {
  auto: "Auto",
  dynasty: "Dyn",
  redraft: "Red",
};

/** The QB-board half, likewise. */
const LINEUP_WORDS: Record<KtcLineupChoice, string> = {
  auto: "Auto",
  oneqb: "1QB",
  sf: "SF",
};

/**
 * What a KeepTradeCut column is *set* to — `Auto · Auto`, `Dyn · SF`.
 *
 * The bay and the chip print this, because a setting is what they are showing:
 * `Auto` is a rule about each league and naming a market there would be a claim
 * about leagues the control has never seen.
 */
export function ktcChoiceLabel(col: LineupColumn): string {
  return `${MARKET_WORDS[col.format]} · ${LINEUP_WORDS[col.lineup]}`;
}

/**
 * What a KeepTradeCut column actually *read*, for one league — `Dyn·SF`.
 *
 * The tile prints this, because a tile is a reading rather than a setting: the
 * card knows its own league, so it resolves both axes through the same two pure
 * functions the route priced the number with, and a column left on `Auto` still
 * says which board answered. Tight rather than spaced, because it is nine
 * characters of a 59px line.
 */
export function ktcBoardLabel(format: KtcFormat, superflex: boolean): string {
  return `${MARKET_WORDS[format]}·${qbBoardWord(superflex)}`;
}

/**
 * Which of the two QB boards, in the tightest words there are — `SF` / `1QB`.
 *
 * One spelling, because three surfaces print it: a KeepTradeCut tile's board
 * pair, a capital tile's forced board, and the switch keys in the picker (which
 * take it from `LINEUP_WORDS`, the same two words with `Auto` beside them).
 */
export function qbBoardWord(superflex: boolean): string {
  return superflex ? "SF" : "1QB";
}

/**
 * What a *capital* column is set to, or nothing at all where it is set to the
 * league's own board.
 *
 * **Nothing on `auto`, which is where a capital bay parts company with a
 * KeepTradeCut one.** A KTC bay's second line has nothing else to carry — its
 * scope is already in its unit — so it spells the rule out as `Auto · Auto`. A
 * capital bay's line is the scope (`Roster`, `Bench`, `Starters`), and
 * appending `· Auto` to it would spend a third of a 72px line on a word meaning
 * "nothing was forced" in a rack where nothing is forced by default. So the
 * board appears exactly when a reader has set one, which is also when it is the
 * only thing telling two capital bays apart.
 */
export function adpBoardLabel(lineup: KtcLineupChoice): string {
  return lineup === "auto" ? "" : LINEUP_WORDS[lineup];
}

/**
 * The four columns a first visit shows.
 *
 * Unchanged by the axes arriving, so nobody's stored selection moves and a
 * reader who never opens the picker sees the page they had.
 */
export const DEFAULT_LINEUP_COLUMNS: readonly LineupColumn[] = [
  column("ros_starters"),
  column("ros_bench"),
  column("capital_total"),
  column("capital_bench"),
];

/**
 * One column on every axis's default — the league's own market and QB board,
 * and every position.
 *
 * The position set is normalized here rather than trusted, on the same terms as
 * the two axes below: this is the one constructor, so a set that arrived out of
 * order or carrying a word no slot admits cannot reach a key.
 */
export function column(
  metric: LineupMetricId,
  format: KtcBoardChoice = "auto",
  lineup: KtcLineupChoice = "auto",
  positions: readonly LineupPosition[] = [],
  slots: readonly LineupSlot[] = [],
): LineupColumn {
  // A draft pick is not a player and has no position to narrow to — the same
  // fact the scope axis states by having `Picks` live under KeepTradeCut alone.
  // Forced empty here rather than guarded at each caller, so a stored value
  // carrying one cannot become a key nothing ranks.
  const narrowed =
    metric === "ktc_picks" ? [] : normalizeLineupPositions(positions);
  // **A seat is a thing only a starting lineup has**, so the slot set is forced
  // empty off the `starters` scope — the third forcing this constructor makes
  // and the same argument as the two below: one constructor, so a press and a
  // stored value cannot come to disagree, and `lineupColumnKey` can fold the
  // axis out of the key of every column that cannot read it. Without it a
  // stored `ros_bench` carrying `@flex` would key as a second, un-removable
  // copy of the bench column, ranked on a narrowing that counts nobody.
  const seats =
    metricAxes(metric).scope === "starters" ? normalizeLineupSlots(slots) : [];
  // **Each axis is forced to `auto` on a metric that cannot read it**, which is
  // what makes `lineupColumnKey` able to fold it out of the key — so a stored
  // value carrying a stray board on a projections column cannot become a
  // second, un-removable copy of it. The two axes are forced separately because
  // they are read by different metrics: a market is KeepTradeCut's alone, where
  // a QB board is a fact about the league that both priced valuations split on.
  return {
    metric,
    format: isKtcMetric(metric) ? format : "auto",
    lineup: readsQbBoard(metric) ? lineup : "auto",
    positions: narrowed,
    slots: seats,
  };
}

/**
 * Fold anything — a press, a stored string's parse, a value written by a build
 * that predates the axes — into a valid selection: known metrics only, deduped
 * on the whole column, canonical order, and **exactly four**. Applied on write
 * *and* read so the two ends cannot disagree about what a valid selection is.
 *
 * **A legacy `string[]` reads as triples on `auto`**, which is what keeps a
 * stored selection through the change: the axes did not exist when it was
 * written, and `auto` is what the page was doing anyway.
 *
 * The dedupe is on {@link lineupColumnKey} rather than on the metric, which is
 * the whole point of the shape — two KTC columns on two boards are two columns,
 * and so are two narrowed to different positions — and it is also what stops
 * the same board being chosen twice.
 *
 * **Short is topped up rather than left short**, which is new with the position
 * axis and is really the empty socket's removal: see {@link toppedUp}.
 *
 * Exported for the tests: this is the pure half both ends of the store share,
 * and every rule in it is silent when it goes wrong — a stored selection lost
 * on upgrade, a second bay that quietly deletes the first, a fifth column.
 */
export function normalizeLineupColumns(
  value: unknown,
): readonly LineupColumn[] {
  if (!Array.isArray(value)) return DEFAULT_LINEUP_COLUMNS;

  const seen = new Map<string, LineupColumn>();
  for (const entry of value) {
    const parsed = readColumn(entry);
    if (!parsed) continue;
    const key = lineupColumnKey(parsed);
    if (!seen.has(key)) seen.set(key, parsed);
  }
  if (seen.size === 0) return DEFAULT_LINEUP_COLUMNS;

  const chosen = [...seen.values()]
    .sort(
      (a, b) =>
        METRIC_ORDER[a.metric] - METRIC_ORDER[b.metric] ||
        // Two bays on one metric still need a stable order, and the axes are
        // the only thing left to sort them by. The key is what the card looks
        // its rank up by, so ordering on it cannot invent a third identity.
        lineupColumnKey(a).localeCompare(lineupColumnKey(b)),
    )
    .slice(0, MAX_LINEUP_COLUMNS);

  return chosen.length === MAX_LINEUP_COLUMNS ? chosen : toppedUp(chosen, seen);
}

/**
 * Fill a short selection back out to four, in canonical order.
 *
 * **The rack has no empty socket**, so a selection of three is a bay the panel
 * cannot draw and cannot offer a way to fill — which is what
 * {@link MAX_LINEUP_COLUMNS} meaning *exactly* four buys, and where it has to be
 * bought: on read as well as on write, since the short value may be one a build
 * that predates the change wrote, or one a reader's own hand-edit left.
 *
 * The defaults come first and the rest of the grid after, both un-narrowed and
 * on each league's own board — so a reader who has emptied their storage lands
 * on the page they had, and one whose stored value held two columns keeps both
 * and gains the two defaults they were missing rather than a metric nobody
 * chose. It cannot fail to reach four: nine metrics against a cap of four, and
 * the five with no market are one column each by construction.
 */
function toppedUp(
  chosen: readonly LineupColumn[],
  seen: ReadonlyMap<string, LineupColumn>,
): readonly LineupColumn[] {
  const filled = [...chosen];
  const held = new Set(seen.keys());
  const candidates = [
    ...DEFAULT_LINEUP_COLUMNS,
    ...LINEUP_METRIC_IDS.map((metric) => column(metric)),
  ];
  for (const candidate of candidates) {
    if (filled.length >= MAX_LINEUP_COLUMNS) break;
    const key = lineupColumnKey(candidate);
    if (held.has(key)) continue;
    held.add(key);
    filled.push(candidate);
  }
  return filled.sort(
    (a, b) =>
      METRIC_ORDER[a.metric] - METRIC_ORDER[b.metric] ||
      lineupColumnKey(a).localeCompare(lineupColumnKey(b)),
  );
}

/**
 * Seat a canonical selection into a rack whose sockets are already occupied.
 *
 * **The store is a set in canonical order and the picker's rack is an
 * arrangement of it, and this is the one function that reconciles the two.**
 * The module header's rule is unchanged — `normalize` sorts on write and read
 * alike, and the card's tile strip is that order — but a *socket* is a hole a
 * reader is pressing into, and re-sorting the rack under their finger is what
 * this exists to stop: changing bay 01 from a projection to a KeepTradeCut
 * column moves that column to the end of the canonical order, and a rack that
 * followed it would teleport the tile being edited across the panel and shift
 * the other three under it. Held, the socket keeps what it was just given and
 * nothing else moves.
 *
 * `order` is a list of {@link lineupColumnKey}s, one per socket, and it is
 * **matched rather than trusted** — it can be stale the moment another tab
 * writes a different selection, or one press behind its own store. So each
 * socket claims the column it names *if that column is still in the selection*,
 * each column is claimed at most once, and whatever is left fills the empty
 * sockets in canonical order. A null `order` is the absence of an arrangement
 * and answers the canonical order itself, which is what a first open draws.
 *
 * Total by construction: the result is always `canonical` re-ordered, never a
 * column dropped or drawn twice, which is the failure this being a pure
 * function under Node's own runner is for — a rack that lost a bay or repeated
 * one renders perfectly and is a column the reader can no longer reach.
 */
export function arrangeLineupColumns(
  canonical: readonly LineupColumn[],
  order: readonly string[] | null,
): readonly LineupColumn[] {
  if (!order) return canonical;

  const unseated = new Map(canonical.map((c) => [lineupColumnKey(c), c]));
  const sockets = canonical.map((_, i) => {
    const key = order[i];
    const held = key === undefined ? undefined : unseated.get(key);
    if (held) unseated.delete(key);
    return held ?? null;
  });

  const spare = [...unseated.values()];
  return sockets.map((held) => held ?? spare.shift()!);
}

/**
 * One stored entry, in any of its three shapes, or null where it names no known
 * metric.
 *
 * **An entry with no `positions` field reads as the empty set**, which is what
 * keeps every existing reader's selection through this change: the axis did not
 * exist when the value was written, and "every position" is what the page was
 * doing anyway. That is the same rule one grain older that already reads a
 * legacy bare string as a triple on `auto`.
 */
function readColumn(entry: unknown): LineupColumn | null {
  if (typeof entry === "string") {
    return entry in METRIC_ORDER ? column(entry as LineupMetricId) : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const { metric, format, lineup, positions, slots } = entry as Record<
    string,
    unknown
  >;
  if (typeof metric !== "string" || !(metric in METRIC_ORDER)) return null;
  return column(
    metric as LineupMetricId,
    format === "dynasty" || format === "redraft" ? format : "auto",
    lineup === "oneqb" || lineup === "sf" ? lineup : "auto",
    // Unknown entries drop, duplicates collapse and the set sorts into the
    // axis's own order — `normalizeLineupPositions`, reached through `column`.
    normalizeLineupPositions(positions),
    // The same rule one axis over, and the same legacy read: an entry with no
    // `slots` field is the absence of a narrowing, which is what the page was
    // doing before the axis existed.
    normalizeLineupSlots(slots),
  );
}

/** Persist the chosen columns (normalized, see above) and notify readers. */
export function storeLineupColumns(columns: readonly LineupColumn[]) {
  writeLocal(STORAGE_KEY, JSON.stringify(normalizeLineupColumns(columns)));
}

/**
 * The chosen columns — the defaults on the server, on the first client render,
 * and wherever nothing valid is stored (the documented `local-store` trade: a
 * stored choice swaps in after hydration).
 */
export function useLineupColumns(): readonly LineupColumn[] {
  const raw = useLocalValue(STORAGE_KEY);
  // Parsed in a memo keyed on the raw string, per the store's contract.
  return useMemo(() => {
    if (!raw) return DEFAULT_LINEUP_COLUMNS;
    try {
      return normalizeLineupColumns(JSON.parse(raw));
    } catch {
      return DEFAULT_LINEUP_COLUMNS;
    }
  }, [raw]);
}

// Which column the expanded card's **standings pane** reads and orders itself
// by, remembered on the device beside the four the card's tile row shows.
//
// **One column, and the same six axes**, which is what makes it worth a store
// of its own rather than a fifth bay: the rack is a strip of equals a reader
// compares across, where this is the one figure a twelve-team table is sorted
// on. It is a `LineupColumn` for the same reason it is not a `LineupMetricId`
// any more — a narrowed or forced column is a different question from the metric
// it is built on, and the pane's own picker offers both.
//
// **Persisted, where the metric and the lens it replaces were not.** Those were
// `useState` on the argument that a way of reading one card is a fact about a
// sitting; a column composed on six axes is not something a reader wants to
// rebuild on every visit, and it is the same class of preference the four bays
// already are. The key is its own — see {@link storeTeamsColumn}.
const TEAMS_STORAGE_KEY = "thelab:teams-column";

/**
 * The column the standings pane opens on.
 *
 * `ros_starters` on every axis's default, which is what that pane sorted by
 * before it had a picker — so a reader who never opens the dialog sees the card
 * they had.
 */
export const DEFAULT_TEAMS_COLUMN: LineupColumn = column("ros_starters");

/**
 * Fold anything — a press, a stored string's parse, a value written before an
 * axis existed — into a column this pane can actually read.
 *
 * **Through the one {@link column} constructor**, which is the whole of it: a
 * stored value carrying a slot set on a bench scope, a position set on a pick
 * column or a market on a projection is not a column that ranks nothing, it is
 * a *key nothing answers* — the server files its totals under the folded
 * spelling and the pane would look up the unfolded one and find an em dash. The
 * same fold runs on write and read alike, so the two ends cannot disagree about
 * what a valid column is.
 *
 * Exported for the tests: every rule in it is silent when it goes wrong.
 */
export function normalizeTeamsColumn(value: unknown): LineupColumn {
  if (typeof value === "string") {
    return value in METRIC_ORDER
      ? column(value as LineupMetricId)
      : DEFAULT_TEAMS_COLUMN;
  }
  if (!value || typeof value !== "object") return DEFAULT_TEAMS_COLUMN;
  const { metric, format, lineup, positions, slots } = value as Record<
    string,
    unknown
  >;
  if (typeof metric !== "string" || !(metric in METRIC_ORDER)) {
    return DEFAULT_TEAMS_COLUMN;
  }
  return column(
    metric as LineupMetricId,
    format === "dynasty" || format === "redraft" ? format : "auto",
    lineup === "oneqb" || lineup === "sf" ? lineup : "auto",
    normalizeLineupPositions(positions),
    normalizeLineupSlots(slots),
  );
}

/**
 * Persist the standings pane's column (normalized, see above) and notify
 * readers.
 *
 * **A key of its own rather than a fifth entry under the bays'.** The two are
 * different shapes — a set of exactly four against a single column — so one key
 * would have to carry a discriminator, and every reader of the rack would have
 * to know to skip an entry that is not one of its own. The panes and the tile
 * row are also two independent readings of the same league, which is the whole
 * reason the pane got a picker: a reader can rank their card on KeepTradeCut
 * and still sort the standings by projected points.
 */
export function storeTeamsColumn(col: LineupColumn) {
  writeLocal(TEAMS_STORAGE_KEY, JSON.stringify(normalizeTeamsColumn(col)));
}

/**
 * The standings pane's column — the default on the server, on the first client
 * render, and wherever nothing valid is stored (the documented `local-store`
 * trade: a stored choice swaps in after hydration).
 */
export function useTeamsColumn(): LineupColumn {
  const raw = useLocalValue(TEAMS_STORAGE_KEY);
  // Parsed in a memo keyed on the raw string, per the store's contract.
  return useMemo(() => {
    if (!raw) return DEFAULT_TEAMS_COLUMN;
    try {
      return normalizeTeamsColumn(JSON.parse(raw));
    } catch {
      return DEFAULT_TEAMS_COLUMN;
    }
  }, [raw]);
}
