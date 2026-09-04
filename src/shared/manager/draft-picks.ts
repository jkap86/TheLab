/**
 * Which future draft picks each roster owns, reconstructed from a league's
 * traded-pick records — and resolved into the named picks the card shows.
 *
 * Sleeper's `traded_picks` lists only picks that have changed hands — an untraded
 * pick isn't in it at all — so a roster's real portfolio is the whole pick grid
 * for the seasons in play, with the traded rows overriding who holds each cell.
 * Ported whole from TheLabX with its tests; {@link leagueRosterPicks} is this
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
 * A stored draft with the columns slot naming reads on top of what the grid
 * needs: the draft's `type` (an auction's "order" is nomination order, not a
 * pick order; a snake's board flips), its raw `draft_order` blob (user id →
 * slot, null until the league sets one), and the two `settings` numbers the
 * snake flip pivots on — `teams`, the board's width, and `reversal_round`,
 * Sleeper's third-round reversal. {@link dynastyPickGrid} takes the narrower
 * type and ignores all four.
 */
export type LeagueDraftRow = LeagueDraft & {
  type: string | null;
  draft_order: Record<string, unknown> | null;
  teams: number | null;
  reversal_round: number | null;
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
   * Exactly how deep every future draft runs, from the league's own
   * `settings.draft_rounds`. When set it wins over both floor readings below:
   * a traded pick deeper than it is a relic of a deeper era — the league
   * shrank its drafts after the trade — not evidence of a round that exists.
   */
  rounds: number | null;
  /**
   * A floor on the round count, from the league's own rookie draft. The grid
   * still runs as deep as any traded pick proves it does, so this only matters
   * where a season's picks have never moved — and not at all under `rounds`.
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
 * Depth is `settingsRounds` where the league states one — `settings.draft_rounds`
 * is the setting future drafts are actually created from, so it is exact and
 * current where a measured draft is history. `minRounds` is the fallback, the
 * startup exclusion read for depth: the most recent rookie draft is how many
 * rounds every future one runs. An inaugural league that has only run its
 * startup has no rookie draft to measure and reports null — its 15-to-25-round
 * startup is not the shape of next May.
 *
 * Returns null for a season that isn't a year, which reads as "no window" and
 * leaves the caller on the derived grid.
 */
export function dynastyPickGrid(
  leagueSeason: string,
  drafts: readonly LeagueDraft[],
  previousLeagueId: string | null,
  settingsRounds: number | null = null,
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
    // A zero from a junk blob is no depth at all, not a zero-round draft.
    rounds: settingsRounds !== null && settingsRounds >= 1 ? settingsRounds : null,
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
 * The **rounds** run 1..the grid's exact `rounds` where it carries one — the
 * league's own setting, which a traded row can neither deepen nor shrink, so a
 * pick from a since-shrunk era falls off the board the way it fell out of the
 * draft. Otherwise 1..the deepest round anyone has traded, or the grid's
 * `minRounds` where that is deeper: Sleeper doesn't publish a round count for a
 * draft that hasn't been created yet, and every future draft in a league runs
 * the same number, so a traded pick and the last rookie draft are the two lower
 * bounds the data carries. A league offering none of the three under-reports
 * the tail — better than inventing rounds that may not exist.
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
  const maxRound = grid?.rounds ?? Math.max(tradedDepth, grid?.minRounds ?? 0);
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

/**
 * Identity as `league_users` stores it. An acquired pick's origin is named from
 * `display_name` — a username names a *person*, which is what "from" means —
 * while the teams pane prefers `team_name`, the way Sleeper labels a league's
 * teams; `leagueTeamName` in `league-teams` is that rule's one spelling.
 */
export type LeagueUserName = {
  user_id: string;
  display_name: string | null;
  team_name: string | null;
};

/** Everything {@link leagueRosterPicks} reads off one league's stored graph. */
export type PickLeague = {
  /** `settings.type`, already guarded and cast — see `LEAGUE_TYPE_SQL`. */
  league_type: number;
  /**
   * `settings.draft_rounds`, guarded and cast: how deep the league's future
   * drafts run. Null where Sleeper sent nothing parseable.
   */
  draft_rounds: number | null;
  previous_league_id: string | null;
  traded_picks: readonly TradedPick[];
  drafts: readonly LeagueDraftRow[];
  users: readonly LeagueUserName[];
  rosters: readonly PickRoster[];
};

/**
 * One draft-order value as a slot, guarded like every numeric read off a
 * Sleeper blob — junk in one league's order must read as "no slot", not break
 * the league.
 */
const asSlot = (raw: unknown): number | null => {
  const slot =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^[0-9]+$/.test(raw)
        ? Number(raw)
        : NaN;
  return Number.isInteger(slot) && slot >= 1 ? slot : null;
};

/**
 * One season's chosen draft as slot naming reads it: each roster's slot in the
 * order, plus the board shape that turns a slot into a pick-in-round —
 * {@link snakePickInRound} is that turn.
 */
type SeasonDraftBoard = {
  /** Roster id → its owner's slot in the draft order. */
  slots: Map<number, number>;
  /** Whether the board flips on its reversed rounds. */
  snake: boolean;
  /**
   * How many teams the board is wide — what a reversed round flips a slot
   * around. Null where a snake draft offers no evidence of its width, which
   * names no pick rather than an unflipped one.
   */
  width: number | null;
  /** Sleeper's `settings.reversal_round` (third-round reversal), if any. */
  reversalRound: number | null;
};

/**
 * The pick-in-round a draft slot lands on in a snake draft's given round.
 *
 * Odd rounds run the order forward and even rounds flip it (`teams + 1 − slot`)
 * — except under Sleeper's reversal setting, where round R repeats round R−1's
 * direction before the alternation resumes: with third-round reversal, rounds
 * 2 and 3 both run backward and round 4 is forward again. A slot off the board
 * entirely names nothing rather than arithmetic on a junk order.
 */
export function snakePickInRound(
  slot: number,
  round: number,
  teams: number,
  reversalRound: number | null,
): number | null {
  if (slot < 1 || slot > teams) return null;
  const reversed =
    reversalRound !== null && reversalRound >= 2 && round >= reversalRound
      ? // Same direction as round R−1 while the offset from R is even.
        ((reversalRound - 1) % 2 === 0) === ((round - reversalRound) % 2 === 0)
      : round % 2 === 0;
  return reversed ? teams + 1 - slot : slot;
}

/**
 * Where each roster picks in one season's draft, or null while there is no
 * order to read. TheLabX answers this in SQL (`getDraftSlots`) because its
 * trades board names picks across a few hundred leagues and wants a cache tier;
 * here the league read already carries the draft rows, so the same decisions
 * are composed in TypeScript instead:
 *
 * - the order is read through `draft_order` (user → slot) joined back to
 *   rosters by owner — a roster whose owner has left resolves to nothing,
 *   which is the honest answer rather than a guessed slot;
 * - the season's draft is chosen **before** its order is looked at, so an
 *   unordered rookie draft reports nothing rather than falling through to the
 *   startup above it;
 * - an auction has no slots at all — its `draft_order` is not a pick order;
 * - the latest draft in a season wins (an inaugural league runs a startup and
 *   a rookie draft under one label), an undated stray last;
 * - a snake board's width is `settings.teams`, or failing that the deepest
 *   slot anyone holds in the raw order — the whole blob, because a departed
 *   user's slot still proves the board runs that wide where the roster join
 *   above would lose it.
 */
function seasonDraftSlots(
  drafts: readonly LeagueDraftRow[],
  season: string,
  rosters: readonly PickRoster[],
): SeasonDraftBoard | null {
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
    const slot = asSlot(order[roster.owner_id]);
    if (slot !== null) slots.set(roster.roster_id, slot);
  }

  let width = chosen.teams !== null && chosen.teams >= 1 ? chosen.teams : null;
  if (width === null) {
    for (const raw of Object.values(order)) {
      const slot = asSlot(raw);
      if (slot !== null && (width === null || slot > width)) width = slot;
    }
  }

  return {
    slots,
    snake: chosen.type === "snake",
    width,
    reversalRound: chosen.reversal_round,
  };
}

/** A board's pick-in-round for one slot — the identity, or the snake flip. */
function boardPickInRound(
  board: SeasonDraftBoard,
  slot: number,
  round: number,
): number | null {
  if (!board.snake) return slot;
  if (board.width === null) return null;
  return snakePickInRound(slot, round, board.width, board.reversalRound);
}

/**
 * Every roster's future draft picks in one league, named for the card, keyed
 * by owning roster id.
 *
 * {@link ownedDraftPicks} lays the grid — resolved through
 * {@link dynastyPickGrid} for a dynasty league, derived from the trades for
 * every other format. Each pick then carries the two facts Sleeper names one
 * by: its `slot`, read off that season's draft order through the *original*
 * roster's owner and flipped on the rounds a snake draft reverses (the
 * pick-in-round is where the pick actually falls), and `from`, the
 * original owner's name — only where the pick was acquired, because a roster's
 * own pick has no origin worth printing. `from` is relative to the owning
 * roster: the same asset is "from Slim" in one portfolio and origin-less in
 * the portfolio it came out of.
 *
 * A roster owning nothing is absent from the map — as is every roster in a
 * league whose grid comes out empty (a redraft league, or a dynasty with no
 * measured depth and no traded pick) — and the caller reads absence as `[]`.
 */
export function leagueRosterPicks(
  league: PickLeague,
  season: string,
  /**
   * What a resolved pick is worth, or null where nothing prices it.
   *
   * A callback rather than a board and a superflex flag, so this module keeps
   * knowing only *which* picks a roster owns. Pricing one means reading a KTC
   * row against the league's market and QB board and the third of the round the
   * slot falls in, and none of that is a fact about ownership; `./league-teams`
   * holds those three and passes the answer back in. Omitted, every pick ships
   * unpriced, which is what the payload's `value: null` already means.
   */
  priceOf?: (pick: { season: string; round: number; slot: number | null }) => number | null,
): Map<number, RosterPick[]> {
  const grid =
    league.league_type === DYNASTY_LEAGUE_TYPE
      ? dynastyPickGrid(
          season,
          league.drafts,
          league.previous_league_id,
          league.draft_rounds,
        )
      : null;
  const owned = ownedDraftPicks(
    league.traded_picks,
    league.rosters.map((r) => r.roster_id),
    season,
    grid,
  );

  const names = new Map(league.users.map((u) => [u.user_id, u.display_name]));
  const owners = new Map(league.rosters.map((r) => [r.roster_id, r.owner_id]));
  const originName = (rosterId: number): string => {
    const owner = owners.get(rosterId);
    const name = owner === null || owner === undefined ? null : names.get(owner);
    // An orphan origin or a member the sync never saw still names the asset —
    // "Roster 7's pick" is a fact where a username would be a guess.
    return name?.trim() || `Roster ${rosterId}`;
  };

  // One order read per season for the whole league, not per portfolio.
  const boardsBySeason = new Map<string, SeasonDraftBoard | null>();
  const boardFor = (pickSeason: string): SeasonDraftBoard | null => {
    let board = boardsBySeason.get(pickSeason);
    if (board === undefined) {
      board = seasonDraftSlots(league.drafts, pickSeason, league.rosters);
      boardsBySeason.set(pickSeason, board);
    }
    return board;
  };

  const named = new Map<number, RosterPick[]>();
  for (const [rosterId, picks] of owned) {
    named.set(
      rosterId,
      picks.map((pick) => {
        const board = boardFor(pick.season);
        const slot = board?.slots.get(pick.original_roster_id);
        const named = {
          season: pick.season,
          round: pick.round,
          slot:
            board && slot !== undefined
              ? boardPickInRound(board, slot, pick.round)
              : null,
        };
        return {
          ...named,
          from:
            pick.original_roster_id === rosterId
              ? null
              : originName(pick.original_roster_id),
          // Priced off the *resolved* slot rather than the raw draft order,
          // because that slot is where the pick actually falls — a snake
          // draft's reversal turns an early 1st into a late 2nd, and KTC
          // prices the two differently.
          value: priceOf?.(named) ?? null,
        };
      }),
    );
  }
  return named;
}
