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

import { optimalLineup, round, startingSlots } from "../projections/optimal.ts";
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
 * One roster, seated and priced live.
 *
 * **Two ways to seat it, and which one is the league's own rule.** A managed
 * league is seated exactly as `compareLineup` pairs it: every starting slot is
 * walked in order, a slot this build does not recognise drops the same index
 * from `starters`, and Sleeper's `"0"` is an empty seat. Two spellings of that
 * walk would be two lineups drawn from one array.
 *
 * **A best-ball league has no lineup as set**, and reading one off `starters`
 * was this file's own bug: Sleeper seats such a team itself, from the whole
 * roster, after the games are played, so that array holds whatever the draft
 * left behind and the numbers a card drew from it were a lineup nobody will
 * ever be scored on. It is solved instead — `optimalLineup`, the app's one
 * lineup solver, over every rostered player, which is `compareLineup`'s own
 * `bestBall` arm reached directly because that function's other half (a gap
 * against a lineup somebody set) is the question this tool does not ask.
 * Flex, superflex and dual eligibility are that solver's, and so is the
 * guarantee that nobody fills two seats.
 *
 * **It is seated by `live`, and the choice is the reading rather than a
 * convenience.** Sleeper will seat this roster by what each player *finally*
 * scores, which nobody knows yet; a player's live figure is precisely this
 * app's best estimate of that number, so the lineup it produces is the best
 * estimate of the lineup that will be scored, and its total is the best
 * estimate of the total. Before kickoff every live figure is the projection
 * whole, so the two agree; they part company as games are played, which is
 * exactly what a live page is for. Seating each of the three totals by its own
 * metric was the alternative and it breaks the contract's own invariant —
 * three different lineups cannot all add up to the three figures on one plate.
 *
 * The bench is the roster less the seated — the checker's own candidate rule,
 * for its reason: Sleeper's two arrays can disagree for a moment after a move,
 * and a starter missing from `players` must still be priced.
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
  // Priced once each: a best-ball roster is read twice over (into the solver's
  // pool, then back out of its seats) and a player Sleeper lists in both
  // arrays is one player.
  const priced = new Map<string, PricedPlayer>();
  const price = (id: string): PricedPlayer => {
    const held = priced.get(id);
    if (held) return held;
    const fresh = pricePlayer(id, league, boards);
    priced.set(id, fresh);
    return fresh;
  };

  const rostered = [...new Set([...(players ?? []), ...starters])].filter(
    (id): id is string => Boolean(id) && id !== "0",
  );

  const lineup: GametimeSeat[] = [];
  const phases: (SeatPhase | null)[] = [];
  const seated = new Set<string>();

  const seat = (slot: string, playerId: string | null) => {
    if (playerId) seated.add(playerId);
    const held = playerId ? price(playerId) : null;
    lineup.push({ slot, player: held?.player ?? null });
    phases.push(held?.phase ?? null);
  };

  if (league.best_ball) {
    const known = slots.filter((slot) => slot in SLOT_POSITIONS);
    const pool = rostered.map((id) => {
      const held = price(id);
      return {
        player_id: id,
        positions: held.player.positions,
        // A player with nothing to price from can only ever take a seat
        // nobody else wanted, which is `solverPool`'s own reading one file
        // over.
        points: held.player.live ?? 0,
      };
    });
    for (const filled of optimalLineup(known, pool)) {
      seat(filled.slot, filled.player_id);
    }
  } else {
    slots.forEach((slot, i) => {
      if (!(slot in SLOT_POSITIONS)) return;
      const id = starters[i];
      seat(slot, id && id !== "0" ? id : null);
    });
  }

  const bench = rostered
    .filter((id) => !seated.has(id))
    .map((id) => price(id).player)
    .sort(
      (a, b) =>
        (b.live ?? -1) - (a.live ?? -1) || a.player_id.localeCompare(b.player_id),
    );

  const status = sideStatus(phases);

  return {
    roster_id: rosterId,
    team_name: teamName,
    ...sideTotals(lineup),
    status,
    // **Two populations, and which one is the same rule the seating is.** A
    // managed lineup is what will be scored, so its seats are the whole of
    // what is in play and `status.live` already counts them. A best-ball team
    // has no lineup as set — Sleeper seats it after the games, from the whole
    // roster — so every rostered player is one it may yet seat, and counting
    // the solved seats would leave a bench player whose game is running out of
    // a reading that exists to say whether there is anything to watch. Every
    // rostered id is priced by now in either path and `price` memoises, so the
    // walk costs nothing; the branch is the rule rather than an optimisation.
    players_in_play: league.best_ball
      ? rostered.reduce((n, id) => n + (isInPlay(price(id).phase) ? 1 : 0), 0)
      : status.live,
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
    else if (isInPlay(phase)) status.live += 1;
    else status.pending += 1;
  }
  return status;
}

/**
 * Whether a game is running behind a seat or a player, right now.
 *
 * One spelling, because two readings count by it: this is `sideStatus`' `live`
 * arm and it is also {@link GametimeSide.players_in_play}'s whole predicate. A
 * scoreboard nobody could read is included on the same reasoning the pricing
 * uses — a stat line means his game has at least started — so the count and
 * the figure beside it on the card degrade together rather than one of them
 * going quietly to zero.
 */
function isInPlay(phase: SeatPhase | null): boolean {
  return phase === "live" || phase === "unknown-started";
}

/** One player's three figures and the phase his game is in. */
type PricedPlayer = { player: GametimePlayer; phase: SeatPhase };

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
 * **A stats feed that is down does not spend the clock**, and telling that
 * apart from a healthy feed with no row for one player is the distinction the
 * whole degraded path turns on. The formula's first term is what a player has
 * *realised* of his projection, and the second is what is left of it; with no
 * feed the first term is not zero but *unknown*, so charging him the elapsed
 * clock would price a twenty-point back at ten by halftime on the arithmetic
 * that he had scored nothing — a wrong number rather than a missing one, and
 * one that would go on falling as the afternoon wore on. So `remaining` is
 * held at `1` and `live` is the projection whole, which is what the page's own
 * note ("showing the projections until Sleeper answers") already promises. A
 * *healthy* feed with no row for him is unchanged: that is a real zero once
 * his game is running, and the clock applies as it always did.
 *
 * The phase is untouched by any of it — how much of the week is still in play
 * is a fact about the scoreboard, not about whether we can read a stat line.
 *
 * `live` is null only where there is nothing at all to price from.
 */
function pricePlayer(
  id: string,
  league: WeekLineupLeague,
  boards: GametimeBoards,
): PricedPlayer {
  const proj = boards.projections[id];
  const stat = boards.stats?.[id];
  const identity = proj ?? stat;
  const team = proj?.team ?? stat?.team ?? null;

  const clocks = boards.clocks;
  const game = clocks && team !== null ? (clocks.get(team) ?? null) : null;

  const projected = proj ? scoreStatLine(proj.stats, league.scoring_settings) : null;

  const statsDown = boards.stats === null;

  let scored: number | null;
  if (stat) scored = scoreStatLine(stat.stats, league.scoring_settings);
  else if (statsDown) scored = null;
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

  // See the note above: with no stats feed nothing is known to have been
  // realised, so nothing of the projection may be spent.
  const share = statsDown ? 1 : remaining;

  const live =
    projected === null && scored === null
      ? null
      : round((scored ?? 0) + (projected ?? 0) * share);

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
