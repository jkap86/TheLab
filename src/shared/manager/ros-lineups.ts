/**
 * Solving one league's roster into rest-of-season starters and bench.
 *
 * Pure — the caller supplies the league rows (see `./queries`), the folded
 * projections board (see `projections/ros-read`) and the ADP map, so the
 * seating rules test without a database or a fetch. Runtime imports are
 * relative with `.ts` for the usual reason: Node's test runner strips types but
 * doesn't know the `@/*` aliases.
 *
 * **The ordering is projections first, draft capital second — literally.** The
 * solver maximises a single number per player, so the fallback is folded in as
 * `points + adpEntryValue · ADP_TIEBREAK`, with the scale chosen so the largest
 * possible ADP contribution (the peak, 10,000, times 1e-7 = 0.001) sits below
 * the 0.01 granularity projected points carry. A projected point can never be
 * outbid by draft capital; draft capital only decides among players whose
 * projections say nothing — the unprojected, and whole leagues when no
 * projections were read at all. That is the requested semantics ("fall back if
 * projected points aren't available") expressed as arithmetic rather than as a
 * second code path, which is what keeps one solve serving both.
 *
 * What travels to the reader is the *real* pair — `points` (null when
 * unprojected, not zero) and `adp_value` — never the composite, so the payload
 * cannot leak a tiebreak epsilon into a total.
 *
 * **KeepTradeCut is read onto the answer and never into the question.**
 * `ktc_value` is looked up per player and hung on the `LineupPlayer` the solve
 * already produced; it is not in `score` and must not become a third term in
 * it. The two that are there are a projection of what a player will *do* and,
 * failing that, of what the room thought of him at a draft — both statements
 * about production. A trade market is a statement about what a player is worth
 * to acquire, which is a different question, and letting it decide a seat would
 * bench a productive veteran under a rookie nobody can start. The KTC columns
 * report a roster's worth; they do not set its lineup.
 */

import type { LeagueLineup, LineupPlayer } from "@/shared/contract";

import { optimalLineup, recognisedSlots, round, startingSlots } from "../projections/optimal.ts";
import type { RosterPlayer } from "../projections/optimal.ts";
import { scoreStatLine } from "../projections/score.ts";
import type { RosProjections } from "../projections/ros.ts";
import { adpEntryValue, DEFAULT_STEEPNESS, leagueAdpPool } from "./adp-value.ts";
import type { AdpEntry } from "./adp-value.ts";

/** What one league contributes to the solve, for one of its rosters. */
export type RosLineupLeague = {
  league_id: string;
  total_rosters: number;
  roster_positions: string[] | null;
  scoring_settings: Record<string, number> | null;
  /** The solved roster's ids, Sleeper's padded entries included. */
  players: readonly string[];
};

/**
 * Scales an ADP value (≤ `ADP_PEAK` = 10,000) below the 0.01 that projected
 * points are rounded to — see the module note for why the two share one number.
 */
const ADP_TIEBREAK = 1e-7;

/**
 * One league's roster, seated. `projections` may be empty — a past season, or a
 * feed that failed — and then the whole solve runs on draft capital, which is
 * the fallback working rather than a degenerate case.
 *
 * `adp` is the player → {@link AdpEntry} map for the board matching this
 * league's superflex setting; the caller chooses it (see the route) because
 * which board a league reads is decided once, with `isSuperflexLineup`, not per
 * player. Each entry names the draft board its average came off — a rookie
 * draft's pick numbers are not overall picks — and {@link adpEntryValue} is what
 * puts the two on one scale.
 *
 * `ktc` is the same arrangement one market over: the player → KeepTradeCut
 * price map for the league's resolved format and QB board, already narrowed by
 * the caller for the same reason. An absent id is unpriced and stays null — see
 * the module note for why it never joins the ordering. It needs no equivalent
 * of {@link adpEntryValue}, because a KTC row is already a value rather than a
 * position on a board that has to be mapped onto another.
 */
export function solveLeagueLineup(
  league: RosLineupLeague,
  projections: RosProjections,
  adp: ReadonlyMap<string, AdpEntry>,
  ktc: ReadonlyMap<string, number> = new Map(),
): LeagueLineup {
  const positions = league.roster_positions ?? [];
  const pool = leagueAdpPool(league.total_rosters, league.roster_positions);

  // Dedup the roster the way `rosterAdpValue` does — Sleeper pads unfilled
  // slots with "" and "0", and a repeated id must not be seated twice.
  const rostered = [...new Set(league.players.filter((id) => id && id !== "0"))];

  const priced = rostered.map((id) => {
    const line = projections[id];
    const points =
      line && line.weeks.length > 0
        ? scoreStatLine(line.stats, league.scoring_settings)
        : null;
    const drafted = adp.get(id);
    const capital =
      drafted === undefined
        ? null
        : adpEntryValue(drafted, pool, DEFAULT_STEEPNESS);
    const player: LineupPlayer = {
      player_id: id,
      name: line?.name ?? null,
      positions: line?.positions ?? [],
      points,
      adp_value: capital,
      ktc_value: ktc.get(id) ?? null,
    };
    return { player, score: (points ?? 0) + (capital ?? 0) * ADP_TIEBREAK };
  });

  const solverPool: RosterPlayer[] = priced.map(({ player, score }) => ({
    player_id: player.player_id,
    positions: player.positions,
    points: score,
  }));

  const slots = recognisedSlots(positions);
  const unknown = [
    ...new Set(startingSlots(positions).filter((slot) => !slots.includes(slot))),
  ];

  const byId = new Map(priced.map((p) => [p.player.player_id, p]));
  const seated = optimalLineup(slots, solverPool);
  const seatedIds = new Set(seated.map((s) => s.player_id).filter(Boolean));

  const starters = seated.map((seat) => ({
    slot: seat.slot,
    player: seat.player_id ? (byId.get(seat.player_id)?.player ?? null) : null,
  }));

  const bench = priced
    .filter(({ player }) => !seatedIds.has(player.player_id))
    // The same key the solver seated by, so the bench reads as the queue for
    // the lineup rather than a second opinion; ties on id for a stable page.
    .sort(
      (a, b) =>
        b.score - a.score || a.player.player_id.localeCompare(b.player.player_id),
    )
    .map(({ player }) => player);

  const projected = round(
    starters.reduce((sum, seat) => sum + (seat.player?.points ?? 0), 0),
  );

  return {
    league_id: league.league_id,
    starters,
    bench,
    projected_points: projected,
    unknown_slots: unknown,
  };
}
