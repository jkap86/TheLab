/**
 * Scoring a projected stat line with a league's own scoring settings.
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
 */
const NOT_SCORABLE = new Set([
  "pts_std",
  "pts_half_ppr",
  "pts_ppr",
  "adp_dd_ppr",
  "pos_adp_dd_ppr",
]);

/**
 * Stat keys Sleeper carries in `stats` without projecting them: each is a fixed
 * function of a base stat rather than a modelled value.
 *
 * A `*_fd` is the yardage over ten. Joe Burrow's 2026 week 1 line projects 25.83
 * completions and 29.39 passing "first downs" — more first downs than
 * completions, because it is 293.94 / 10. The reception splits are a fixed
 * distribution of `rec` (20/20/30/20/10/10, summing to 110% of the catches),
 * which puts a tenth of every reception in the 40-plus bucket. Across both stored
 * seasons all 1,494 receiving lines and all 142 passing lines match their formula
 * to within a cent, which is the rounding.
 *
 * Scoring them is not a rounding-sized error: 39 of the leagues stored here pay
 * for `rush_fd` and 23 for `pass_fd`, so a league at 0.5 a passing first down is
 * quietly adding 0.05 a passing yard on top of its own yardage rate — 15.62 of
 * Burrow's 35.69 points in one of them, and 35% of the average starter's total.
 * They are reported through {@link derivedScoring} instead, which is what they
 * are: categories a league scores that the feed cannot supply.
 *
 * `rush_40p` and `pass_cmp_40p` look like the same trick and aren't — neither
 * holds to a formula across seasons, so they are scored as projected.
 */
const DERIVED = new Set([
  "pass_fd",
  "rush_fd",
  "rec_fd",
  "rec_0_4",
  "rec_5_9",
  "rec_10_19",
  "rec_20_29",
  "rec_30_39",
  "rec_40p",
]);

/** Two decimals, which is the precision both sides of the multiplication carry. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Fantasy points for a projected stat line under one league's scoring.
 *
 * Driven by the scoring settings rather than the stat line: a category the league
 * doesn't score contributes nothing, and a category it scores but Sleeper doesn't
 * project contributes nothing either — whether the key is absent (IDP tackles,
 * 50-yard field goals) or present but {@link DERIVED} from another stat. Both are
 * real gaps rather than zeroes, and {@link unprojectedScoring} names them.
 *
 * Projected stats are expected values, not integers — 0.67 fumbles, 1.82 passing
 * touchdowns — so the result is a weighted average of outcomes, not a score any
 * single week will land on.
 */
export function scoreProjection(
  stats: Record<string, number> | null | undefined,
  scoring: Record<string, number> | null | undefined,
): number {
  if (!stats || !scoring) return 0;

  let total = 0;
  for (const [key, weight] of Object.entries(scoring)) {
    if (NOT_SCORABLE.has(key) || DERIVED.has(key)) continue;
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
 * Kept separate from {@link derivedScoring}, which is the other half of the same
 * question, because the two want different warnings: this one only bites a league
 * that starts the players carrying those categories, and that one bites everyone.
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
  return scoredKeys(scoring).filter(
    (key) => !DERIVED.has(key) && !have.has(key),
  );
}

/**
 * Categories a league scores that Sleeper publishes but doesn't project — the
 * {@link DERIVED} keys, computed from another stat rather than modelled.
 *
 * Doesn't depend on what the feed contains, only on what the league pays for, so
 * it takes no vocabulary: a derived key is derived in every week.
 *
 * Worth its own list because it can't be gated the way {@link unprojectedScoring}
 * can. A missing defensive category costs nothing in a league that starts no
 * defence, but a league paying for first downs is paying on quarterbacks, backs
 * and receivers alike — the categories are just no longer *scored*, so the effect
 * is that those totals now read lower than the league's settings suggest.
 */
export function derivedScoring(
  scoring: Record<string, number> | null | undefined,
): string[] {
  return scoredKeys(scoring).filter((key) => DERIVED.has(key));
}

/** A league's live scoring keys, sorted — the shared half of the two above. */
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
