/**
 * Where `/api/kickoff` is filed in the browser cache, and how long it is worth
 * reusing.
 *
 * Its own module rather than the hook's, for the reason `adp-query` is separate
 * from `use-adp`: this is pure, so the key's shape can be asserted without a
 * renderer or a fetch behind it, where the hook is a `"use client"` module that
 * pulls in React Query.
 *
 * **Outside every manager prefix**, deliberately. The instant is a fact about a
 * *season*, not about whoever is being looked at — two managers read the same
 * one — so a manager-wide invalidation has no business throwing it away. It used
 * to live in the manager tool's own `query-keys`, which was true only while that
 * tool was the only thing drawing a countdown; the lineup checker wears the same
 * plate now, and `features/manager/query-keys.ts` re-exports it from here.
 */

/** `/api/kickoff` — the header countdown's instant, per season. */
export const scheduleQueryKeys = {
  kickoff: (season: string) => ["kickoff", season] as const,
};

/**
 * An hour: the instant is fixed once Sleeper has scheduled the season, so what
 * this TTL actually bounds is how long a *null* answer — a season not scheduled
 * yet — is believed. It is the same reasoning `/api/kickoff`'s own read-through
 * cache follows one layer down.
 */
export const KICKOFF_STALE_TIME = 60 * 60 * 1000;
