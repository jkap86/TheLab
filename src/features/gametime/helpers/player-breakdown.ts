/**
 * Where a reader stands on one player: their leagues, in five groups.
 *
 * **Nothing reads this today, and it is kept deliberately** — on
 * `peekActiveSeason`'s terms, which is this repo's rule for a module whose
 * argument a later reader would otherwise have to reconstruct. The pane that
 * drew these groups now draws the player's own stat line and how it adds up,
 * and the counts it used to need are the fold's own; what is *not* stated
 * anywhere else is {@link seatIn}'s partition, and that rule is load-bearing
 * two components over: it is the whole reason the pane's four keys are
 * single-select where the ledge's four caps AND. A reader who deleted this
 * would delete the argument for a decision still in force.
 *
 * It is also the shape the league list comes back in, if a design ever wants
 * it beside the line rather than instead of it.
 *
 * The board's other half. The list answers *who is scoring what* and this
 * answers *where do I stand on this guy* — the two questions the drawer was
 * narrowed to, and the reason the box score came off it. A press on a row
 * names every league this account plays in and puts each one in exactly one
 * group: the ones the reader started him in, the ones they sat him in, the
 * ones where the manager across from them started or sat him, and the ones he
 * is in nobody's hands at all.
 *
 * Pure and under Node's own runner, for `stat-board.ts`' own reason and
 * `seat-compare.ts`' before it: a league filed under the wrong group, a slot
 * read off the wrong side, or a bench player counted as a starter all render a
 * perfectly ordinary list and say something untrue. The component beside this
 * owns the surfaces and nothing else.
 *
 * **Feature-local, on `features/shared`'s rule: one reader.** The lineup
 * checker's drawer answers the neighbouring question with `decisionsFor` —
 * which *pairings* a lineup made — and the two are different walks over the
 * same entries. If that page ever wants this one, it moves here whole.
 *
 * **It walks the entries rather than reading the fold's `leagues`.**
 * `WeekTwoSidedShare` already carries the named leagues behind each of the
 * four counts, which is most of what a breakdown needs and not all of it: a
 * row also names the *slot* he occupied, and a slot is a fact about the seat
 * he sat in rather than about the league. So the walk goes back to the seats,
 * and the fifth group — the leagues he is in neither side of — falls out of it
 * for free, being the entries no group claimed.
 */

import type {
  WeekLineupEntry,
  WeekShareSide,
} from "@/features/shared";
import type { ManagerLeague } from "@/shared/contract";

/**
 * Which of the five a league falls in.
 *
 * The order is the order the groups are drawn in, and it is the reader's own
 * half first: what they did with him, then what was done to them, then the
 * leagues with nothing to say. `none` last for the same reason it is drawn
 * quietest — it is the answer to a question nobody asked about a league.
 */
export type BreakdownGroupKey =
  | "start"
  | "bench"
  | "opp-start"
  | "opp-bench"
  | "none";

/** One league, and how it seated him. */
export type BreakdownRow = {
  league_id: string;
  /** The league's own name — what the row is read by. */
  league: string;
  /**
   * The manager across from the reader in that league, or null where none is
   * stored.
   *
   * **The opposing side's name in every group, the reader's own in none**,
   * which is the one thing about this row that reads backwards until it is
   * said: a breakdown is a list of *the reader's* leagues, so the name worth
   * printing beside each is who they are playing — `vs Corn Squad` where they
   * started him, `Corn Squad started him` where that manager did. Their own
   * team name is the same in all twelve rows and says nothing.
   *
   * The wording is the component's; what is decided here is which name.
   */
  rival: string | null;
  /**
   * The starting slot he occupied, `BN` on a bench, or null where he is in
   * neither side of that league.
   *
   * Null rather than an em dash, on this app's own grammar one layer down: the
   * dash is a *drawing* of an absence and belongs to the cell, and a helper
   * that returned one would be a string nothing could tell apart from a slot
   * Sleeper had actually named that.
   */
  slot: string | null;
};

/** One group, and the leagues in it. */
export type BreakdownGroup = {
  key: BreakdownGroupKey;
  rows: BreakdownRow[];
};

/** A bench seat has no slot name, and every group agrees on what to call it. */
export const BENCH_SLOT = "BN";

/** The five, in the order they are drawn — see {@link BreakdownGroupKey}. */
const GROUP_ORDER: readonly BreakdownGroupKey[] = [
  "start",
  "bench",
  "opp-start",
  "opp-bench",
  "none",
];

/**
 * Which group one league puts him in, and in which seat.
 *
 * **The manager's own side is asked first and a league is claimed once**,
 * which is what makes the five groups a partition rather than five overlapping
 * lists. He is on one roster per league, so the sides cannot both name him —
 * but a side that named him twice (Sleeper's own arrays occasionally do, and
 * `weekTwoSidedShares` guards the same case) must not put one league in two
 * groups, and asking in order is what settles it.
 *
 * **A starting seat beats a bench entry within one side** for the same reason
 * and the same way: a lineup naming him in a seat is the stronger statement.
 */
function seatIn(
  side: WeekShareSide | null,
  id: string,
): { started: boolean; slot: string } | null {
  if (!side) return null;
  for (const seat of side.lineup) {
    if (seat.player?.player_id === id) return { started: true, slot: seat.slot };
  }
  for (const player of side.bench) {
    if (player.player_id === id) return { started: false, slot: BENCH_SLOT };
  }
  return null;
}

/**
 * One player's week across the reader's leagues, grouped.
 *
 * Every entry lands in exactly one group and **every entry lands**: a league
 * the walk finds him in neither side of is the fifth group rather than a row
 * left out, because "he is not in this one" is an answer a reader scanning
 * twelve leagues wants told rather than inferred from a list that is shorter
 * than it should be.
 *
 * **A league with no opposing side can still reach the two opposing groups —
 * by not reaching them.** `seatIn` answers null for an absent side, so such a
 * league falls to `none` whenever the reader's own side does not hold him,
 * which is the honest reading: nobody who could be asked has him. It is the
 * absent-is-not-empty rule `WeekLineupEntry.opponent` is written by, arriving
 * here as the one branch that needs no special case.
 *
 * **Order is the entry list's**, which is the page's own league order — so a
 * reader's leagues come back in the same order inside every group and in the
 * same order as the grid behind the drawer.
 *
 * Empty groups are dropped, because a header over nothing is a claim that the
 * group is a state this player could have been in and happens not to be, which
 * is true of `You sat him` and daft under `Not in this league` on a player
 * everybody has.
 */
export function playerBreakdown(
  id: string,
  entries: readonly WeekLineupEntry[],
): BreakdownGroup[] {
  const groups = new Map<BreakdownGroupKey, BreakdownRow[]>(
    GROUP_ORDER.map((key) => [key, []]),
  );

  for (const entry of entries) {
    const mine = seatIn(entry.mine, id);
    const theirs = mine ? null : seatIn(entry.opponent, id);

    const key: BreakdownGroupKey = mine
      ? mine.started
        ? "start"
        : "bench"
      : theirs
        ? theirs.started
          ? "opp-start"
          : "opp-bench"
        : "none";

    groups.get(key)!.push({
      league_id: entry.league.league_id,
      league: leagueName(entry.league),
      // The opposing manager's, in every group — see `BreakdownRow.rival`.
      rival: entry.opponent?.team_name ?? null,
      slot: (mine ?? theirs)?.slot ?? null,
    });
  }

  return GROUP_ORDER.flatMap((key) => {
    const rows = groups.get(key)!;
    return rows.length > 0 ? [{ key, rows }] : [];
  });
}

/** A league's own name, else its id — a token beats a blank, as everywhere. */
function leagueName(league: ManagerLeague): string {
  return league.name || league.league_id;
}

/**
 * How many leagues the walk had to place — the breakdown's own denominator.
 *
 * The entries rather than the account's leagues, on `weekTwoSidedShares`'
 * `starter_league_count` rule: a league nothing could be read for is absent
 * rather than counted as one holding nobody, and a sentence saying `started 2
 * of 12` over a list of ten would be counting two different things.
 */
export function breakdownLeagueCount(
  entries: readonly WeekLineupEntry[],
): number {
  return entries.length;
}
