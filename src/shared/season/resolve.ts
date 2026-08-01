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

export function createSeasonResolver(
  options: SeasonResolverOptions,
): SeasonResolver {
  const {
    fetchState,
    fallback,
    override,
    now = Date.now,
    ttlMs = SEASON_TTL_MS,
  } = options;

  let cached: { season: string; at: number } | null = null;
  /** De-duplicates concurrent refreshes: one state call, not one per request. */
  let inFlight: Promise<string> | null = null;

  async function refresh(): Promise<string> {
    try {
      const state = await fetchState();
      const season = state?.season;
      if (isPlausibleSeason(season)) {
        cached = { season, at: now() };
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
    // Deliberately not re-stamped: a failed attempt leaves the cache as stale as
    // it was, so the next caller tries again rather than waiting out a TTL that
    // was never earned. Same rule as the projections gate stamping the *fetch*.
    return cached?.season ?? fallback;
  }

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
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    peek: () => cached,
    reset: () => {
      cached = null;
      inFlight = null;
    },
  };
}
