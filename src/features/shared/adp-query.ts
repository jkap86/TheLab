/**
 * The global ADP board's own query keys — not manager-scoped, and not scoped
 * to any other feature either.
 *
 * `/api/adp` describes every draft this app has crawled, narrowed by
 * settings: the same board is the same answer whoever asked for it, so it
 * lives beside no feature's own cache prefix (`manager(searched)` in the
 * manager tool, nothing comparable in trades) and both readers — the manager
 * tool's Players tab and drawer, the trades page's own trigger — land on one
 * cache entry for the same filters.
 */

/**
 * An `/api/adp` query string reduced to its meaning: every parameter as a
 * `[name, value]` pair, sorted by name.
 *
 * Two consumers can assemble the same filters in a different parameter order
 * (or repeat one, which a query string allows and a plain object would
 * silently collapse to its last value), so the key normalises rather than
 * hashing the raw string — that is what keeps them landing on one cache entry
 * instead of two.
 */
export type NormalizedAdpQuery = readonly (readonly [string, string])[];

export function normalizeAdpQuery(query: string): NormalizedAdpQuery {
  const pairs: [string, string][] = [];
  for (const [name, value] of new URLSearchParams(query)) pairs.push([name, value]);
  pairs.sort((a, b) => (a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])));
  return pairs;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const boardQueryKeys = {
  all: ["adp"] as const,
  adp: (query: string) => [...boardQueryKeys.all, "board", normalizeAdpQuery(query)] as const,
  density: () => [...boardQueryKeys.all, "density"] as const,
};

/** How long the board and its density strip are worth reusing, client-side. */
export const ADP_STALE_TIMES = {
  /** The board itself: an average over thousands of crawled drafts. */
  board: 15 * 60 * 1000,
  /** The density strip: a month-grain histogram of the same drafts. */
  density: 30 * 60 * 1000,
} as const;
