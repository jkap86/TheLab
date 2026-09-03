/**
 * Which stale league the crawler refreshes first.
 *
 * **The queue was strictly oldest-first, which is fair and stops scaling.** The
 * refresh batch retires `CRAWL_LEAGUE_BATCH` leagues a minute, so the in-season
 * 15-minute TTL is a real promise to about 225 leagues and a fiction past that:
 * at a thousand, a rotation is over an hour, and the league somebody has open
 * right now waits behind nine hundred discovered three hops out through a
 * stranger's membership. The corpus grows on its own — that is what the
 * discovery pass is *for* — so this is a problem the crawler creates for itself.
 *
 * The answer here is deliberately modest: the batch size, the tick interval and
 * the seasonal TTLs are all unchanged, and so is the upstream cost. What changes
 * is the *order* within the leagues that are already due, which costs nothing and
 * is the only lever that does.
 *
 * Pure, with the thresholds as constants and the clock as an argument, so the
 * ordering can be reasoned about without a database — and the SQL below is
 * generated from the same table, so the two cannot drift into disagreeing about
 * what a tier is. That matched-pair-with-a-generator shape is what `./adp` and
 * `trades/sql` already do for their own `WHERE` builders.
 */

/**
 * The tiers, best first. The numbers are the `ORDER BY` values, so their
 * ordering is the whole semantics — the names exist so a reader of the SQL can
 * find this table.
 */
export const CRAWL_PRIORITY = {
  /**
   * So far past due that fairness outranks demand.
   *
   * **The bound that makes the rest of this safe.** Without it a database with
   * a steady trickle of reader demand refreshes the same few hundred leagues
   * forever and the cold tail is never revisited at all — which is worse than
   * the round-robin this replaces, because it fails silently: the leagues that
   * stop being crawled are exactly the ones nobody is looking at, so nobody
   * notices they are stale. Past {@link STARVATION_MULTIPLE} TTLs a league
   * outranks everything, and the tier is *ordered by staleness within itself*
   * by the tiebreaker below, so a backlog drains oldest-first.
   */
  starved: 0,
  /** Somebody searched this manager, or opened this league, recently. */
  demanded: 1,
  /** Live: drafting, in season, or in the playoffs — where trades happen. */
  active: 2,
  /** Has been demanded at some point, but not lately. */
  known: 3,
  /** Never demanded by anyone: found by the discovery pass and nothing else. */
  cold: 4,
} as const;

export type CrawlPriority = (typeof CRAWL_PRIORITY)[keyof typeof CRAWL_PRIORITY];

/**
 * How many freshness TTLs a league may be overdue before it outranks demand.
 *
 * Four rather than two, because two is the threshold the scheduler already warns
 * at — the warning means "the batch cannot keep up with the corpus", which is a
 * state the whole queue is in, and a tier that every league enters at once is
 * not a tier. Four keeps the escape hatch clearly *past* the point where the
 * ordering is doing anything at all.
 */
export const STARVATION_MULTIPLE = 4;

/**
 * How recently a league must have been looked at to count as demanded.
 *
 * A session's worth. Long enough that a reader moving between the manager tabs
 * and a league's detail panel keeps that league hot throughout, short enough
 * that yesterday's browsing does not permanently outrank a league somebody is
 * reading now.
 */
export const DEMAND_WINDOW_MS = 30 * 60 * 1000;

/**
 * League statuses that count as live.
 *
 * Sleeper's vocabulary, and the tier is about where *trades and roster moves*
 * happen — which is drafting through the playoffs. `pre_draft` is deliberately
 * out: a league that exists and has not drafted has nothing to mirror yet, and
 * it is the single most common status in the offseason, so including it would
 * make the tier mean nothing.
 */
export const ACTIVE_LEAGUE_STATUSES: readonly string[] = [
  "drafting",
  "in_season",
  "post_season",
];

/** What the ordering reads off a league row. */
export type CrawlCandidate = {
  /** When its graph was last persisted — the freshness signal. */
  updatedAt: number;
  /** When anyone last asked for it, or null if nobody has. */
  lastAccessedAt: number | null;
  status: string | null;
  /** When the crawler last *tried* it — the tiebreaker within a tier. */
  syncAttemptAt: number | null;
};

/** Everything the tiers are measured against. */
export type CrawlClock = {
  now: number;
  /** The tick's freshness TTL — seasonal, see `./crawl-ttl`. */
  ttlMs: number;
};

/**
 * Which tier a league is in. Lower is crawled first.
 *
 * The arms are checked in order and the first one wins, which is the same thing
 * the generated `CASE` does — so a league that is both starved and demanded is
 * starved, and one that is both demanded and active is demanded.
 */
export function leagueRefreshPriority(
  league: CrawlCandidate,
  { now, ttlMs }: CrawlClock,
): CrawlPriority {
  if (league.updatedAt < now - ttlMs * STARVATION_MULTIPLE) {
    return CRAWL_PRIORITY.starved;
  }
  if (
    league.lastAccessedAt !== null &&
    league.lastAccessedAt > now - DEMAND_WINDOW_MS
  ) {
    return CRAWL_PRIORITY.demanded;
  }
  if (league.status !== null && ACTIVE_LEAGUE_STATUSES.includes(league.status)) {
    return CRAWL_PRIORITY.active;
  }
  return league.lastAccessedAt !== null
    ? CRAWL_PRIORITY.known
    : CRAWL_PRIORITY.cold;
}

/**
 * Whether a league is work the crawler should claim *right now* — the claim
 * query's `WHERE`, as a function.
 *
 * **Two questions, and only one of them is about freshness.** `updated_at`
 * decides whether the graph needs refreshing at all; `sync_attempt_at` decides
 * how often the answer may be asked for. Reading only the first is what made a
 * league that cannot sync a permanent occupant of the batch: its graph is stale
 * by definition, so it was due on every tick, and the tier ordering only rotated
 * it behind neighbours that happened to share its tier. Alone in the starved
 * tier it was simply claimed every minute, forever.
 *
 * The throttle is the freshness TTL itself rather than a window of its own, so
 * the ordinary case is untouched by construction: a league claimed at T and
 * refreshed successfully has both timestamps at T and both conditions turn true
 * together at T + ttl. What changes is only the league that *failed* — it now
 * waits a TTL like everyone else instead of taking a slot and a Sleeper request
 * every tick — which is also what makes {@link NEVER_REFRESHED_SQL} safe to
 * write: a graph that has never synced can say so without the crawler spinning
 * on it.
 */
export function isLeagueRefreshDue(
  league: Pick<CrawlCandidate, "updatedAt" | "syncAttemptAt">,
  { now, ttlMs }: CrawlClock,
): boolean {
  if (league.updatedAt >= now - ttlMs) return false;
  return league.syncAttemptAt === null || league.syncAttemptAt < now - ttlMs;
}

/**
 * The comparator the claim query's `ORDER BY` spells: tier, then longest since
 * the crawler last tried it.
 *
 * The tiebreaker stays `sync_attempt_at` — the column the un-prioritised queue
 * already ordered by — and keeps its meaning: a league whose fetch keeps failing
 * rotates to the back of *its own tier* rather than being retried every tick
 * ahead of its neighbours. A never-attempted league sorts first within its tier,
 * which is `NULLS FIRST`.
 */
export function compareLeagueRefresh(
  a: CrawlCandidate,
  b: CrawlCandidate,
  clock: CrawlClock,
): number {
  const byTier =
    leagueRefreshPriority(a, clock) - leagueRefreshPriority(b, clock);
  if (byTier !== 0) return byTier;
  const left = a.syncAttemptAt ?? -Infinity;
  const right = b.syncAttemptAt ?? -Infinity;
  return left - right;
}

/**
 * The claim query, as SQL.
 *
 * Written here rather than in `./crawl-queue` because the tiers above are what
 * it spells, and two copies of a five-armed `CASE` is two chances for one of them
 * to mean something different from the other. The queue module keeps everything
 * else it has: this is still one `UPDATE … RETURNING` that claims and stamps in
 * a single statement, so two ticks — or two app instances behind the crawl's
 * advisory lock — can never pick the same leagues, and a tick that dies
 * mid-flight rotates its batch to the back rather than retrying it immediately.
 *
 * Parameters, in order: season, freshness interval, starvation interval, demand
 * window interval, batch limit. Every one is bound; nothing is spliced. The
 * freshness interval is read twice — once as freshness and once as the retry
 * throttle, which {@link isLeagueRefreshDue} has the argument for.
 */
export function staleLeagueClaimSql(): string {
  const active = ACTIVE_LEAGUE_STATUSES.map((s) => `'${s}'`).join(", ");
  return `UPDATE leagues
        SET sync_attempt_at = now()
      WHERE league_id IN (
              SELECT league_id
                FROM leagues
               WHERE season = $1 AND updated_at < now() - $2::interval
                 AND gone_at IS NULL
                 AND (sync_attempt_at IS NULL
                      OR sync_attempt_at < now() - $2::interval)
               ORDER BY CASE
                          WHEN updated_at < now() - $3::interval
                            THEN ${CRAWL_PRIORITY.starved}
                          WHEN last_accessed_at IS NOT NULL
                           AND last_accessed_at > now() - $4::interval
                            THEN ${CRAWL_PRIORITY.demanded}
                          WHEN status IN (${active})
                            THEN ${CRAWL_PRIORITY.active}
                          WHEN last_accessed_at IS NOT NULL
                            THEN ${CRAWL_PRIORITY.known}
                          ELSE ${CRAWL_PRIORITY.cold}
                        END,
                        sync_attempt_at ASC NULLS FIRST
               LIMIT $5
            )
      RETURNING league_id`;
}

/** How far past due a league has to be to reach {@link CRAWL_PRIORITY.starved}. */
export const starvationMs = (ttlMs: number): number =>
  ttlMs * STARVATION_MULTIPLE;
