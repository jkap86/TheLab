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
 * How long each read is worth reusing. Both sit deliberately *below* the
 * server's own TTLs — the house rule that a layer's window is shorter than the
 * one it stands in front of, so a stale client read costs a request the server
 * answers warm (`features/shared/cache-layering.test.ts` asserts the ordering
 * across the seam, since neither side can import the other).
 *
 * The picker list moves when a season's stats land, which is weekly at its
 * fastest — but the ceiling is the other half of that rule rather than the
 * rate underneath: **a browser entry fresh for half an hour is not a cache, it
 * is a snapshot.** It was that, on the reasoning that the list rarely changes;
 * fifteen minutes revalidates against a server entry three times its length,
 * which is the layering this file's own comment claimed and did not have.
 */
export const COMPS_STALE_TIMES = {
  result: 5 * 60 * 1000,
  players: 15 * 60 * 1000,
} as const;
