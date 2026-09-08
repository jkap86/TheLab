/**
 * Folding a span of weekly projection responses into one rest-of-season board.
 *
 * Pure and free of runtime imports beyond `./aggregate` — the caller fetches the
 * weeks (see `./ros-read`) and this decides what they add up to, so the folding
 * rules can be tested without a fetch.
 *
 * Two reads happen per row, and they deliberately differ in strictness:
 *
 * - **Stat lines count only from real projections.** The feed answers every
 *   player in the league, not every player with a game — a bye week or an
 *   unpublished projection arrives as a row with a null `game_id` and ADP
 *   placeholders in `stats` (see `SleeperProjection`). Summing those would fold
 *   draft metadata into a season total.
 * - **Identity is taken from any row at all.** A player the feed knows but
 *   projects nothing for still has a name and positions, and the lineup solve
 *   needs the positions to seat him by the fallback key — an unprojected player
 *   with no known position is eligible for no slot and can only ride the bench.
 * - **The team is taken from the latest real projection**, and this is the
 *   one reading that is neither of the two above. It is not stats — it does
 *   not sum — and it is not identity, because a no-game row leaves it null (the
 *   week fold makes the same call). Latest rather than first, because a player
 *   traded mid-span is on his new team by the last week that projects him, and
 *   compared by week number rather than by arrival so the fold stays a fact
 *   about the response and not about the order it came in.
 */

import { aggregateWeeklyStats } from "./aggregate.ts";
import type { PlayerWeekStats } from "./aggregate.ts";
import { isRealProjection, readPlayerIdentity } from "./identity.ts";
import type { SleeperProjection } from "../sleeper/types/sleeper.types.ts";

/** One player's summed rest-of-season projection, plus who they are. */
export type RosPlayerProjection = {
  player_id: string;
  /** Stat line summed across `weeks` — score with the league's own settings. */
  stats: Record<string, number>;
  /**
   * Weeks that contributed a real projection, ascending. **Empty means the
   * player has no projection at all** — the state the ADP fallback exists for —
   * where a short list is a bye or a partial horizon and the total still counts.
   */
  weeks: number[];
  name: string | null;
  /** Sleeper `fantasy_positions`; empty when the feed carries none. */
  positions: string[];
  /**
   * His NFL team, off the **latest** real projection in the span — a player
   * traded mid-season is on his new team by the last week that projects him,
   * and that is the team a rest-of-season reading should name. Null where no
   * real row named one: a no-game row carries no `team`, which is why it is
   * read on `isRealProjection`'s terms rather than identity's.
   */
  team: string | null;
};

/** Player id → their rest-of-season line, for every id the feed mentioned. */
export type RosProjections = Record<string, RosPlayerProjection>;

/** One fetched week: which week it was, and every row the feed sent for it. */
export type RosWeek = {
  week: number;
  rows: readonly SleeperProjection[];
};

/**
 * A fold in progress: weeks go in as they land, and `finish` sums them once.
 *
 * Exists so `./ros-read` can drop each week's raw response the moment it has
 * been read — a week is every player in the league with an inlined player
 * object, and holding all eighteen until the end was the span's peak memory.
 * What `add` keeps per real row is the stat line and the identity; the rest of
 * the row is the caller's to let go.
 */
export type RosFold = {
  add: (week: RosWeek) => void;
  /** Sum everything added so far into one board. Call once. */
  finish: () => RosProjections;
};

type Identity = { name: string | null; positions: string[] };

const isEmptyIdentity = (i: Identity) => i.name === null && i.positions.length === 0;

/**
 * Start a fold. **Order-independent by construction**: the weeks may arrive in
 * any order — a bounded fetch completes them out of sequence — and the board
 * must be a fact about the response rather than about the order it came in.
 * So the stat lines are bucketed by week and summed ascending, the identity is
 * the earliest week's non-empty one, and the team is the latest real week's,
 * each decided by week number rather than by arrival.
 */
export function createRosFold(): RosFold {
  const identity = new Map<string, Identity & { week: number }>();
  const teams = new Map<string, { week: number; team: string | null }>();
  const real = new Map<number, PlayerWeekStats[]>();

  const add = ({ week, rows }: RosWeek) => {
    let bucket = real.get(week);
    if (!bucket) {
      bucket = [];
      real.set(week, bucket);
    }

    for (const row of rows) {
      const id = row?.player_id;
      if (typeof id !== "string" || id === "") continue;

      // The earliest week's non-empty identity wins; an empty one is replaced
      // by any non-empty one from any week. Read only where it could change
      // the answer, which on an ascending arrival is the first row per id.
      const known = identity.get(id);
      if (!known || isEmptyIdentity(known) || week < known.week) {
        const next = readPlayerIdentity(row.player);
        if (!known || !isEmptyIdentity(next)) identity.set(id, { week, ...next });
      }

      // A null `game_id` is the feed's spelling of "no game this week"; its
      // `stats` are ADP placeholders, not a projected zero. The predicate lives
      // in `./identity` because `./week` folds the same feed and must agree.
      if (!isRealProjection(row)) continue;
      bucket.push({ player_id: id, week, stats: row.stats });

      const held = teams.get(id);
      if (!held || week >= held.week) {
        teams.set(id, { week, team: row.team ?? null });
      }
    }
  };

  const finish = (): RosProjections => {
    const aggregated = aggregateWeeklyStats(
      [...real.entries()]
        .sort(([a], [b]) => a - b)
        .flatMap(([, bucket]) => bucket),
    );

    const board: RosProjections = {};
    for (const [id, { name, positions }] of identity) {
      const line = aggregated[id];
      board[id] = {
        player_id: id,
        stats: line?.stats ?? {},
        weeks: line?.weeks ?? [],
        name,
        positions,
        team: teams.get(id)?.team ?? null,
      };
    }
    return board;
  };

  return { add, finish };
}

/**
 * Sum a span of weekly responses into one board.
 *
 * The summation itself is {@link aggregateWeeklyStats} — linear scoring is what
 * makes summing stats before scoring them exact — and this adds only the two
 * per-row judgements documented above: which rows are real projections, and
 * what identity to carry for ids that never have one. The whole-span form of
 * {@link createRosFold}, for a caller that already holds every week.
 */
export function assembleRosProjections(
  weeks: readonly RosWeek[],
): RosProjections {
  const fold = createRosFold();
  for (const week of weeks) fold.add(week);
  return fold.finish();
}
