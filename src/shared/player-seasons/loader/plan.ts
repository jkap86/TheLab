/**
 * Which seasons a load may write, and which of them count as finished.
 *
 * **The rule this file exists for is that an in-progress season is not a
 * historical outcome.** Half of 2026 loaded in November looks, to everything
 * downstream, exactly like a completed 2026 in which every receiver caught
 * forty balls and half the league retired: the corpus's own
 * did-not-play rule would read every player who has not yet appeared as gone,
 * and every 2025 row would be scored against a payoff column that is nine
 * games short. So a season is written as a comp season only once it is over,
 * and the loader says so rather than inferring it from a date.
 *
 * Pure, with Sleeper's state as an argument, so both arms are testable without
 * a network: the season that has ended and the one that has not.
 */

/** The three fields of Sleeper's `state/nfl` this reads. */
export type NflSeasonState = {
  season: string;
  season_type: string;
  /**
   * Kickoff of `season`'s regular season, `YYYY-MM-DD`. Undocumented and not
   * promised present — `manager/crawl-ttl` says the same — so this falls back
   * to the conservative reading when it is absent or unparseable.
   */
  season_start_date?: string | null;
};

/** What a load was asked to do, before it is checked against the state. */
export type CompsLoadRequest = {
  /** The earliest season to load. Null means {@link EARLIEST_SEASON}. */
  from: number | null;
  /** The latest season to load. Null means the latest complete one. */
  to: number | null;
  /**
   * The exact seasons to load, where the caller already knows which — the boot
   * loop, which asks `./refresh` what the corpus is missing and gets a list
   * back rather than a span.
   *
   * It **wins over `from`/`to`** when non-empty, and it is a list rather than
   * a narrower span for the case that makes the difference: a corpus missing
   * 2019 and 2025 and holding everything between is one gap and one top-up,
   * where the span covering both would re-fetch six seasons that are already
   * on file. Every entry is still checked against the state one at a time, so
   * a list carrying an unfinished season is refused by name exactly as a span
   * running past one is.
   */
  seasons?: readonly number[] | null;
};

export type CompsLoadPlan = {
  /** The seasons to fetch and write, ascending. */
  seasons: number[];
  /** The latest season this load treats as a complete historical outcome. */
  maxCompletedSeason: number;
  /**
   * A season the request named and the plan refused, with why. Reported rather
   * than silently dropped: "I asked for 2026 and got 2018–2025" is a question
   * the operator should have answered on the console.
   */
  refused: { season: number; reason: string }[];
};

/**
 * The earliest season a load defaults to.
 *
 * Not a hard floor — an operator may ask for an earlier one — but the default
 * span of a corpus that has to be fetched a week at a time. Eight seasons is
 * enough for a career arc to appear more than once in it and short enough that
 * a first load is minutes rather than an afternoon.
 */
export const EARLIEST_SEASON = 2018;

/** The last week of the NFL regular season. Stat rows past it are postseason. */
export const LAST_REGULAR_WEEK = 18;

/**
 * The latest season whose outcomes are knowable, from Sleeper's own state.
 *
 * **The season before the one Sleeper names is finished; the one it names
 * usually is not.** That is the whole rule, and it is conservative on purpose:
 * `state.season` is the season Sleeper is *working on*, and it rolls over to
 * the upcoming year long before that year is played — in the spring, while
 * `season_type` is still `"off"`. Reading `"off"` as "the named season is
 * over" therefore gets it backwards for most of the calendar and would write
 * a season nobody has played as a completed historical outcome, which is the
 * one failure this function exists to prevent.
 *
 * The one case where the named season *is* finished is the short window
 * between the end of a season and Sleeper rolling its year forward: `"off"`
 * with a `season_start_date` already in the past. That field is undocumented
 * and unpromised — `manager/crawl-ttl` says so and falls back for the same
 * reason — so it is read where it parses and ignored where it does not, and
 * ignoring it costs the corpus a few weeks of lag rather than a wrong season.
 *
 * `"post"` is deliberately not enough on its own. The playoffs are not in a
 * regular season's stats and a corpus loaded during them would be complete by
 * accident rather than by rule.
 *
 * An unreadable season falls all the way to the safe side: nothing is
 * complete, every requested season is refused by name, and the operator reads
 * why on the console.
 */
export function latestCompleteSeason(
  state: NflSeasonState,
  now: number = Date.now(),
): number {
  const season = Number(state.season);
  if (!Number.isInteger(season) || season < 1900) return 0;

  const type = state.season_type?.trim().toLowerCase();
  if (type === "off" && hasKickedOff(state.season_start_date, now)) return season;
  return season - 1;
}

/** Whether `season_start_date` names an instant already past. */
function hasKickedOff(startDate: string | null | undefined, now: number): boolean {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}/.test(startDate)) return false;
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(start) && start <= now;
}

/**
 * The season Sleeper's players map is current *as of* — the baseline
 * `years_exp` is measured against.
 *
 * Sleeper's `years_exp` counts seasons entering the year it is looking at, so
 * experience at a past season is it less the years since **that** year, not
 * less the years since the last complete one. Off by one, a corpus would call
 * every veteran a year younger in the league than he was, on the reading that
 * only fires where `rookie_year` is missing — which is exactly where nothing
 * else would catch it.
 */
export function playersMapSeason(state: NflSeasonState, fallback: number): number {
  const season = Number(state.season);
  return Number.isInteger(season) && season >= 1900 ? season : fallback;
}

/**
 * The seasons to load, given what was asked for and what has finished.
 *
 * Every refusal is named. A request past the latest complete season is refused
 * one season at a time rather than clamped silently, which is the difference
 * between a console line an operator reads and a corpus that quietly stops one
 * year short of what they asked for.
 */
export function planLoad(
  request: CompsLoadRequest,
  latestComplete: number,
): CompsLoadPlan {
  const refused: { season: number; reason: string }[] = [];
  const asked = requestedSeasons(request, latestComplete);
  if (asked === null) {
    return { seasons: [], maxCompletedSeason: latestComplete, refused };
  }

  const seasons: number[] = [];
  for (const season of asked) {
    if (season > latestComplete) {
      refused.push({
        season,
        reason:
          latestComplete === 0
            ? "the NFL state could not be read, so no season is known to be complete"
            : `${season} is not a completed season (latest complete: ${latestComplete})`,
      });
      continue;
    }
    seasons.push(season);
  }

  return { seasons, maxCompletedSeason: latestComplete, refused };
}

/**
 * The seasons a request names, ascending and deduplicated — or null where it
 * names nothing readable.
 *
 * An explicit list wins over the span, and a list is filtered to whole numbers
 * rather than refused wholesale: `planLoad`'s contract is that every season it
 * declines is named on the console, and a value that is not a season has no
 * name to give.
 */
function requestedSeasons(
  request: CompsLoadRequest,
  latestComplete: number,
): number[] | null {
  if (request.seasons && request.seasons.length > 0) {
    const named = [...new Set(request.seasons.filter(Number.isInteger))];
    return named.sort((a, b) => a - b);
  }

  const from = request.from ?? EARLIEST_SEASON;
  const to = request.to ?? latestComplete;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;

  const span: number[] = [];
  for (let season = from; season <= to; season++) span.push(season);
  return span;
}
