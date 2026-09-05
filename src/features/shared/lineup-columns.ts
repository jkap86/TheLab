"use client";

import { useMemo } from "react";

import type {
  KtcBoardChoice,
  KtcFormat,
  KtcLineupChoice,
  LineupColumn,
  LineupMetricId,
} from "@/shared/contract";
// Relative with an explicit extension, the way `shares-columns.ts` beside it
// reaches the same store: the rules below are read by Node's own test runner,
// which resolves neither the `@/*` aliases nor an extensionless specifier. The
// key spelling is `shared/ktc/columns` because the *server* writes the same
// keys — see the note above — and it is pure for exactly this reason.
import { isKtcMetric, lineupColumnKey } from "../../shared/ktc/columns.ts";

import { useLocalValue, writeLocal } from "./local-store.ts";

// Which rank columns the league cards show, remembered on the device. The
// storage mechanics live in `local-store.ts`; what is here is only what this
// key holds and the rules that keep it honest.
//
// **A column is a triple now, not a metric id** — the metric, plus which
// KeepTradeCut market and which QB board it is priced on. That is what lets one
// metric occupy two bays: a reader comparing their roster's dynasty superflex
// worth against its 1QB worth is asking two questions, and until the axes moved
// into the column there was one global board and no way to ask both. The five
// non-KTC metrics ignore both axes — a projection has no market — which is why
// `lineupColumnKey` folds them back to a bare metric id and they can never
// duplicate.
//
// The selection is still a *set*, not an arrangement: columns render in
// canonical order, so `normalize` sorts on write and read alike and a
// hand-edited or stale stored value cannot invent an ordering the UI never
// offered. Bays are numbered by that order, so an edit renumbers them — which
// is the cheaper of the two readings the design considered, and the one it
// draws no dragging affordance for.
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
 */
export const MAX_LINEUP_COLUMNS = 4;

// Exhaustive by construction — the client half of the contract's compiler
// seam: a new `LineupMetricId` breaks this Record until it is placed.
const METRIC_ORDER: Record<LineupMetricId, number> = {
  ros_starters: 0,
  ros_bench: 1,
  capital_total: 2,
  capital_bench: 3,
  capital_starters: 4,
  ktc_total: 5,
  ktc_starters: 6,
  ktc_bench: 7,
  ktc_picks: 8,
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
 * The nine ids are not nine unrelated readings: they are a *value* (what a
 * number is priced in) crossed with a *scope* (how much of a roster it was
 * counted over), and the picker asks those two questions rather than listing
 * the products. The list was hiding two gaps that the grid makes visible, and
 * both are real rather than oversights:
 *
 * - **Projection × All has no metric.** A whole-roster rest-of-season
 *   projection does not exist here, and adding one is server work — an id in
 *   the contract, a total in the solver, a rank in the route, a place in each
 *   of the four exhaustive `Record<LineupMetricId, …>`s. Until it does, the key
 *   is greyed with the reason in its title, which is this app's rule for a
 *   control that cannot act.
 * - **Picks are not a roster scope.** They are the one thing on a card that is
 *   not a player, and only KeepTradeCut prices them — there is no ADP pick
 *   ladder in this repo and a pick has no projection because it is not a player
 *   yet. So `Picks` is a fourth scope key, live under KTC and greyed under the
 *   other two.
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

const METRIC_AXES: Record<LineupMetricId, [ColumnValue, ColumnScope]> = {
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
 * Null where the cell exists. The two reasons are the two above, and they are
 * different claims: one is a reading this app has not built, the other is a
 * reading that cannot exist on that basis at all.
 */
export function cellGapReason(
  value: ColumnValue,
  scope: ColumnScope,
): string | null {
  if (metricAt(value, scope)) return null;
  if (scope === "picks") return "Only KeepTradeCut prices a draft pick";
  if (value === "projection" && scope === "all") {
    return "There is no whole-roster projection";
  }
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
  return `${MARKET_WORDS[format]}·${superflex ? "SF" : "1QB"}`;
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

/** One column on both axes' defaults — the league's own market and QB board. */
export function column(
  metric: LineupMetricId,
  format: KtcBoardChoice = "auto",
  lineup: KtcLineupChoice = "auto",
): LineupColumn {
  // The axes are meaningless on a metric with no market, and forcing them to
  // `auto` here is what makes `lineupColumnKey` able to fold those five to a
  // bare metric id — so a stored value that carries a stray board on a
  // projections column cannot become a second, un-removable copy of it.
  return isKtcMetric(metric)
    ? { metric, format, lineup }
    : { metric, format: "auto", lineup: "auto" };
}

/**
 * Fold anything — a press, a stored string's parse, a value written by a build
 * that predates the axes — into a valid selection: known metrics only, deduped
 * on the whole triple, canonical order, capped, and never empty. Applied on
 * write *and* read so the two ends cannot disagree about what a valid selection
 * is.
 *
 * **A legacy `string[]` reads as triples on `auto`**, which is what keeps a
 * stored selection through the change: the axes did not exist when it was
 * written, and `auto` is what the page was doing anyway.
 *
 * The dedupe is on {@link lineupColumnKey} rather than on the metric, which is
 * the whole point of the new shape — two KTC columns on two boards are two
 * columns — and it is also what stops the same board being chosen twice.
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

  return [...seen.values()]
    .sort(
      (a, b) =>
        METRIC_ORDER[a.metric] - METRIC_ORDER[b.metric] ||
        // Two bays on one metric still need a stable order, and the axes are
        // the only thing left to sort them by. The key is what the card looks
        // its rank up by, so ordering on it cannot invent a third identity.
        lineupColumnKey(a).localeCompare(lineupColumnKey(b)),
    )
    .slice(0, MAX_LINEUP_COLUMNS);
}

/** One stored entry, in either shape, or null where it names no known metric. */
function readColumn(entry: unknown): LineupColumn | null {
  if (typeof entry === "string") {
    return entry in METRIC_ORDER ? column(entry as LineupMetricId) : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const { metric, format, lineup } = entry as Record<string, unknown>;
  if (typeof metric !== "string" || !(metric in METRIC_ORDER)) return null;
  return column(
    metric as LineupMetricId,
    format === "dynasty" || format === "redraft" ? format : "auto",
    lineup === "oneqb" || lineup === "sf" ? lineup : "auto",
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
