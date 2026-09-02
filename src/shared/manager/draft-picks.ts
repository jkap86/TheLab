/**
 * Which future draft picks each roster owns, reconstructed from a league's
 * traded-pick records — and, for the manager's own roster, resolved into the
 * named picks the card shows.
 *
 * Sleeper's `traded_picks` lists only picks that have changed hands — an untraded
 * pick isn't in it at all — so a roster's real portfolio is the whole pick grid
 * for the seasons in play, with the traded rows overriding who holds each cell.
 * Ported whole from TheLabX with its tests; {@link managerRosterPicks} is this
 * repo's addition, composing in TypeScript what TheLabX's `getDraftSlots` does
 * in SQL — see its doc for why. Pure apart from a type-only contract import, so
 * it unit-tests like `league-ranks`; the query layer hands it the rows.
 */

import type { RosterPick } from "@/shared/contract";

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
 * A stored draft with the two columns slot naming reads on top of what the
 * grid needs: the draft's `type` (an auction's "order" is nomination order, not
 * a pick order) and its raw `draft_order` blob (user id → slot, null until the
 * league sets one). {@link dynastyPickGrid} takes the narrower type and ignores
 * both.
 */
export type LeagueDraftRow = LeagueDraft & {
  type: string | null;
  draft_order: Record<string, unknown> | null;
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

/**
 * Sleeper's `settings.type` for a dynasty league — it sits alongside 0 redraft,
 * 1 keeper and 3 chopped. In TheLabX this lives in `adp-selection` beside the
 * SQL fragment that reads it; here the pick grid is its only reader, and the
 * ADP board port is what moves it back beside its fragment.
 */
export const DYNASTY_LEAGUE_TYPE = 2;

const cellKey = (season: string, round: number, rosterId: number): string =>
  `${season}|${round}|${rosterId}`;

/**
 * Sleeper spells "no previous season" as null, `''` and `'0'` depending on
 * vintage.
 */
const isInaugural = (previousLeagueId: string | null): boolean =>
  previousLeagueId === null ||
  previousLeagueId === "" ||
  previousLeagueId === "0";

/** Drafts oldest first, an undated stray last. */
const byStartTime = (a: LeagueDraft, b: LeagueDraft): number =>
  (a.start_time ?? Infinity) - (b.start_time ?? Infinity) ||
  a.draft_id.localeCompare(b.draft_id);

/**
 * The league's startup draft, or null where it has none of its own.
 *
 * Only an inaugural league — no previous league id — holds one: a continuing
 * dynasty league's drafts are all rookie drafts, additive to rosters that
 * already exist. A startup is the one draft in a league that says nothing about
 * how deep its *rookie* drafts run or whether this year's class has been taken.
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
 * instead — which is what this module did in TheLabX before this was written —
 * answered a different question and got the roll-over wrong in both directions:
 * a league whose 2026 picks had all been dealt away months ago went on listing
 * a draft that had already happened, while a quiet league listed nothing at all.
 *
 * Two readings are load-bearing:
 *
 *   - **the startup doesn't count as this year's draft.** An inaugural league
 *     runs a startup and a rookie draft under one season label, so reading "a
 *     complete draft for this season" would roll the window forward the moment
 *     the startup ended and hide a rookie class nobody has drafted yet;
 *   - **only `complete` counts as taken.** A draft in progress hasn't happened,
 *     and neither has one Sleeper has told us nothing about — a season the sync
 *     has yet to see keeps the nearer year, which is the reading that fails
 *     toward showing a pick that exists rather than hiding one.
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
 *     on {@link dynastyPickGrid}.
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

/** The roster columns pick resolution reads — a slice of what the query sends. */
export type PickRoster = { roster_id: number; owner_id: string | null };

/** Identity as `league_users` stores it — what an acquired pick's origin is named from. */
export type LeagueUserName = { user_id: string; display_name: string | null };

/** Everything {@link managerRosterPicks} reads off one league's stored graph. */
export type PickLeague = {
  /** `settings.type`, already guarded and cast — see `LEAGUE_TYPE_SQL`. */
  league_type: number;
  previous_league_id: string | null;
  traded_picks: readonly TradedPick[];
  drafts: readonly LeagueDraftRow[];
  users: readonly LeagueUserName[];
  rosters: readonly PickRoster[];
};

/**
 * Where each roster picks in one season's draft, or null while there is no
 * order to read. TheLabX answers this in SQL (`getDraftSlots`) because its
 * trades board names picks across a few hundred leagues and wants a cache tier;
 * here the league read already carries the draft rows, so the same four
 * decisions are composed in TypeScript instead:
 *
 * - the order is read through `draft_order` (user → slot) joined back to
 *   rosters by owner — a roster whose owner has left resolves to nothing,
 *   which is the honest answer rather than a guessed slot;
 * - the season's draft is chosen **before** its order is looked at, so an
 *   unordered rookie draft reports nothing rather than falling through to the
 *   startup above it;
 * - an auction has no slots at all — its `draft_order` is not a pick order;
 * - the latest draft in a season wins (an inaugural league runs a startup and
 *   a rookie draft under one label), an undated stray last.
 */
function seasonDraftSlots(
  drafts: readonly LeagueDraftRow[],
  season: string,
  rosters: readonly PickRoster[],
): Map<number, number> | null {
  const chosen = drafts
    .filter((d) => d.season === season)
    .sort(
      (a, b) =>
        (b.start_time ?? -Infinity) - (a.start_time ?? -Infinity) ||
        a.draft_id.localeCompare(b.draft_id),
    )[0];
  if (!chosen || chosen.type === "auction") return null;
  const order = chosen.draft_order;
  if (order === null || typeof order !== "object" || Array.isArray(order)) {
    return null;
  }

  const slots = new Map<number, number>();
  for (const roster of rosters) {
    if (roster.owner_id === null) continue;
    // Guarded like every numeric read off a Sleeper blob — junk in one
    // league's order must read as "no slot", not break the league.
    const raw = order[roster.owner_id];
    const slot =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^[0-9]+$/.test(raw)
          ? Number(raw)
          : NaN;
    if (Number.isInteger(slot) && slot >= 1) slots.set(roster.roster_id, slot);
  }
  return slots;
}

/**
 * The manager's future draft picks in one league, named for the card.
 *
 * {@link ownedDraftPicks} lays the grid — resolved through
 * {@link dynastyPickGrid} for a dynasty league, derived from the trades for
 * every other format — and this keeps only the manager's own portfolio, since
 * only their roster ships. Each pick then carries the two facts Sleeper names
 * one by: its `slot`, read off that season's draft order through the *original*
 * roster's owner (that slot is where the pick actually falls), and `from`, the
 * original owner's name — only where the pick was acquired, because a roster's
 * own pick has no origin worth printing.
 *
 * A manager holding no roster gets `[]`, as does every roster in a league whose
 * grid comes out empty — a redraft league, or a dynasty with no measured depth
 * and no traded pick.
 */
export function managerRosterPicks(
  league: PickLeague,
  season: string,
  managerUserId: string,
): RosterPick[] {
  const mine = league.rosters.find((r) => r.owner_id === managerUserId);
  if (!mine) return [];

  const grid =
    league.league_type === DYNASTY_LEAGUE_TYPE
      ? dynastyPickGrid(season, league.drafts, league.previous_league_id)
      : null;
  const owned = ownedDraftPicks(
    league.traded_picks,
    league.rosters.map((r) => r.roster_id),
    season,
    grid,
  );
  const picks = owned.get(mine.roster_id);
  if (!picks) return [];

  const names = new Map(league.users.map((u) => [u.user_id, u.display_name]));
  const owners = new Map(league.rosters.map((r) => [r.roster_id, r.owner_id]));
  const originName = (rosterId: number): string => {
    const owner = owners.get(rosterId);
    const name = owner === null || owner === undefined ? null : names.get(owner);
    // An orphan origin or a member the sync never saw still names the asset —
    // "Roster 7's pick" is a fact where a username would be a guess.
    return name?.trim() || `Roster ${rosterId}`;
  };

  const slotsBySeason = new Map<string, Map<number, number> | null>();
  return picks.map((pick) => {
    let slots = slotsBySeason.get(pick.season);
    if (slots === undefined) {
      slots = seasonDraftSlots(league.drafts, pick.season, league.rosters);
      slotsBySeason.set(pick.season, slots);
    }
    return {
      season: pick.season,
      round: pick.round,
      slot: slots?.get(pick.original_roster_id) ?? null,
      from:
        pick.original_roster_id === mine.roster_id
          ? null
          : originName(pick.original_roster_id),
    };
  });
}
