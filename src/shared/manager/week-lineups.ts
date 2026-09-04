/**
 * Solving one league's week: what the lineup as set projects, what the best
 * lineup still reachable projects, and which seats kickoff order wants swapped.
 *
 * Pure — the caller supplies the league row (see `./queries`), the folded week
 * board (see `projections/week-read`), the lock set and the kickoff instants —
 * so every rule below tests without a database or a fetch. Runtime imports are
 * relative with `.ts` for the usual reason: Node's test runner strips types but
 * doesn't know the `@/*` aliases.
 *
 * It decides almost nothing itself, which is the point. `compareLineup` answers
 * *who* should start, `orderLineupByKickoff` answers who should sit *where*, and
 * this is the join between them and the wire. What it does own is the one thing
 * neither can see: which of a roster's players are candidates at all, and how a
 * missing projection is priced.
 */

import type {
  LineupCheckLeague,
  LineupCheckPlayer,
  LineupCheckSeat,
} from "@/shared/contract";

import {
  kickoffMoves,
  orderLineupByKickoff,
} from "../projections/kickoff-order.ts";
import type { KickoffPlayer } from "../projections/kickoff-order.ts";
import { compareLineup } from "../projections/optimal.ts";
import type { RosterPlayer } from "../projections/optimal.ts";
import { scoreStatLine } from "../projections/score.ts";
import type { WeekProjections } from "../projections/week.ts";

/** What one league contributes to the week's solve. */
export type WeekLineupLeague = {
  league_id: string;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  best_ball: boolean;
  roster_id: number;
  /** Sleeper's array, positional against the starting slots; `"0"` is empty. */
  starters: string[] | null;
  /** The roster, Sleeper's padded entries included. */
  players: string[] | null;
  as_of: "week" | "current";
  /**
   * Who they play this week and what that roster is starting, or null where the
   * week has no scheduled opponent — see `getManagerWeekLineups`, which reads
   * the other half of the same `matchups` pairing.
   */
  opponent: WeekLineupOpponent | null;
};

/**
 * The other half of a scheduled game.
 *
 * Declared here rather than beside the query for the reason `RankLeague` is:
 * this module is the one that *consumes* it, and it is pure, so the shape it
 * needs is the shape a caller has to hand it — a test included.
 */
export type WeekLineupOpponent = {
  roster_id: number;
  /** The week's own lineup where one is stored, else the roster's live one. */
  starters: string[] | null;
  players: string[] | null;
};

/**
 * One league's week, solved.
 *
 * **Null when the league cannot be answered for** — no `roster_positions` on
 * file, which is a league whose lineup was never read — because a gap quoted
 * against slots we don't have is not a smaller answer, it is a wrong one. The
 * route drops those from the payload, where a reader sees a league that says
 * nothing rather than a league that says zero.
 *
 * `kickoffs` is null where there is nothing honest to order against: a week the
 * schedule publishes no instants for, or a read that failed. It travels to
 * `kickoff_moves` as null — "no answer", never "already in order".
 */
export function solveWeekLineup(
  league: WeekLineupLeague,
  board: WeekProjections,
  locked: ReadonlySet<string>,
  kickoffs: ReadonlyMap<string, number> | null,
): LineupCheckLeague | null {
  const positions = league.roster_positions;
  if (!positions || positions.length === 0) return null;

  const starters = league.starters ?? [];

  // The candidate pool is the roster *and* whoever is starting: Sleeper's two
  // arrays can disagree for a moment after a move, and a starter missing from
  // `players` must still be priced — dropping him would credit the lineup with
  // one fewer player than it is actually fielding. Padding entries are not
  // players; a repeated id must not be seated twice.
  const rostered = [
    ...new Set([...(league.players ?? []), ...starters]),
  ].filter((id) => id && id !== "0");

  const priced = rostered.map((id) => {
    const line = board[id];
    const player: LineupCheckPlayer = {
      player_id: id,
      name: line?.name ?? null,
      positions: line?.positions ?? [],
      // Null only where the feed has no row at all. A row with no game scores a
      // real zero — see the contract, and `./week` for why the row is kept.
      points: line ? scoreStatLine(line.stats, league.scoring_settings) : null,
      team: line?.team ?? null,
      kickoff: kickoffFor(line?.team ?? null, kickoffs),
      locked: locked.has(id),
    };
    return player;
  });

  const byId = new Map(priced.map((p) => [p.player_id, p]));

  // The solver reads one number per player, and an unprojected player is a real
  // zero to it: he can only ever fill a seat nobody else wanted, which is the
  // honest ordering, and dropping him would overstate what the current lineup
  // is scoring — the one thing this tool must get right.
  const pool: RosterPlayer[] = priced.map((p) => ({
    player_id: p.player_id,
    positions: p.positions,
    points: p.points ?? 0,
  }));

  const comparison = compareLineup({
    rosterPositions: positions,
    starters,
    players: pool,
    locked,
    bestBall: league.best_ball,
  });

  // Best ball has no seat order to set — Sleeper seats it after the games — so
  // there is no ordering to ask for, exactly as there is no gap to report.
  const ordered =
    league.best_ball || !kickoffs
      ? null
      : orderLineupByKickoff({
          lineup: comparison.current,
          players: comparison.current.flatMap((seat): KickoffPlayer[] => {
            const player = seat.player_id ? byId.get(seat.player_id) : undefined;
            return player
              ? [
                  {
                    player_id: player.player_id,
                    positions: player.positions,
                    kickoff: player.kickoff,
                  },
                ]
              : [];
          }),
          locked,
        });

  // Derived once, here: the count below and the per-seat marks above it read
  // one ordering through one function, so they cannot disagree.
  const moves = ordered ? kickoffMoves(comparison.current, ordered) : null;
  const moveTo = new Map(moves?.map((m) => [m.player_id, m.to]) ?? []);

  const lineup: LineupCheckSeat[] = comparison.current.map((seat) => ({
    slot: seat.slot,
    player: seat.player_id ? (byId.get(seat.player_id) ?? null) : null,
    move_to: seat.player_id ? (moveTo.get(seat.player_id) ?? null) : null,
  }));

  const seated = new Set(
    comparison.current.map((seat) => seat.player_id).filter(Boolean),
  );
  const bench = priced
    .filter((p) => !seated.has(p.player_id))
    // The same key the solver seated by, so the bench reads as the queue for
    // the lineup rather than a second opinion; ties on id for a stable page.
    .sort(
      (a, b) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        a.player_id.localeCompare(b.player_id),
    );

  return {
    roster_id: league.roster_id,
    best_ball: league.best_ball,
    as_of: league.as_of,
    current_points: comparison.current_points,
    opponent_points: league.opponent
      ? currentLineupPoints(league, league.opponent, board)
      : null,
    optimal_points: comparison.optimal_points,
    points_left: comparison.points_left,
    start: comparison.start,
    sit: comparison.sit,
    kickoff_moves: moves === null ? null : moves.length,
    lineup,
    bench,
    unknown_slots: comparison.unknown_slots,
  };
}

/**
 * What another roster's lineup as set projects, on this league's own scoring.
 *
 * **The whole comparison rather than a sum over the starters**, which looks
 * like waste and is not: `compareLineup` drops slots this build doesn't
 * recognise from both lineups, so a bare sum would price the opponent's whole
 * lineup against a manager's that had a seat taken out of it — and the plate
 * would read as a loss caused by nothing but an unfamiliar slot name. One
 * function, two rosters, one set of rules.
 *
 * It is the *current* lineup and never the optimal one, except in best ball,
 * where Sleeper seats after the games and the optimal lineup is what the
 * opponent will actually score — which is what `compareLineup` already answers
 * there for both sides.
 *
 * An unprojected player is a real zero here, exactly as he is above: he can
 * only fill a seat nobody else wanted, and dropping him would understate what
 * the opponent is fielding.
 */
function currentLineupPoints(
  league: WeekLineupLeague,
  opponent: WeekLineupOpponent,
  board: WeekProjections,
): number {
  const starters = opponent.starters ?? [];
  const rostered = [
    ...new Set([...(opponent.players ?? []), ...starters]),
  ].filter((id) => id && id !== "0");

  const pool: RosterPlayer[] = rostered.map((id) => {
    const line = board[id];
    return {
      player_id: id,
      positions: line?.positions ?? [],
      points: line ? scoreStatLine(line.stats, league.scoring_settings) : 0,
    };
  });

  return compareLineup({
    rosterPositions: league.roster_positions ?? [],
    starters,
    players: pool,
    bestBall: league.best_ball,
  }).current_points;
}

/** A player's kickoff, or null where his team or the week's schedule is unknown. */
function kickoffFor(
  team: string | null,
  kickoffs: ReadonlyMap<string, number> | null,
): number | null {
  if (team === null || !kickoffs) return null;
  return kickoffs.get(team) ?? null;
}
