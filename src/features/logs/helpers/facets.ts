import type { VisitorLogEntry } from "@/shared/contract";

import { deriveVisit } from "./derive-visit.ts";

/**
 * Narrowing the visit list, and building the menus that narrow it.
 *
 * Pure and tested, because the rule below is the kind that is invisible when
 * wrong — the list still renders, it just answers a different question.
 */

/** A row as the page holds it: what was stored, plus what the route says. */
export type LogRow = VisitorLogEntry & {
  tool: string;
  subject: string | null;
};

export const FACET_KEYS = ["tool", "viewer", "subject", "ip"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

/** An empty string is "not filtered", which is the value a `<select>` starts on. */
export type LogFilters = Record<FacetKey, string>;

export const NO_FILTERS: LogFilters = {
  tool: "",
  viewer: "",
  subject: "",
  ip: "",
};

export const hasFilters = (filters: LogFilters): boolean =>
  FACET_KEYS.some((key) => filters[key] !== "");

export const toLogRow = (entry: VisitorLogEntry): LogRow => ({
  ...entry,
  ...deriveVisit(entry.route),
});

/** What a row answers for one facet, or null where it has no answer. */
function valueOf(row: LogRow, key: FacetKey): string | null {
  switch (key) {
    case "tool":
      return row.tool || null;
    case "viewer":
      return row.viewer;
    case "subject":
      return row.subject;
    case "ip":
      return row.ip;
  }
}

/**
 * Whether a row survives every facet except `except`.
 *
 * `except` is what makes the menus honest — see {@link facetOptions}. Passing
 * null applies all four, which is the list the page actually renders.
 */
export function matches(
  row: LogRow,
  filters: LogFilters,
  except: FacetKey | null = null,
): boolean {
  return FACET_KEYS.every((key) => {
    if (key === except) return true;
    const wanted = filters[key];
    return wanted === "" || valueOf(row, key) === wanted;
  });
}

/** Free-text search across everything a row shows. */
export function matchesQuery(row: LogRow, needle: string): boolean {
  if (!needle) return true;
  return [row.route, row.ip, row.viewer].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

/**
 * The options each facet's menu offers.
 *
 * **Each facet is built from the rows filtered by every *other* facet, and not
 * by itself.** The app this was ported from derives all five of its menus from
 * the fully-filtered list, so choosing an IP leaves that IP as the only option
 * in the IP menu: the selection cannot be changed, only cleared, and the same
 * goes for every other facet in turn. That is exactly the failure this repo's
 * own `facetsQuery` rule names for the trades board — count the menus *without*
 * the selection — and this is that rule applied to a list held in the browser.
 *
 * A currently-selected value is kept even if nothing else matches it, so a
 * `<select>` can never be showing a value its own options do not contain.
 */
export function facetOptions(
  rows: readonly LogRow[],
  filters: LogFilters,
  needle = "",
): Record<FacetKey, string[]> {
  const found: Record<FacetKey, Set<string>> = {
    tool: new Set(),
    viewer: new Set(),
    subject: new Set(),
    ip: new Set(),
  };

  for (const key of FACET_KEYS) {
    if (filters[key]) found[key].add(filters[key]);
    for (const row of rows) {
      if (!matchesQuery(row, needle)) continue;
      if (!matches(row, filters, key)) continue;
      const value = valueOf(row, key);
      if (value) found[key].add(value);
    }
  }

  return {
    tool: [...found.tool].sort(),
    viewer: [...found.viewer].sort(),
    subject: [...found.subject].sort(),
    // Addresses sort as text, which puts 10.0.0.9 after 10.0.0.10. Numerically
    // is what a reader scanning a column of them expects.
    ip: [...found.ip].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
  };
}

/** The four numbers the readouts above the table show. */
export function totals(rows: readonly LogRow[]) {
  const ips = new Set<string>();
  const viewers = new Set<string>();
  const subjects = new Set<string>();
  for (const row of rows) {
    if (row.ip) ips.add(row.ip);
    if (row.viewer) viewers.add(row.viewer);
    if (row.subject) subjects.add(row.subject);
  }
  return {
    visits: rows.length,
    ips: ips.size,
    viewers: viewers.size,
    subjects: subjects.size,
  };
}
