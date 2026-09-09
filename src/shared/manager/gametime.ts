/**
 * Solving one league's week **live**: what the lineup as set has scored, what
 * it is on course to score, and where each starter's game is.
 *
 * `./week-lineups`' sibling, and pure on its terms — the caller supplies the
 * league row, the folded projections board, the folded stats board and the
 * week's game clocks, so every rule below tests without a database or a
 * fetch. It seats nobody and moves nobody: the checker asks what a lineup
 * *should* be, and this asks what the lineup that was set is *doing*.
 *
 * **The live projection is one line and it is this file's whole reason:**
 *
 *     live = scored + projected × remaining
 *
 * where `remaining` is the share of the player's game still to be played
 * (`schedule/game-clock`). Before kickoff it is the projection whole, at the
 * final whistle it is what he scored, and in between it is what he has done
 * plus what he was expected to do in the time left. Every total on the wire is
 * a sum of that figure over the starters, so the seat rows add up to the plate.
 *
 * Both feeds are scored through the league's own `scoring_settings` by the same
 * `scoreStatLine` — its doc says it serves projections and played weeks alike,
 * because the rule is the same for both — so a projected point and a scored
 * point are the same unit on the same card.
 */

import type {
  GametimeGame,
  GametimeLeague,
  GametimePlayer,
  GametimeSeat,
  GametimeSide,
  GametimeStatus,
} from "@/shared/contract";

import { round, startingSlots } from "../projections/optimal.ts";
import { scoreStatLine } from "../projections/score.ts";
import { SLOT_POSITIONS } from "../projections/slots.ts";
import type { WeekProjections } from "../projections/week.ts";
import type { GameClock, GamePhase } from "../schedule/game-clock.ts";
import type { WeekLineupLeague, WeekLineupRoster } from "./week-lineups.ts";

/** What the solve reads beside the league row. */
export type GametimeBoards = {
  /** The week's projections, folded — `projections/week-read`. */
  projections: WeekProjections;
  /**
   * The week's stat lines, folded the same way, or **null where the feed could
   * not be read**. Null and an empty board are different answers: an empty
   * board is a week nobody has played yet, where null is a week this process
   * cannot see — and the solve prices the two differently, see
   * {@link pricePlayer}.
   */
  stats: WeekProjections | null;
  /**
   * Team → game clock, or null where the scoreboard could not be read. A team
   * absent from a non-null map is on a bye.
   */
  clocks: ReadonlyMap<string, GameClock> | null;
};

/**
 * One league's week, priced live — or null where the league cannot be
 * answered for (no `roster_positions` on file), on `solveWeekLineup`'s rule.
 */
export function solveGametimeLeague(
  league: WeekLineupLeague,
  boards: GametimeBoards,
): GametimeLeague | null {
  const positions = league.roster_positions;
  if (!positions || positions.length === 0) return null;

  const slots = startingSlots(positions);
  const unknown = [...new Set(slots.filter((slot) => !(slot in SLOT_POSITIONS)))];

  const mine = solveSide(
    league.roster_id,
    null,
    league.players,
    league.starters ?? [],
    slots,
    league,
    boards,
  );

  const opponent = league.opponent
    ? solveSide(
        league.opponent.roster_id,
        league.opponent.team_name,
        league.opponent.players,
        league.opponent.starters ?? [],
        slots,
        league,
        boards,
      )
    : null;

  return {
    roster_id: league.roster_id,
    best_ball: league.best_ball,
    as_of: league.as_of,
    mine,
    opponent,
    median: medianTotals(league, mine, slots, boards),
    unknown_slots: unknown,
  };
}

/**
 * One roster, seated as set and priced live.
 *
 * **The seats are paired exactly as `compareLineup` pairs them**: every
 * starting slot is walked in order, a slot this build does not recognise drops
 * the same index from `starters`, and Sleeper's `"0"` is an empty seat. Two
 * spellings of that walk would be two lineups drawn from one array.
 *
 * The bench is the roster and whoever is starting, less the seated — the
 * checker's own candidate rule, for its reason: Sleeper's two arrays can
 * disagree for a moment after a move, and a starter missing from `players`
 * must still be priced.
 */
function solveSide(
  rosterId: number,
  teamName: string | null,
  players: readonly string[] | null,
  starters: readonly string[],
  slots: readonly string[],
  league: WeekLineupLeague,
  boards: GametimeBoards,
): GametimeSide {
  const lineup: GametimeSeat[] = [];
  const phases: (SeatPhase | null)[] = [];
  const seated = new Set<string>();

  slots.forEach((slot, i) => {
    if (!(slot in SLOT_POSITIONS)) return;
    const id = starters[i];
    const playerId = id && id !== "0" ? id : null;
    if (playerId) seated.add(playerId);
    const priced = playerId ? pricePlayer(playerId, league, boards) : null;
    lineup.push({ slot, player: priced?.player ?? null });
    phases.push(priced?.phase ?? null);
  });

  const rostered = [...new Set([...(players ?? []), ...starters])].filter(
    (id) => id && id !== "0" && !seated.has(id),
  );
  const bench = rostered
    .map((id) => pricePlayer(id, league, boards).player)
    .sort(
      (a, b) =>
        (b.live ?? -1) - (a.live ?? -1) || a.player_id.localeCompare(b.player_id),
    );

  return {
    roster_id: rosterId,
    team_name: teamName,
    ...sideTotals(lineup),
    status: sideStatus(phases),
    lineup,
    bench,
  };
}

/**
 * Where a seat's game is, for the status count — the clock's phase, or the
 * reading the solve took where there was no clock: `none` is a bye (nothing
 * left to score) and `unknown` is a scoreboard nobody could read.
 */
type SeatPhase = GamePhase | "none" | "unknown-started" | "unknown-pending";

/** The three totals over a lineup's starters. An absent figure is a zero here. */
function sideTotals(
  lineup: readonly GametimeSeat[],
): Pick<GametimeSide, "scored" | "projected" | "live"> {
  let scored = 0;
  let projected = 0;
  let live = 0;
  for (const seat of lineup) {
    const player = seat.player;
    if (!player) continue;
    scored += player.scored ?? 0;
    projected += player.projected ?? 0;
    live += player.live ?? 0;
  }
  return { scored: round(scored), projected: round(projected), live: round(live) };
}

/**
 * The starters by game phase.
 *
 * An empty seat and a starter on a bye both count as `done`: there is nothing
 * left for that seat to score, which is what a reader scanning "how much of my
 * week is still in play" wants counted. A starter the scoreboard could not
 * place at all is read the way his projection is: a stat line means his game
 * has at least started (`live`), and no line means it has not (`pending`).
 */
function sideStatus(phases: readonly (SeatPhase | null)[]): GametimeStatus {
  const status: GametimeStatus = { done: 0, live: 0, pending: 0 };
  for (const phase of phases) {
    if (phase === null || phase === "none" || phase === "final") status.done += 1;
    else if (phase === "live" || phase === "unknown-started") status.live += 1;
    else status.pending += 1;
  }
  return status;
}

/**
 * One player, priced live.
 *
 * The three figures come from three sources and each has its own "no answer":
 *
 * - **`projected`** is the projections feed through the league's scoring, null
 *   where the feed has no row at all. A row with no game is a real zero — a
 *   bye — which is `priceRoster`'s reading one file over.
 * - **`scored`** is the stats feed through the same scoring. Null where his
 *   game has not started: nothing has happened yet, and a `0.0` there is a
 *   claim about a game nobody has played. A game that is running or over and
 *   has no line for him is a real zero. A stats feed that could not be read is
 *   null throughout, and the payload says so.
 * - **`remaining`** is his game's clock. A team on a bye has no game and
 *   nothing left, so his projection contributes nothing — which is right, since
 *   his projection is a bye's zero anyway. A scoreboard that could not be read
 *   answers `1` for a player with no stat line and **`0.5` for one with one**:
 *   a line means his game has at least started, and half is the reading with
 *   the least possible error against a clock nobody can see — the same fallback
 *   `remainingShare` takes for a running game that says nothing else.
 *
 * `live` is null only where there is nothing at all to price from.
 */
function pricePlayer(
  id: string,
  league: WeekLineupLeague,
  boards: GametimeBoards,
): { player: GametimePlayer; phase: SeatPhase } {
  const proj = boards.projections[id];
  const stat = boards.stats?.[id];
  const identity = proj ?? stat;
  const team = proj?.team ?? stat?.team ?? null;

  const clocks = boards.clocks;
  const game = clocks && team !== null ? (clocks.get(team) ?? null) : null;

  const projected = proj ? scoreStatLine(proj.stats, league.scoring_settings) : null;

  let scored: number | null;
  if (stat) scored = scoreStatLine(stat.stats, league.scoring_settings);
  else if (boards.stats === null) scored = null;
  else if (game && game.phase !== "pre") scored = 0;
  else scored = null;

  let remaining: number;
  let phase: SeatPhase;
  if (game) {
    remaining = game.remaining;
    phase = game.phase;
  } else if (clocks) {
    remaining = 0;
    phase = "none";
  } else {
    remaining = stat ? 0.5 : 1;
    phase = stat ? "unknown-started" : "unknown-pending";
  }

  const live =
    projected === null && scored === null
      ? null
      : round((scored ?? 0) + (projected ?? 0) * remaining);

  return {
    player: {
      player_id: id,
      name: identity?.name ?? null,
      positions: identity?.positions ?? [],
      team,
      projected,
      scored,
      live,
    },
    phase,
  };
}

/**
 * The scoreboard as the wire carries it: team → game, the clock's reading
 * restated one field at a time (no spread, so a field the pure module grows
 * does not leak onto the wire unnamed). Empty where there is no scoreboard.
 */
export function gameBoard(
  clocks: ReadonlyMap<string, GameClock> | null,
): Record<string, GametimeGame> {
  const board: Record<string, GametimeGame> = {};
  if (!clocks) return board;
  for (const [team, clock] of clocks) {
    board[team] = {
      phase: clock.phase,
      remaining: clock.remaining,
      quarter: clock.quarter,
      clock: clock.clock,
      overtime: clock.overtime,
      kickoff: clock.kickoff,
      opponent: clock.opponent,
      home: clock.home,
      score: clock.score,
    };
  }
  return board;
}

/**
 * The league's median, priced three ways, or null on `medianProjection`'s
 * exact terms: no median pool, or fewer than two rosters in it.
 *
 * The manager's own side is substituted rather than re-solved — one measurement,
 * so the plate and the median it is read against cannot disagree about the
 * manager's own lineup. Even pools take the mean of the two middle values, per
 * figure, which is Sleeper's own rule for a median matchup.
 */
function medianTotals(
  league: WeekLineupLeague,
  mine: GametimeSide,
  slots: readonly string[],
  boards: GametimeBoards,
): GametimeLeague["median"] {
  const pool = league.median_rosters;
  if (!pool || pool.length < 2) return null;

  const sides = pool.map((roster: WeekLineupRoster) =>
    roster.roster_id === league.roster_id
      ? mine
      : solveSide(roster.roster_id, null, roster.players, roster.starters ?? [], slots, league, boards),
  );

  return {
    scored: medianOf(sides.map((s) => s.scored)),
    projected: medianOf(sides.map((s) => s.projected)),
    live: medianOf(sides.map((s) => s.live)),
  };
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return round(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}
