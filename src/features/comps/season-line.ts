// Relative pure→pure import, the usual test-runner spelling.
import { COMPS_FIELDS } from "../../shared/comps/fields.ts";

import type { CompsBasis } from "../../shared/comps/filters.ts";
import type {
  CompsFieldSpecPayload,
  CompsSeasonRowPayload,
} from "./types";

/**
 * How a comp's season is read back — the point of the tool. A comp is picked
 * on the weighted criteria; what the reader came for is the outcome those
 * criteria led to, so the expanded card shows the *whole* season side by side
 * with the subject's, weighted or not, and the collapsed row leads with the
 * fantasy points. This module is the selection and naming; the component only
 * draws it.
 */

/** The three point totals the payload's `line` carries beside the stats. */
const POINTS_LABELS: Record<string, string> = {
  pts_ppr: "PPR points",
  pts_half_ppr: "Half-PPR points",
  pts_std: "Standard points",
};

export type SeasonCompareRow = {
  key: string;
  label: string;
  /** The weight that drove the match, or null for a display-only row. */
  weight: number | null;
  /** Whether the number is per-game under the request's basis. */
  perGame: boolean;
  subject: number | null;
  comp: number | null;
  /** The comparison population's mean — weighted fields only. */
  poolMean: number | null;
};

/**
 * The rows of one comp's season-vs-subject table, in a fixed order: the
 * production line (catalogue order), the point totals, then any weighted
 * field the line doesn't carry (age, market values).
 *
 * A production stat neither season touched is dropped — a quarterback
 * comparison doesn't list receiving zeroes — **unless it was weighted**, in
 * which case it stays whatever it says: a field the reader asked to compare
 * on must never silently vanish from the explanation.
 */
export function seasonCompareRows(
  fields: readonly CompsFieldSpecPayload[],
  subject: CompsSeasonRowPayload,
  comp: CompsSeasonRowPayload,
  basis: CompsBasis,
): SeasonCompareRow[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const rows: SeasonCompareRow[] = [];

  const lineRow = (key: string, label: string) => {
    const weighted = byKey.get(key);
    const subjectValue = subject.line[key] ?? null;
    const compValue = comp.line[key] ?? null;
    if (!weighted && !nonzero(subjectValue) && !nonzero(compValue)) return;
    rows.push({
      key,
      label,
      weight: weighted?.weight ?? null,
      perGame: basis === "per_game",
      subject: subjectValue,
      comp: compValue,
      poolMean: weighted?.pool_mean ?? null,
    });
  };

  // Line-read production only: a derived share is not on `line` (it is a rate,
  // not a season total), so it reaches the table through the weighted-extras
  // loop below — a line row here would draw an empty duplicate beside it.
  for (const field of COMPS_FIELDS) {
    if (field.family === "production" && field.derived !== true) {
      lineRow(field.key, field.label);
    }
  }
  for (const [key, label] of Object.entries(POINTS_LABELS)) {
    lineRow(key, label);
  }

  // The weighted fields the line has no row for — age and the market values —
  // read off `values`, where the route put exactly the weighted ones.
  for (const field of fields) {
    if (field.key in subject.line || field.key in POINTS_LABELS) continue;
    rows.push({
      key: field.key,
      label: field.label,
      weight: field.weight,
      perGame: field.per_game && basis === "per_game",
      subject: subject.values[field.key] ?? null,
      comp: comp.values[field.key] ?? null,
      poolMean: field.pool_mean,
    });
  }

  return rows;
}

/**
 * The collapsed row's outcome: the season's PPR points under the basis on
 * screen — "265.4 PPR pts", or "16.8 PPR/g". Null where there is nothing
 * honest to say (a zero-game season read per game).
 */
export function pointsSummary(
  row: CompsSeasonRowPayload,
  basis: CompsBasis,
): string | null {
  const points = row.line.pts_ppr;
  if (points === null || points === undefined) return null;
  const value = points.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return basis === "per_game" ? `${value} PPR/g` : `${value} PPR pts`;
}

const nonzero = (value: number | null): boolean =>
  value !== null && value !== 0;
