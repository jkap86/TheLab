/**
 * The comps tool's query keys — built here, never at a call site, the
 * `shared/manager-query` rule.
 *
 * Like the ADP board's keys (`features/shared/adp-query`, whose shape this
 * follows), nothing here is manager-scoped: a comps answer is the same answer
 * whoever asked. The key normalises the query string to parameter pairs
 * **sorted by name with the values kept verbatim** — `fields` and `weights`
 * are parallel comma-joined lists whose order *is* their meaning, so sorting
 * inside a value (or deduplicating, as the shared list parser does) would
 * silently collapse two different boards into one cache entry.
 */

export type NormalizedCompsQuery = readonly (readonly [string, string])[];

export function normalizeCompsQuery(query: string): NormalizedCompsQuery {
  const pairs: [string, string][] = [];
  for (const [name, value] of new URLSearchParams(query)) {
    pairs.push([name, value]);
  }
  // By name only, and stably: a repeated parameter keeps its document order,
  // because order among same-name values is meaning here, not noise.
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs;
}

export const compsQueryKeys = {
  all: ["comps"] as const,
  players: () => [...compsQueryKeys.all, "players"] as const,
  result: (query: string) =>
    [...compsQueryKeys.all, "result", normalizeCompsQuery(query)] as const,
};

/**
 * How long each read is worth reusing. The result sits deliberately *below*
 * the server's 15-minute pool TTL — the house rule that a layer's TTL is
 * shorter than the one it stands in front of, so a stale client read costs a
 * request the server answers warm. The picker list moves when a season's
 * stats land, which is weekly at its fastest.
 */
export const COMPS_STALE_TIMES = {
  result: 5 * 60 * 1000,
  players: 30 * 60 * 1000,
} as const;
