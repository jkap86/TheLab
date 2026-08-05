/**
 * Which NFL season the app is operating in.
 *
 * It was a constant — `DEFAULT_SEASON = "2026"` — read by the crawler, the
 * projections sync and every route that defaults a season. That is a release
 * note disguised as a string: the day Sleeper rolls the league year over, an
 * un-redeployed app keeps crawling last season's leagues, keeps averaging last
 * season's drafts, and looks like it has stopped working rather than like it
 * needs a deploy.
 *
 * So the season is *resolved*: an operator override, else Sleeper's own
 * `state/nfl`, else the compiled-in fallback. Three rules make that safe to put
 * in front of every request:
 *
 *   - **An outage must not be an outage here.** A failed state call falls back
 *     to the last value this process resolved, and only then to the constant.
 *     The app answers with a season, always.
 *   - **A cached value outlives its TTL when nothing better exists.** The TTL
 *     says when to *try again*, not when to stop trusting what we have — a stale
 *     season is a far better answer than none, and it changes once a year.
 *   - **An explicitly requested season never comes here.** `?season=2024` is the
 *     caller's answer; this only fills the blank. Historical routes stay
 *     deterministic.
 *
 * **A request never waits on Sleeper for a value this process can already
 * answer**, which is the rule the three above imply and the first version did
 * not keep. It sat in front of every defaulted read, so a stale cache meant the
 * *request* paid the state call — and behind the shared axios instance that is
 * up to four attempts with backoff, ~141s, to re-learn a string that changes
 * once a year while Postgres was ready to answer the whole query. So a stale
 * value is served immediately and the refresh runs behind it: the rollover is
 * picked up by the request *after* the TTL rather than by the one that found it
 * expired, which for a once-a-year change is a distinction with no reader.
 *
 * A cold process still waits, because there is nothing to serve and the
 * compiled-in constant is exactly the release note this exists to stop trusting.
 * What bounds *that* is {@link SeasonResolverOptions.failureBackoffMs}: a failed
 * attempt is remembered for a minute, so an upstream that is down costs one
 * timeout ladder rather than one per request. It is short on purpose — the point
 * of not re-stamping the cache on failure is that recovery doesn't wait out a
 * six-hour TTL nothing earned, and a minute is still that promise kept.
 *
 * Pure: the state fetch and the clock arrive as arguments, so the cache and the
 * fallback ladder are testable without a network or a timer.
 */

/** A season Sleeper could plausibly report: a 4-digit year in a sane range. */
export function isPlausibleSeason(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return false;
  const year = Number(value);
  return year >= 2000 && year <= 2100;
}

export type SeasonState = { season?: string | null } | null;

export type SeasonResolverOptions = {
  /** Reads Sleeper's NFL state. Failures are caught, not propagated. */
  fetchState: () => Promise<SeasonState>;
  /** The compiled-in season, used when nothing else can answer. */
  fallback: string;
  /** The operator override, read fresh each call so it can be set without a restart. */
  override?: () => string | undefined | null;
  now?: () => number;
  ttlMs?: number;
  /**
   * How long a *failed* attempt is remembered before another is made.
   *
   * Only a cold resolver can be made to wait by an outage — a warm one serves
   * its stale value and refreshes behind the request — so this is what keeps
   * that one case from costing every request a full timeout ladder. Far shorter
   * than the TTL, because a failure earns no freshness: it is a rate limit on
   * retrying, not a claim that the answer is current.
   */
  failureBackoffMs?: number;
};

export type SeasonResolver = {
  resolve: () => Promise<string>;
  /** The cached value and when it was resolved; null before the first success. */
  peek: () => { season: string; at: number } | null;
  /** Drop the cache — for tests and for an operator-triggered re-read. */
  reset: () => void;
};

/**
 * How long a resolved season is reused before Sleeper is asked again.
 *
 * Long, because the answer changes once a year and the cost of being an hour
 * late to a rollover is nil. Short enough that a rollover is picked up the same
 * day without a deploy, which is the whole point.
 */
export const SEASON_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * How long a failed state call is remembered — see
 * {@link SeasonResolverOptions.failureBackoffMs}. A minute: long enough that a
 * down upstream isn't re-dialled per request, short enough that nobody notices
 * the recovery.
 */
export const SEASON_FAILURE_BACKOFF_MS = 60 * 1000;

export function createSeasonResolver(
  options: SeasonResolverOptions,
): SeasonResolver {
  const {
    fetchState,
    fallback,
    override,
    now = Date.now,
    ttlMs = SEASON_TTL_MS,
    failureBackoffMs = SEASON_FAILURE_BACKOFF_MS,
  } = options;

  let cached: { season: string; at: number } | null = null;
  /** When the last attempt failed, for the backoff above; null once one works. */
  let failedAt: number | null = null;
  /** De-duplicates concurrent refreshes: one state call, not one per request. */
  let inFlight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    try {
      const state = await fetchState();
      const season = state?.season;
      if (isPlausibleSeason(season)) {
        cached = { season, at: now() };
        failedAt = null;
        return season;
      }
      console.warn(
        `[season] Sleeper reported an implausible season (${String(season)}); ` +
          `keeping ${cached?.season ?? fallback}.`,
      );
    } catch (error) {
      console.warn(
        `[season] NFL state unavailable; keeping ${cached?.season ?? fallback}:`,
        error instanceof Error ? error.message : error,
      );
    }
    // The *cache* is deliberately not re-stamped: a failed attempt leaves it as
    // stale as it was, so recovery doesn't wait out a TTL that was never earned.
    // Same rule as the projections gate stamping the *fetch*. What is stamped is
    // the failure, which only rate-limits the retry.
    failedAt = now();
    return cached?.season ?? fallback;
  }

  /** One refresh at a time: concurrent callers share the state call. */
  function startRefresh(): Promise<string> {
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  const retrying = () =>
    failedAt === null || now() - failedAt >= failureBackoffMs;

  return {
    async resolve() {
      const forced = override?.();
      if (forced) {
        if (isPlausibleSeason(forced)) return forced;
        console.warn(
          `[season] Ignoring an implausible season override ("${forced}").`,
        );
      }

      if (cached && now() - cached.at < ttlMs) return cached.season;

      if (cached) {
        // Stale but usable, so the request is answered from it and the refresh
        // runs behind: nobody waits on Sleeper for a value we hold. Caught
        // because this one is unawaited — `refresh` handles its own failures, so
        // this can only fire if that ever stops being true, and an unhandled
        // rejection in a background task takes the process with it.
        if (retrying()) void startRefresh().catch(() => {});
        return cached.season;
      }

      // Nothing to serve. Waiting is right here — the compiled-in fallback is
      // the release note this module exists to stop trusting, so a cold process
      // should learn the real season before answering. Unless the upstream just
      // failed, in which case it has already told us what waiting would buy.
      if (!retrying()) return fallback;
      return startRefresh();
    },
    peek: () => cached,
    reset: () => {
      cached = null;
      failedAt = null;
      inFlight = null;
    },
  };
}
