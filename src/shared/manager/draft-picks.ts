/**
 * Which future draft picks each roster owns, reconstructed from a league's
 * traded-pick records.
 *
 * Sleeper's `traded_picks` lists only picks that have changed hands — an untraded
 * pick isn't in it at all — so a roster's real portfolio is the whole pick grid
 * for the seasons in play, with the traded rows overriding who holds each cell.
 * Pure and free of runtime imports so it unit-tests like its neighbours
 * (`shares`, `filters`, `rank`); the query layer hands it the rows and the
 * roster ids.
 */

/**
 * A future draft-pick asset as stored, from Sleeper's `traded_picks`. All ids are
 * ROSTER ids: `roster_id` is the pick's original owner, `owner_id` holds it now.
 */
export type TradedPick = {
  season: string;
  round: number;
  roster_id: number;
  owner_id: number;
};

/** One owned pick: which draft it is for, and whose it originally was. */
export type DraftPickAsset = {
  season: string;
  round: number;
  /**
   * The roster this pick originally belongs to. Equal to the owner for a pick a
   * roster still holds; a different roster for one it acquired in a trade — which
   * is what lets the UI mark a pick as "from <that team>".
   */
  original_roster_id: number;
};

const cellKey = (season: string, round: number, rosterId: number): string =>
  `${season}|${round}|${rosterId}`;

/**
 * Resolve each roster's owned future draft picks from a league's traded picks.
 *
 * The pick space is derived from the trades themselves, because nothing else in
 * the data spells it out:
 *
 *   - the **seasons** are the ones that appear in `traded_picks`, from `minSeason`
 *     forward (the league's own season, so a stale past-season row can't
 *     resurface). A season nobody has traded a pick in is a market this can't see;
 *   - the **rounds** run 1..the deepest round anyone has traded. Sleeper doesn't
 *     tell us a league's rookie-draft round count, and every future draft in a
 *     league runs the same number, so the deepest traded pick is the best lower
 *     bound the data carries. A league whose deep picks never trade under-reports
 *     the tail — better than inventing rounds that may not exist;
 *   - within each (season, round) every roster starts owning its own pick, and a
 *     traded row moves that cell to whoever holds it now.
 *
 * Returns a map from owning roster id to that roster's picks, each sorted by
 * season then round, with the roster's own picks ahead of ones it acquired. A
 * roster that owns nothing is absent — as is every roster when no pick has ever
 * been traded (every redraft league, and any dynasty with a quiet pick market),
 * which the caller reads as an empty list.
 */
export function ownedDraftPicks(
  tradedPicks: readonly TradedPick[],
  rosterIds: readonly number[],
  minSeason: string,
): Map<number, DraftPickAsset[]> {
  const relevant = tradedPicks.filter((p) => p.season >= minSeason);
  if (relevant.length === 0) return new Map();

  const seasons = [...new Set(relevant.map((p) => p.season))].sort();
  const maxRound = Math.max(...relevant.map((p) => p.round));

  // (season, round, original roster) -> the roster that holds it now.
  const heldBy = new Map<string, number>();
  for (const p of relevant) {
    heldBy.set(cellKey(p.season, p.round, p.roster_id), p.owner_id);
  }

  const owned = new Map<number, DraftPickAsset[]>();
  for (const season of seasons) {
    for (let round = 1; round <= maxRound; round++) {
      for (const original of rosterIds) {
        const owner = heldBy.get(cellKey(season, round, original)) ?? original;
        let list = owned.get(owner);
        if (!list) owned.set(owner, (list = []));
        list.push({ season, round, original_roster_id: original });
      }
    }
  }

  for (const [owner, picks] of owned) {
    picks.sort(
      (a, b) =>
        a.season.localeCompare(b.season) ||
        a.round - b.round ||
        // A roster's own pick comes before ones it acquired, then by origin, so a
        // round's own pick reads first and the rest are ordered deterministically.
        Number(a.original_roster_id !== owner) -
          Number(b.original_roster_id !== owner) ||
        a.original_roster_id - b.original_roster_id,
    );
  }

  return owned;
}
