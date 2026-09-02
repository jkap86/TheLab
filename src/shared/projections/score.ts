/**
 * Scoring a stat line with a league's own scoring settings.
 *
 * Pure and free of runtime imports so it can be unit-tested — the caller supplies
 * both sides, as in `ktc/match`.
 *
 * This is a dot product, and it works because Sleeper uses one vocabulary on both
 * sides: the keys in a projection's `stats` (`pass_yd`, `bonus_rec_te`,
 * `pts_allow_21_27`) are the keys in a league's `scoring_settings`. Of the 93
 * stat keys observed across a season of projections, 81 appear as scoring keys in
 * leagues already stored here; the rest are metadata, not events.
 *
 * One function serves projections and played weeks alike, because the rule is the
 * same for both: a category scores when the league pays for it and the line
 * carries it. Sleeper populates every category it publishes — including the ones
 * it fills in itself, like the first downs and the reception splits — so there is
 * nothing here that reads a key differently depending on which kind of line it
 * arrived on.
 *
 * Why this exists at all, when the endpoint already sends `pts_ppr`: those are
 * Sleeper's *default* PPR/half/standard scorings. A TE-premium league, one paying
 * 6 for passing touchdowns, or any league with reception bonuses gets a different
 * number — quietly, by a few points, which is exactly the size of error that makes
 * a lineup tool recommend the wrong bench.
 */

/**
 * Stat keys that never score, whatever a league's settings say.
 *
 * `pts_*` are Sleeper's own totals for the same stat line, so scoring them would
 * add the whole projection to itself; the ADP keys are draft metadata that
 * happens to ride along in `stats`. No league observed scores any of these, but
 * the failure would be a silently doubled total rather than an error, so they are
 * excluded here rather than trusted not to appear.
 *
 * This is the one exclusion list, and it is deliberately narrow: these are not
 * categories at all, they are the answer restated. Every key that names an actual
 * event scores.
 */
const NOT_SCORABLE = new Set([
  "pts_std",
  "pts_half_ppr",
  "pts_ppr",
  "adp_dd_ppr",
  "pos_adp_dd_ppr",
]);

/** Two decimals, which is the precision both sides of the multiplication carry. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Fantasy points for a stat line under one league's scoring.
 *
 * Driven by the scoring settings rather than the stat line: a category the league
 * doesn't score contributes nothing, and a category it scores but the line doesn't
 * carry contributes nothing either. Both are real gaps rather than zeroes, and
 * {@link unprojectedScoring} names the second kind.
 *
 * Projected stats are expected values, not integers — 0.67 fumbles, 1.82 passing
 * touchdowns — so scoring a projection gives a weighted average of outcomes, not a
 * score any single week will land on. A played line carries counts and gives the
 * points that were actually scored.
 */
export function scoreStatLine(
  stats: Record<string, number> | null | undefined,
  scoring: Record<string, number> | null | undefined,
): number {
  if (!stats || !scoring) return 0;

  let total = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    if (NOT_SCORABLE.has(key)) continue;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight === 0) {
      continue;
    }

    const value = stats[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    total += value * weight;
  }

  return round(total);
}

/**
 * Categories a league scores that projections can't supply, given the stat keys
 * the feed actually publishes.
 *
 * A league-level property, not a per-player one, so `available` must be the
 * vocabulary of the whole week rather than of one league's rosters — see
 * `queries.getProjectedStatKeys`. Passing the roster subset makes every category
 * only kickers and defences carry (`xpm`, `sack`, `int`) look unsupplied in a
 * league that rosters neither, which buries the handful of gaps that are real.
 *
 * Sleeper projects a handful of defensive categories and an IDP league scores
 * dozens, so every IDP total reads low. `fgm_50p` is the quieter one — never
 * projected, scored by 89 of the 120 leagues stored here, and worth about 1.6
 * points a kicker a week.
 *
 * Only categories with a non-zero weight count: Sleeper writes out its whole
 * scoring template, so most leagues carry dozens of keys set to 0 that are
 * disabled, not missing.
 */
export function unprojectedScoring(
  scoring: Record<string, number> | null | undefined,
  available: Iterable<string>,
): string[] {
  const have = new Set(available);
  return scoredKeys(scoring).filter((key) => !have.has(key));
}

/** A league's live scoring keys, sorted. */
function scoredKeys(
  scoring: Record<string, number> | null | undefined,
): string[] {
  if (!scoring) return [];

  return Object.entries(scoring)
    .filter(
      ([key, weight]) =>
        !NOT_SCORABLE.has(key) &&
        typeof weight === "number" &&
        Number.isFinite(weight) &&
        weight !== 0,
    )
    .map(([key]) => key)
    .sort();
}
