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

/**
 * One of a league's stored drafts, as the pick grid reads it. `rounds` is
 * `settings.rounds` already cast — null where Sleeper sent nothing parseable,
 * which reads as "this draft's depth is unknown" rather than as zero rounds.
 */
export type LeagueDraft = {
  draft_id: string;
  season: string;
  status: string | null;
  start_time: number | null;
  rounds: number | null;
};

/**
 * The seasons a pick portfolio spans, and how deep each of them runs. Handed to
 * {@link ownedDraftPicks} in place of the grid it would otherwise derive from
 * the trades themselves.
 */
export type DraftPickGrid = {
  /** Every season to enumerate, in order. */
  seasons: string[];
  /**
   * A floor on the round count, from the league's own rookie draft. The grid
   * still runs as deep as any traded pick proves it does, so this only matters
   * where a season's picks have never moved.
   */
  minRounds: number | null;
};

/** How many future drafts a dynasty league's pick market runs at once. */
export const DYNASTY_PICK_SEASONS = 3;

const cellKey = (season: string, round: number, rosterId: number): string =>
  `${season}|${round}|${rosterId}`;

/**
 * Sleeper spells "no previous season" as null, `''` and `'0'` depending on
 * vintage — the same three readings `STARTUP_DRAFT_SQL` folds together.
 */
const isInaugural = (previousLeagueId: string | null): boolean =>
  previousLeagueId === null ||
  previousLeagueId === "" ||
  previousLeagueId === "0";

/** Drafts oldest first, an undated stray last — `STARTUP_DRAFT_SQL`'s order. */
const byStartTime = (a: LeagueDraft, b: LeagueDraft): number =>
  (a.start_time ?? Infinity) - (b.start_time ?? Infinity) ||
  a.draft_id.localeCompare(b.draft_id);

/**
 * The league's startup draft, or null where it has none of its own.
 *
 * Only an inaugural league — no previous league id — holds one: a continuing
 * dynasty league's drafts are all rookie drafts, additive to rosters that
 * already exist. This is the same rule `shared/trades/sql.ts` bounds the trades
 * board with, asked in TypeScript, and for a related reason: a startup is the
 * one draft in a league that says nothing about how deep its *rookie* drafts run
 * or whether this year's class has been taken.
 */
function startupDraft(
  drafts: readonly LeagueDraft[],
  previousLeagueId: string | null,
): LeagueDraft | null {
  if (!isInaugural(previousLeagueId)) return null;
  return [...drafts].sort(byStartTime)[0] ?? null;
}

/**
 * The seasons a dynasty league's pick market currently runs, and how deep its
 * rookie drafts go.
 *
 * Sleeper carries a fixed horizon of future drafts rather than whatever happens
 * to have been traded, and it rolls forward the moment a class is taken: with
 * the 2026 rookie draft still ahead the tradable picks are 2026–2028, and once
 * it completes they are 2027–2029. Deriving the seasons from `traded_picks`
 * instead — which is what this module did — answered a different question and
 * got the roll-over wrong in both directions: a league whose 2026 picks had all
 * been dealt away months ago went on listing a draft that had already happened,
 * while a quiet league listed nothing at all.
 *
 * Two readings are load-bearing:
 *
 *   - **the startup doesn't count as this year's draft.** An inaugural league
 *     runs a startup and a rookie draft under one season label, so reading "a
 *     complete draft for this season" would roll the window forward the moment
 *     the startup ended and hide a rookie class nobody has drafted yet;
 *   - **only `complete` counts as taken.** A draft in progress hasn't happened,
 *     and neither has one Sleeper has told us nothing about — a season the
 *     crawler has yet to see keeps the nearer year, which is the reading that
 *     fails toward showing a pick that exists rather than hiding one.
 *
 * `minRounds` is that same startup exclusion read for depth: the most recent
 * rookie draft is how many rounds every future one runs. An inaugural league
 * that has only run its startup has no rookie draft to measure and reports
 * null — its 15-to-25-round startup is not the shape of next May.
 *
 * Returns null for a season that isn't a year, which reads as "no window" and
 * leaves the caller on the derived grid.
 */
export function dynastyPickGrid(
  leagueSeason: string,
  drafts: readonly LeagueDraft[],
  previousLeagueId: string | null,
): DraftPickGrid | null {
  const year = Number(leagueSeason);
  if (!Number.isInteger(year) || year <= 0) return null;

  const startupId = startupDraft(drafts, previousLeagueId)?.draft_id;
  const rookieDrafts = drafts.filter((d) => d.draft_id !== startupId);

  const thisYearTaken = rookieDrafts.some(
    (d) => d.season === leagueSeason && d.status === "complete",
  );
  const first = year + (thisYearTaken ? 1 : 0);

  const latestRookie = [...rookieDrafts].sort(byStartTime).at(-1);

  return {
    seasons: Array.from({ length: DYNASTY_PICK_SEASONS }, (_, i) =>
      String(first + i),
    ),
    minRounds: latestRookie?.rounds ?? null,
  };
}

/**
 * Resolve each roster's owned future draft picks from a league's traded picks.
 *
 * Within each (season, round) every roster starts owning its own pick, and a
 * traded row moves that cell to whoever holds it now. What varies is the grid
 * those cells are laid out on, and there are two answers:
 *
 *   - **a `grid` the caller resolved**, which is what a dynasty league gets
 *     (see {@link dynastyPickGrid}): a fixed horizon of future drafts, whether
 *     or not a pick in one of them has ever changed hands;
 *   - **derived from the trades**, for everything else. The seasons are the ones
 *     appearing in `traded_picks` from `minSeason` forward (the league's own
 *     season, so a stale past-season row can't resurface), and a season nobody
 *     has traded a pick in is a market this can't see. Right for a format with no
 *     standing pick horizon to read, and the reason it was wrong for dynasty is
 *     on `dynastyPickGrid`.
 *
 * The **rounds** run 1..the deepest round anyone has traded, or the grid's
 * `minRounds` where that is deeper. Sleeper doesn't publish a round count for a
 * draft that hasn't been created yet, and every future draft in a league runs
 * the same number, so a traded pick and the last rookie draft are the two lower
 * bounds the data carries. A league offering neither under-reports the tail —
 * better than inventing rounds that may not exist.
 *
 * Returns a map from owning roster id to that roster's picks, each sorted by
 * season then round, with the roster's own picks ahead of ones it acquired. A
 * roster that owns nothing is absent — as is every roster when the grid comes
 * out empty (every redraft league, and any dynasty whose depth is unknown and
 * whose picks have never moved), which the caller reads as an empty list.
 */
export function ownedDraftPicks(
  tradedPicks: readonly TradedPick[],
  rosterIds: readonly number[],
  minSeason: string,
  grid?: DraftPickGrid | null,
): Map<number, DraftPickAsset[]> {
  const relevant = tradedPicks.filter((p) => p.season >= minSeason);

  // A traded pick proves its round exists, wherever in the window it sits — a
  // 2026 fourth is evidence the 2028 draft runs four rounds too, so the depth is
  // taken across every relevant row rather than only the enumerated seasons.
  const tradedDepth = relevant.reduce((max, p) => Math.max(max, p.round), 0);
  const seasons = grid
    ? grid.seasons
    : [...new Set(relevant.map((p) => p.season))].sort();
  const maxRound = Math.max(tradedDepth, grid?.minRounds ?? 0);
  if (seasons.length === 0 || maxRound < 1) return new Map();

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
