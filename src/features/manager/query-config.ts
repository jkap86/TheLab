/**
 * How long each of the manager area's answers is worth reusing.
 *
 * The server already caches the expensive half of all of this in Postgres —
 * that is what protects Sleeper, KTC and the projections host, and none of it
 * changes here. What was missing is one layer out: the three manager tabs are
 * three routes, so switching between them unmounted every hook and re-asked the
 * browser's questions from scratch. These are how long the *browser* reuses an
 * answer it already has, and they are deliberately shorter than the server's own
 * TTLs — a stale client read costs a request the server answers from its cache,
 * where a stale server read costs a fetch to somebody else.
 *
 * They are set per query rather than as one global default because the resources
 * move at genuinely different speeds — the same rule the background loops follow
 * (a slice's TTL should match how fast *that slice* moves). The client-wide
 * defaults, `gcTime` among them, are in `features/shared/query-client`.
 */
export const STALE_TIMES = {
  /**
   * The leagues stream. Five minutes against the server's ten-minute
   * `SYNC_TTL_MS`: the point is not to re-decide freshness — the route does
   * that, and answers from its own cache when it is still fresh — but to stop
   * three tab navigations in a minute opening three streams.
   */
  leagues: 5 * 60 * 1000,
  /** The manager's rosters, and the players cache resolved alongside them. */
  players: 10 * 60 * 1000,
  /** Who they share leagues with — membership changes at the season's pace. */
  leaguemates: 10 * 60 * 1000,
  /** Projected ranks: a projections slice can move hourly, so the shortest. */
  ranks: 5 * 60 * 1000,
  /** KTC values: the scrape behind them refreshes on the order of a day. */
  ktc: 15 * 60 * 1000,
  /** ADP valuation, per curve — the crawled board behind it moves slowly. */
  adpValue: 15 * 60 * 1000,
  /** The global ADP board: an average over thousands of crawled drafts. */
  adp: 15 * 60 * 1000,
  /** The density strip: a month-grain histogram of the same drafts. */
  adpDensity: 30 * 60 * 1000,
  /** One league's standings and rosters, behind an expanded card. */
  leagueDetail: 5 * 60 * 1000,
  /** Kickoff: an instant that is fixed once Sleeper has scheduled the season. */
  kickoff: 60 * 60 * 1000,
} as const;
