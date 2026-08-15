// Relative pure→pure import, the usual test-runner spelling.
import { COMPS_FIELDS } from "../../shared/comps/fields.ts";
import { compsDimensionLabel } from "../../shared/comps/windows.ts";
import { draftPickLabel } from "../../shared/nfl-draft/capital.ts";

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
 *
 * A field weighted over a *window* is not the same row as that field on the
 * line: the line is always the anchor season, and "targets over the last three
 * years" is a different number that happens to share a name. So the line row
 * stays unweighted where it stands and the window rides in beside the other
 * extras, labelled with the stretch it covers — the two agreeing would be the
 * lie, since only one of them is what the distance read.
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

  // The weighted dimensions the line has no row for — age, the market values,
  // and every windowed field — read off `values`, where the route put exactly
  // the weighted ones under these same keys.
  for (const field of fields) {
    if (field.key in subject.line || field.key in POINTS_LABELS) continue;
    rows.push({
      key: field.key,
      label: compsDimensionLabel(field.key),
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

/**
 * How a row's NFL draft position reads — `Drafted 1.05`, or `Undrafted`.
 *
 * Three answers folded into two renderings and one absence, which is the whole
 * of what this function is for:
 *
 * - **Drafted** — the pick, spoken the way picks are spoken (`1.05`), with the
 *   class and the long form on the hover where they cost no width.
 * - **Undrafted** — said out loud, because on a comps row it is a *finding*
 *   rather than a gap: a reader looking at an undrafted breakout is looking at
 *   the thing that makes the comp interesting.
 * - **Unknown** — null, drawn as nothing at all. Never "Undrafted", which is
 *   the one wrong answer here that would read as a working one; the app has no
 *   draft record for a chunk of the archive seasons, and labelling those
 *   players undrafted would invent a fact about every one of them.
 *
 * The class is not folded into the short form on purpose: the row already
 * carries a season (the *stat* season), and two four-digit years a few pixels
 * apart meaning different things is worse than one on a hover.
 */
export function draftSummary(
  row: CompsSeasonRowPayload,
): { short: string; full: string } | null {
  const draft = row.draft;
  if (!draft) return null;

  const label = draftPickLabel({ playerId: row.player_id, ...draft });
  if (label === null) return null;

  if (draft.overall === null) {
    return {
      short: "Undrafted",
      full: `Went undrafted in ${draft.season}`,
    };
  }

  const place =
    draft.round !== null && draft.slot !== null
      ? `Round ${draft.round}, pick ${draft.slot}`
      : draft.round !== null
        ? `Round ${draft.round}`
        : `Pick ${draft.overall}`;
  return {
    short: `Drafted ${label}`,
    full: `${place} (#${draft.overall} overall) of the ${draft.season} NFL draft`,
  };
}
