/**
 * Ranking a league's teams by their projected points.
 *
 * Two callers, one number. The ranks route asks "where does the manager's
 * roster sit in each league" and the expanded league panel asks "what order do
 * these teams go in" — both against the same rest-of-season weekly-optimal
 * total, so the answers can't disagree about what a projected rank is.
 *
 * Pure and free of runtime imports on purpose: the panel is client code and
 * value-imports this file directly (`@/shared/manager/rank`), the way it
 * already imports `@/shared/projections/slots` — pulling the manager barrel in
 * would drag `pg` into the bundle.
 */

/** Where one roster sits when its league is ordered by projected points. */
export type ProjectedRank = {
  /**
   * 1-based, competition style: ties share the better rank, so two rosters
   * projecting the same total are both 1st rather than one of them arbitrarily
   * 2nd.
   */
  rank: number;
  /** Teams ranked against — the denominator the rank is out of. */
  of: number;
  /** The roster's own projected total, for saying what the rank is a rank of. */
  points: number;
};

/**
 * The rank of one roster among a league's projected totals.
 *
 * Null when the roster has no total, and null when *every* total is zero: a
 * league nobody has drafted in yet projects 0.00 for all of its teams, and
 * calling that "1st of 12" would dress an empty league up as a lead.
 */
export function projectedRank(
  points: ReadonlyMap<number, number>,
  rosterId: number,
): ProjectedRank | null {
  const own = points.get(rosterId);
  if (own === undefined) return null;

  let rank = 1;
  let projected = false;
  for (const total of points.values()) {
    if (total > own) rank++;
    if (total !== 0) projected = true;
  }
  if (!projected) return null;

  return { rank, of: points.size, points: own };
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
