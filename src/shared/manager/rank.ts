/**
 * Ranking a league's teams by a metric — projected points, points for, the
 * standings, or KTC starter value.
 *
 * One ranking rule, several callers. The ranks route asks "where does the
 * manager's roster sit in each of their leagues" for four different metrics, the
 * KTC route asks it for a fifth, and the expanded league panel asks "what order
 * do these teams go in" — all against the same competition-style ordering, so no
 * two answers can disagree about what a rank is or how a tie breaks.
 *
 * Pure and free of runtime imports on purpose: the panel is client code and
 * value-imports this file directly (`@/shared/manager/rank`), the way it
 * already imports `@/shared/projections/slots` — pulling the manager barrel in
 * would drag `pg` into the bundle.
 */

/** Where one roster sits when its league is ordered by a metric, best first. */
export type LeagueRank = {
  /**
   * 1-based, competition style: ties share the better rank, so two rosters
   * level on the metric are both 1st rather than one of them arbitrarily 2nd.
   */
  rank: number;
  /** Teams ranked against — the denominator the rank is out of. */
  of: number;
};

/**
 * Competition-style rank of one roster among a league's values, highest first.
 *
 * Null when the roster has no value, and null when *every* value is zero — the
 * guard the projected rank has always rested on, kept here so every metric
 * inherits it: an undrafted or unplayed league scores 0 across the board, and
 * calling that "1st of 12" would dress a league with no result yet up as a lead.
 */
export function rankOf(
  values: ReadonlyMap<number, number>,
  rosterId: number,
): LeagueRank | null {
  const own = values.get(rosterId);
  if (own === undefined) return null;

  let rank = 1;
  let ranked = false;
  for (const value of values.values()) {
    if (value > own) rank++;
    if (value !== 0) ranked = true;
  }
  if (!ranked) return null;

  return { rank, of: values.size };
}

/** Where one roster sits when its league is ordered by projected points. */
export type ProjectedRank = LeagueRank & {
  /** The roster's own projected total, for saying what the rank is a rank of. */
  points: number;
};

/**
 * The rank of one roster among a league's projected totals — {@link rankOf}
 * carrying the total it ranked, so a caller can say what the number is a rank of
 * without a second lookup.
 */
export function projectedRank(
  points: ReadonlyMap<number, number>,
  rosterId: number,
): ProjectedRank | null {
  const rank = rankOf(points, rosterId);
  if (!rank) return null;
  // Non-null once rankOf returned: the roster is present, or it couldn't rank.
  return { ...rank, points: points.get(rosterId)! };
}

/**
 * A single sortable score for the standings: wins dominate, points-for break
 * ties, matching Sleeper's own order (and the expanded panel's `wins desc, fpts
 * desc`).
 *
 * Folding the two into one number lets {@link rankOf} rank the standings the
 * same way it ranks everything else, all-zero guard included — a preseason
 * league where every team is 0-0 with nothing scored comes back unranked rather
 * than as an arbitrary "1st". The points term can't cross a win boundary (no
 * fantasy team scores a million points in a season), so more wins always outrank
 * fewer however the points fall.
 */
export function standingScore(wins: number, fpts: number): number {
  return wins + fpts / 1_000_000;
}

/**
 * A league's teams in projected-points order, highest first.
 *
 * Teams without a total keep their relative order at the end, and ties keep
 * theirs, because the input arrives in standings order and that is the right
 * tiebreak — the sort is stable, so "no projection" degrades to the standings
 * rather than to an arbitrary shuffle. With no totals at all the list comes
 * back in the order it came in.
 */
export function orderByProjectedPoints<T extends { roster_id: number }>(
  teams: readonly T[],
  points: ReadonlyMap<number, number> | null,
): T[] {
  if (!points) return [...teams];

  return [...teams].sort((a, b) => {
    const pa = points.get(a.roster_id);
    const pb = points.get(b.roster_id);
    if (pa === undefined || pb === undefined) {
      return (pa === undefined ? 1 : 0) - (pb === undefined ? 1 : 0);
    }
    return pb - pa;
  });
}
