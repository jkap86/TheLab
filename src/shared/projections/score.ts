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

/** Two decimals, which is the precision both sides of the multiplication carry. */
const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Fantasy points for a projected stat line under one league's scoring.
 *
 * Driven by the scoring settings rather than the stat line: a category the league
 * doesn't score contributes nothing, and a category it scores but Sleeper doesn't
 * project (IDP tackles, return yards) contributes nothing either — see
 * {@link unprojectedScoring} for the second case, which is a real gap rather than
 * a zero.
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
 * actually available.
 *
 * A league-level property, not a per-player one: the projection vocabulary is
 * fixed, so this answers "how much of this league's scoring can we even see?"
 * once. An IDP league is the case that matters — Sleeper projects a handful of
 * defensive categories and scores dozens, so every IDP total will read low, and a
 * tool presenting one as authoritative would be lying by omission.
 *
 * Only categories with a non-zero weight count: Sleeper writes out its whole
 * scoring template, so most leagues carry dozens of keys set to 0 that are
 * disabled, not missing.
 */
export function unprojectedScoring(
  scoring: Record<string, number> | null | undefined,
  available: Iterable<string>,
): string[] {
  if (!scoring) return [];

  const have = new Set(available);
  return Object.entries(scoring)
    .filter(
      ([key, weight]) =>
        !NOT_SCORABLE.has(key) &&
        typeof weight === "number" &&
        Number.isFinite(weight) &&
        weight !== 0 &&
        !have.has(key),
    )
    .map(([key]) => key)
    .sort();
}
