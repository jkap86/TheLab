/**
 * Which season of a manager's leagues the page is reading — the ladder behind
 * the header plate's season tab, and the one rule that keeps stepping it off
 * that tab from splitting the cache.
 *
 * **The season is a population, not a filter, which is why the control for it
 * sits on the plate and not on the subject rail.** Every other narrowing this
 * tool offers cuts a list of leagues down: the league rules say what a league
 * *is*, the subjects say who is in it, and both are applied to the leagues the
 * page already holds. The season decides which leagues there are *at all* — it
 * re-keys the stream, the rosters, the membership, the ranks, the values and the
 * ADP valuation together — and that is the same standing the ADP drawer already
 * gives it ("the season is the board's population; the window is a cut inside
 * it"). So the plate's top-left corner, which has always named the season the
 * card is about, is where choosing it belongs; the corner does not become the
 * filter seat this card spent a while regretting.
 *
 * Pure and tested: no runtime imports at all, so the two ends that read it — a
 * client store and a shared component — share one definition of where the ladder
 * stops.
 */

/**
 * The earliest season worth offering.
 *
 * Sleeper's first NFL season, so a step below it reaches an account that cannot
 * exist rather than one that merely happens to be empty — which is a different
 * answer and the one a stepper should refuse to make. A manager who simply
 * wasn't on the platform in 2019 still gets that season, and gets the page's
 * ordinary "no 2019 leagues found" for it: the ladder bounds what Sleeper can be
 * asked about, never what a particular account did.
 */
export const FIRST_SLEEPER_SEASON = "2017";

/**
 * The season one step away, or null where the ladder ends.
 *
 * Both bounds live here rather than at the two call sites, which is
 * {@link stepCircle}'s rule and {@link WeekStepper}'s after it: a stepper asks
 * "can I move" where a key per season would ask "is this one allowed", and
 * answering null is what lets a key with nowhere to go be drawn inert instead of
 * silently re-selecting the season already showing.
 *
 * **It fails closed.** A season or a bound that isn't a four-digit year answers
 * null in both directions, so the control is inert rather than offering a year
 * nothing could resolve — Sleeper answers an unknown season with an empty league
 * list, which reads as "this manager has none" and is the one wrong answer here
 * that looks like a working one.
 *
 * @param season  The season being read.
 * @param by      `-1` for the season before, `1` for the season after.
 * @param latest  The newest season selectable — the app's own current season,
 *                since a league year Sleeper has not rolled over to has no
 *                leagues in it for anybody.
 */
export function stepSeason(
  season: string,
  by: number,
  latest: string,
  earliest: string = FIRST_SLEEPER_SEASON,
): string | null {
  const from = seasonNumber(season);
  const ceiling = seasonNumber(latest);
  const floor = seasonNumber(earliest);
  if (from === null || ceiling === null || floor === null) return null;

  const next = from + by;
  return next >= floor && next <= ceiling ? String(next) : null;
}

/**
 * How a selected season is spelled on a request and in a cache key — and
 * `undefined` for the current one, which is the whole point of the function.
 *
 * The routes under `/api/user/[username]` default an omitted `?season` to
 * {@link getActiveSeason}, and `managerQueryKeys` files an omitted season under
 * the segment `"default"`. So the current season has two possible spellings that
 * mean the same thing and key differently — and three tools share these entries:
 * the pick tracker and the lineup checker read the leagues stream with no season
 * at all, so a manager tool that always named its season explicitly would file
 * the identical answer under a second key and a reader crossing between the
 * tools would pay for the same account twice. That is the drift the lower-casing
 * of `searched` already exists to stop, arrived at on the other segment of the
 * same key.
 *
 * A *past* season is a genuinely different selection and keeps its own entries,
 * which is exactly what the `"default"` convention is written for.
 */
export function seasonParam(
  season: string,
  activeSeason: string,
): string | undefined {
  return season === activeSeason ? undefined : season;
}

/** A four-digit year as a number, or null for anything that isn't one. */
function seasonNumber(season: string): number | null {
  return /^\d{4}$/.test(season) ? Number(season) : null;
}
