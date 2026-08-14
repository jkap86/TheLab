/**
 * The keys the trades board is cached under.
 *
 * **Deliberately outside the manager prefix**, for the reason the ADP board is:
 * this route asks nothing about an account. It describes every crawled league's
 * trades, so it is the same answer whoever is looking at it, and a
 * manager-scoped invalidation has no business throwing it away.
 *
 * Built here rather than at the call site, the rule `managerQueryKeys` exists
 * for: a key that differs by a stray segment is not a shared cache entry, it is
 * a second request that looks like a hit in the code and a miss in the network
 * panel.
 *
 * The board's key carries the **normalised query string** rather than the filter
 * objects, which is what `tradeQueryKey` is for. React Query hashes keys
 * structurally, so two objects describing the same request would be two entries;
 * two query strings describing it are one. That matters more here than anywhere
 * else in the app — a miss is a fresh first page and a lost scroll
 * position.
 */
export const tradesQueryKeys = {
  all: ["trades"] as const,
  /** One paginated board: season and filters, as a normalised query string. */
  board: (query: string) => ["trades", "board", query] as const,
  /** The season's leagues — the league rules' input, and every card's name. */
  leagues: (season: string) => ["trades", "leagues", season] as const,
  /**
   * The search panel's menus, keyed on the league scope and window *without* the
   * selection — pressing a checkbox cannot change them, so a key that moved with
   * the selection would re-run a season-wide aggregate for an unchanged answer.
   */
  facets: (query: string) => ["trades", "facets", query] as const,
  /**
   * One trade's pre-trade rosters, keyed on the trade alone.
   *
   * **No board, no season, no filters in it**, unlike every other key here: the
   * answer is a fact about one stored trade, so it is the same answer whichever
   * board the card was pressed on. Folding the query string in would give the
   * same snapshot a fresh entry every time a filter moved, and re-fetch it on the
   * press after — for an answer that cannot have changed.
   */
  rosters: (transactionId: string) =>
    ["trades", "rosters", transactionId] as const,
  // The timeline's key is **not** here, and that is the mover's rule rather than
  // an omission: the leagues list draws the same rail off the same payload, so
  // the entry stopped being a trades answer and lives in
  // `features/shared/timeline-query` under a prefix of its own. Adding a second
  // spelling back here would be two cache entries for one question.
};
