/**
 * The key the trades stream is cached under.
 *
 * **Deliberately outside the manager prefix**, for the reason the ADP board is:
 * this route asks nothing about an account. It describes every crawled league's
 * trades, so it is the same answer whoever is looking at it, and a
 * manager-scoped invalidation has no business throwing it away.
 *
 * Built here rather than at the call site, the rule `managerQueryKeys` exists
 * for: a key that differs by a stray segment is not a shared cache entry, it is
 * a second request that looks like a hit in the code and a miss in the network
 * panel. That matters more here than anywhere else in the app — a miss is the
 * whole season read again.
 *
 * The season is always a segment and never dropped: the page resolves it
 * server-side and passes it down, so there is no "default" case to spell out the
 * way the manager keys have.
 */
export const tradesQueryKeys = {
  all: ["trades"] as const,
  season: (season: string) => ["trades", season] as const,
};
