"use client";

import { useMemo } from "react";

import type { LineupMetricId } from "@/shared/contract";

import { useLocalValue, writeLocal } from "./local-store";

// Which rank columns the league cards show, remembered on the device. The
// storage mechanics live in `local-store.ts`; what is here is only what this
// key holds and the rules that keep it honest.
//
// The selection is a *set*, not an arrangement: columns always render in
// canonical metric order, so `normalize` sorts on write and read alike and a
// hand-edited or stale stored value cannot invent an ordering the UI never
// offered. It lives in `features/shared` because the metric-id list is the
// client half of the contract's compiler seam (see `LineupMetricId`) and the
// wrapper-over-`local-store` pattern is this folder's to own — `account.ts` is
// the template.
const STORAGE_KEY = "thelab:lineup-columns";

/**
 * The most columns a card can carry before the grid stops reading.
 *
 * **Unmoved by the KTC metrics arriving**, deliberately: the cap is about how
 * much a card's tile row can hold at 390px — four tiles is already two rows of
 * two on a phone — not about how many lenses exist to choose between. Nine
 * options and four slots is the picker doing its job.
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
 * The four columns a first visit shows.
 *
 * Unchanged by the KTC metrics, so nobody's stored selection moves and a reader
 * who never opens the picker sees the page they had. The KTC columns are opt-in
 * because the market they read is a preference — see `ktc-board.ts`.
 */
export const DEFAULT_LINEUP_COLUMNS: readonly LineupMetricId[] = [
  "ros_starters",
  "ros_bench",
  "capital_total",
  "capital_bench",
];

/**
 * Fold anything — a toggle's draft, a stored string's parse — into a valid
 * selection: known ids only, deduped, canonical order, capped, and never
 * empty. Applied on write *and* read so the two ends cannot disagree about
 * what a valid selection is.
 */
function normalize(ids: unknown): readonly LineupMetricId[] {
  if (!Array.isArray(ids)) return DEFAULT_LINEUP_COLUMNS;
  const known = [
    ...new Set(
      ids.filter((id): id is LineupMetricId => typeof id === "string" && id in METRIC_ORDER),
    ),
  ];
  if (known.length === 0) return DEFAULT_LINEUP_COLUMNS;
  return known
    .sort((a, b) => METRIC_ORDER[a] - METRIC_ORDER[b])
    .slice(0, MAX_LINEUP_COLUMNS);
}

/** Persist the chosen columns (normalized, see above) and notify readers. */
export function storeLineupColumns(ids: readonly LineupMetricId[]) {
  writeLocal(STORAGE_KEY, JSON.stringify(normalize(ids)));
}

/**
 * The chosen columns — the defaults on the server, on the first client render,
 * and wherever nothing valid is stored (the documented `local-store` trade: a
 * stored choice swaps in after hydration).
 */
export function useLineupColumns(): readonly LineupMetricId[] {
  const raw = useLocalValue(STORAGE_KEY);
  // Parsed in a memo keyed on the raw string, per the store's contract.
  return useMemo(() => {
    if (!raw) return DEFAULT_LINEUP_COLUMNS;
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return DEFAULT_LINEUP_COLUMNS;
    }
  }, [raw]);
}
