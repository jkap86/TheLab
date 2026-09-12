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
import { irReading } from "./ir-eligibility.ts";
import type { PlayerStatusMap, RosterIds } from "./ir-eligibility.ts";

/** What one league contributes to the week's solve. */
export type WeekLineupLeague = {
  league_id: string;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  best_ball: boolean;
  /**
   * The league's own settings blob. Read here for `reserve_slots` and
   * `taxi_slots` — the census's two limits, which some leagues express only
   * here and others only as `IR`/`TAXI` entries in `roster_positions` — and
   * for the six `reserve_allow_*` toggles the IR reading judges designations
   * against (see `./ir-eligibility`). Null is a league whose settings were
   * never read, which the IR reading answers null for rather than guessing.
   */
  settings: Record<string, unknown> | null;
  roster_id: number;
  /** Sleeper's array, positional against the starting slots; `"0"` is empty. */
  starters: string[] | null;
  /** The roster, Sleeper's padded entries included. */
  players: string[] | null;
  /**
   * The **live** roster's three arrays, padding included — the census's whole
   * input. Separate from `players` above, which is the week's own roster where
   * one is stored: Sleeper keeps no historical `reserve` or `taxi`, so a census
   * mixing the week's roster with today's IR would be two grains in one figure.
   * See the contract's `roster_count` for why the census is a *now* question.
   */
  roster_players: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  as_of: "week" | "current";
  /**
   * Who they play this week and what that roster is starting, or null where the
   * week has no scheduled opponent — see `getManagerWeekLineups`, which reads
   * the other half of the same `matchups` pairing.
   */
  opponent: WeekLineupOpponent | null;
  /**
   * Every roster in the league for this week, for the median — or **null where
   * this league has no median matchup**, which is most of them.
   *
   * Null rather than an empty array, and the distinction is the usual one: an
   * empty pool is a median league whose other rosters are not stored, where
   * null is a league that never asked for one. Both draw no median bay, and
   * only one of them is a gap in the data.
   *
   * It is the *whole* league including the manager's own roster, because a
   * median is over every team. The manager's own figure is not re-solved from
   * it — see {@link medianProjection}.
   */
  median_rosters: WeekLineupRoster[] | null;
};

/**
 * One roster of the median pool: whose it is, and what it is starting.
 *
 * The same two arrays {@link WeekLineupOpponent} carries and deliberately not
 * that type: an opponent has a name, because a pane is headed with it, and a
 * roster in a median pool is a number in a sort. Naming it would be a field
 * nothing reads on every roster of every median league.
 */
export type WeekLineupRoster = {
  roster_id: number;
  /** The week's own lineup where one is stored, else the roster's live one. */
  starters: string[] | null;
  players: string[] | null;
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
  /**
   * What the opponent is called, on `leagueTeamName`'s rule — their username,
   * else the team name they set — resolved by the query, which is the half
   * that can see `league_users`. Null where no member row is stored for the
   * owner, which the pane draws as no name rather than as "Opponent".
   */
  team_name: string | null;
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
 *
 * `statuses` is the stored players map's injury designations for the live
 * roster's ids, or null where that read failed — which travels to `ir: null`,
 * "not checked", while the census beside it still answers. It defaults to null
 * so a caller that has no map to offer (a test of the solve alone) gets the
 * honest reading rather than an empty one, which would judge every player
 * unknown.
 */
export function solveWeekLineup(
  league: WeekLineupLeague,
  board: WeekProjections,
  locked: ReadonlySet<string>,
  kickoffs: ReadonlyMap<string, number> | null,
  statuses: PlayerStatusMap | null = null,
): LineupCheckLeague | null {
  const positions = league.roster_positions;
  if (!positions || positions.length === 0) return null;

  const starters = league.starters ?? [];
  // The live roster's three id sets, computed once and handed to both the
  // census and the IR reading, so the two count the same players by
  // construction — an `ir.reserve` one player longer than `ir_count` would be a
  // tile whose figure and whose names disagree.
  const live = liveRosterIds(league);

  const priced = priceRoster(
    league.players,
    starters,
    league,
    board,
    locked,
    kickoffs,
  );
  const byId = new Map(priced.map((p) => [p.player_id, p]));
  const pool = solverPool(priced);

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

  const bench = benchOf(priced, comparison.current);

  // Solved through the same `compareLineup` on the same board, so the figure on
  // the plate and the lineup the Opponents panel counts are one measurement.
  const opponent = league.opponent
    ? solveOpponentLineup(league, league.opponent, board, locked, kickoffs)
    : null;

  // The league's median, over the same board and the same comparison. The
  // manager's own figure is handed in rather than re-derived from the pool:
  // one measurement, so a plate reading `128.4` against a median that counted
  // `128.5` for the same lineup cannot happen.
  const median = medianProjection(
    league,
    comparison.current_points,
    board,
    locked,
  );

  return {
    roster_id: league.roster_id,
    best_ball: league.best_ball,
    as_of: league.as_of,
    current_points: comparison.current_points,
    opponent_points: opponent?.points ?? null,
    opponent_lineup: opponent?.lineup ?? null,
    opponent_bench: opponent?.bench ?? null,
    opponent_optimal_points: opponent?.optimal_points ?? null,
    // The name is the query's answer rather than this module's: only it can
    // see `league_users`, and `?? null` here would turn a missing member row
    // and a missing opponent into the same thing — which they are, for a pane
    // that draws neither.
    opponent_team_name: league.opponent?.team_name ?? null,
    median_points: median,
    optimal_points: comparison.optimal_points,
    points_left: comparison.points_left,
    start: comparison.start,
    sit: comparison.sit,
    kickoff_moves: moves === null ? null : moves.length,
    lineup,
    bench,
    ...rosterCensus(live, league.settings, positions),
    ir: irReading(live, league.settings, statuses, board),
    unknown_slots: comparison.unknown_slots,
  };
}

/**
 * The league's median projected score for the week, or null where there is
 * none to give.
 *
 * **Every roster, solved the same way the manager's was.** A median is a
 * statement about the whole league, so it cannot be read off the two rosters
 * a card already has — which is the one reason this needs the pool at all,
 * and why the query fetches it for median leagues and no others.
 *
 * Three decisions carry it:
 *
 * - **The manager's own figure is substituted, never re-solved.** It is in the
 *   pool by construction — a median is over every team including yours — and
 *   solving it a second time here would be a second spelling of the number
 *   printed beside it on the same plate. `compareLineup` is deterministic, so
 *   the two would agree today and be two chances to disagree after any edit.
 * - **The median is the middle of what could be projected**, not of the
 *   league's declared size. A partly-synced league answers over the rosters it
 *   has, which is honest; padding it to `total_rosters` would average a full
 *   board against a handful of teams.
 * - **Fewer than two rosters is no answer at all.** A "median" over one roster
 *   is that roster, which for the manager is a tie against themselves — a
 *   number that renders perfectly and means nothing. Null, and the plate draws
 *   one bay.
 *
 * Even pools take the mean of the two middle scores, which is Sleeper's own
 * rule for a median matchup and the only reading that does not favour one half
 * of an even league.
 *
 * The pool is priced with `compareLineup` and **not** with the kickoff order:
 * a median is what the league is projected to score, and where anybody's
 * flexes lock has no bearing on it. That is also what keeps this off the
 * schedule read, so a failed one costs the median nothing.
 */
function medianProjection(
  league: WeekLineupLeague,
  ownPoints: number,
  board: WeekProjections,
  locked: ReadonlySet<string>,
): number | null {
  const pool = league.median_rosters;
  if (!pool || pool.length < 2) return null;

  const scores = pool.map((roster) => {
    if (roster.roster_id === league.roster_id) return ownPoints;
    const starters = roster.starters ?? [];
    const priced = priceRoster(roster.players, starters, league, board, locked, null);
    return compareLineup({
      rosterPositions: league.roster_positions ?? [],
      starters,
      players: solverPool(priced),
      bestBall: league.best_ball,
    }).current_points;
  });

  scores.sort((a, b) => a - b);
  const mid = scores.length >> 1;
  return scores.length % 2 === 1
    ? scores[mid]
    : (scores[mid - 1] + scores[mid]) / 2;
}

/**
 * The roster census: what the league holds against what it allows.
 *
 * **Taxi and IR are counted against their own limits**, which is how Sleeper
 * enforces them — a taxi stash does not occupy an active roster spot, so
 * folding all three into one figure would report a legal roster as over.
 *
 * Two rules carry it, and both are the app's usual three-way grammar:
 *
 * - **A limit is null only where it cannot be answered**, never where it is
 *   zero. `roster_max` reads `roster_positions` — every seat except `IR` and
 *   `TAXI`, `BN` included, because a bench spot is a roster spot — so this
 *   solve always answers it: `solveWeekLineup` has already returned null for a
 *   league with no slots on file, which is the only way it could be unknown.
 *   It stays nullable on the wire all the same, because that is the state the
 *   tile draws its em dash for and a client must not have to know which
 *   producer filled it. The other two prefer `settings` and fall back to the
 *   seat count, because some leagues state them in one place and some in the
 *   other; a league with neither has **no** taxi squad, which is a real `0`.
 * - **Sleeper's padding is not a player.** `players`, `reserve` and `taxi` are
 *   stored verbatim, `""` and `"0"` entries included, so a raw `.length`
 *   overcounts. The active count is the roster less whatever is parked, since
 *   Sleeper lists a reserved or taxied player in `players` too. The three id
 *   sets arrive already cleaned — {@link liveRosterIds} — and are the same
 *   three the IR reading judges, which is what keeps `ir_count` and the
 *   reading's `reserve` list one population.
 */
function rosterCensus(
  live: RosterIds,
  settings: Record<string, unknown> | null,
  positions: readonly string[],
): Pick<
  LineupCheckLeague,
  "roster_count" | "roster_max" | "ir_count" | "ir_max" | "taxi_count" | "taxi_max"
> {
  const parked = new Set([...live.reserve, ...live.taxi]);

  const irSlots = positions.filter((slot) => slot === "IR").length;
  const taxiSlots = positions.filter((slot) => slot === "TAXI").length;

  return {
    roster_count: live.held.filter((id) => !parked.has(id)).length,
    roster_max: positions.length - irSlots - taxiSlots,
    ir_count: live.reserve.length,
    ir_max: settingCount(settings, "reserve_slots") ?? irSlots,
    taxi_count: live.taxi.length,
    taxi_max: settingCount(settings, "taxi_slots") ?? taxiSlots,
  };
}

/**
 * The live roster's three arrays, padding dropped and deduplicated — the one
 * reading of them the census and the IR check both take.
 */
function liveRosterIds(league: WeekLineupLeague): RosterIds {
  return {
    held: realIds(league.roster_players),
    reserve: realIds(league.reserve),
    taxi: realIds(league.taxi),
  };
}

/** One of Sleeper's player arrays with its slot padding dropped, deduplicated. */
function realIds(ids: readonly string[] | null): string[] {
  return [...new Set(ids ?? [])].filter((id) => id && id !== "0");
}

/**
 * A settings key read as a count, or null where the league does not state one.
 *
 * Sleeper omits the key entirely on a league that has none, and the caller
 * falls back to the seat count for exactly that reason — so "absent" has to
 * come back distinguishable from a stated zero, which is a league that
 * deliberately has no taxi squad.
 */
function settingCount(
  settings: Record<string, unknown> | null,
  key: string,
): number | null {
  const raw = settings?.[key];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * One roster, priced on this league's own scoring.
 *
 * **The candidate pool is the roster *and* whoever is starting**: Sleeper's two
 * arrays can disagree for a moment after a move, and a starter missing from
 * `players` must still be priced — dropping him would credit the lineup with
 * one fewer player than it is actually fielding. Padding entries are not
 * players; a repeated id must not be seated twice.
 *
 * Shared by both halves of a game, which is the point: the manager's roster and
 * the opponent's are the same kind of thing read from the same board, and two
 * spellings of "what is this player worth here" is two chances for the plate's
 * two figures to be measured differently.
 */
function priceRoster(
  players: readonly string[] | null,
  starters: readonly string[],
  league: WeekLineupLeague,
  board: WeekProjections,
  locked: ReadonlySet<string>,
  kickoffs: ReadonlyMap<string, number> | null,
): LineupCheckPlayer[] {
  const rostered = [...new Set([...(players ?? []), ...starters])].filter(
    (id) => id && id !== "0",
  );

  return rostered.map((id) => {
    const line = board[id];
    return {
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
  });
}

/**
 * The solver's view of a priced roster.
 *
 * An unprojected player is a real zero to it: he can only ever fill a seat
 * nobody else wanted, which is the honest ordering, and dropping him would
 * overstate what the current lineup is scoring — the one thing this tool must
 * get right.
 */
function solverPool(priced: readonly LineupCheckPlayer[]): RosterPlayer[] {
  return priced.map((p) => ({
    player_id: p.player_id,
    positions: p.positions,
    points: p.points ?? 0,
  }));
}

/** Everyone the lineup did not seat, best first; ties on id for a stable page. */
function benchOf(
  priced: readonly LineupCheckPlayer[],
  seats: readonly { player_id: string | null }[],
): LineupCheckPlayer[] {
  const seated = new Set(seats.map((seat) => seat.player_id).filter(Boolean));
  return priced
    .filter((p) => !seated.has(p.player_id))
    // The same key the solver seated by, so the bench reads as the queue for
    // the lineup rather than a second opinion.
    .sort(
      (a, b) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        a.player_id.localeCompare(b.player_id),
    );
}

/**
 * The other side of the game: what their lineup as set projects, who is in it,
 * and who is not.
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
 * **No `move_to` on any seat.** Kickoff order answers who should sit *where* in
 * a lineup somebody can still move, and this is not one of those; deriving it
 * anyway would put a swap mark on a lineup nobody reading this page can set.
 */
function solveOpponentLineup(
  league: WeekLineupLeague,
  opponent: WeekLineupOpponent,
  board: WeekProjections,
  locked: ReadonlySet<string>,
  kickoffs: ReadonlyMap<string, number> | null,
): {
  points: number;
  optimal_points: number;
  lineup: LineupCheckSeat[];
  bench: LineupCheckPlayer[];
} {
  const starters = opponent.starters ?? [];
  const priced = priceRoster(
    opponent.players,
    starters,
    league,
    board,
    locked,
    kickoffs,
  );
  const byId = new Map(priced.map((p) => [p.player_id, p]));

  const comparison = compareLineup({
    rosterPositions: league.roster_positions ?? [],
    starters,
    players: solverPool(priced),
    bestBall: league.best_ball,
  });

  return {
    points: comparison.current_points,
    // Already computed by the comparison above and previously discarded. The
    // week view prints it as the pane's `OPT` against the same pane's `SET`,
    // which is the one place on the page a reader can see that a lineup they
    // are losing to is itself not the best that roster could field.
    optimal_points: comparison.optimal_points,
    lineup: comparison.current.map((seat) => ({
      slot: seat.slot,
      player: seat.player_id ? (byId.get(seat.player_id) ?? null) : null,
      move_to: null,
    })),
    bench: benchOf(priced, comparison.current),
  };
}

/** A player's kickoff, or null where his team or the week's schedule is unknown. */
function kickoffFor(
  team: string | null,
  kickoffs: ReadonlyMap<string, number> | null,
): number | null {
  if (team === null || !kickoffs) return null;
  return kickoffs.get(team) ?? null;
}
