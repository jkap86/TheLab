/**
 * One week's shared reads, and the pure half of everything computed from them.
 *
 * **A snapshot rather than a cache.** Everything a League Details week answers
 * — the per-player projection column, every team's current-versus-optimal
 * lineup, the lock set behind both — is read off the *same* week of
 * `projections` and the *same* rows of `players`. Asked for per consumer, that
 * is the identical `listLineupWeekStats` running twice for one request and the
 * `players` table read twice more; asked for once and passed down, it is two
 * queries whoever reads them. Nothing here is remembered past the request: the
 * duplication being removed is *within* one answer, and a snapshot that
 * outlived it would be a per-league cache with no key that could say so.
 *
 * **`WeekProjectionInputs` holds reads, never derivations.** The scored
 * projection map, the bucketing, the lock set and the lineups are all computed
 * from it below — cheap CPU over rows already in hand, so a consumer that wants
 * one of them computes it rather than finding a half-answer already baked in.
 * That is what keeps the snapshot honest about being a *read*: two callers
 * scoring the same rows under two leagues' settings get two different answers
 * off one fetch, which is the whole reason the scoring is not in here.
 *
 * Pure and free of runtime imports it can't resolve, so the lineup rules keep
 * being testable — which is the point of the extraction as much as the saved
 * query. The solve below used to sit inline in `./outlook`'s I/O, where nothing
 * could reach it without a database.
 */

import { lineupCandidates, rosterPlayerIds } from "./candidates.ts";
import { orderLineupByKickoff } from "./kickoff-order.ts";
import { compareLineup } from "./optimal.ts";
import { groupWeeklyPoints } from "./weekly.ts";

import type { PlayerWeekStats } from "./aggregate";
import type { Projectable } from "./candidates";
import type { KickoffPlayer, KickoffSeat } from "./kickoff-order";
import type { LineupSlot } from "./optimal";
import type { LeagueTeamsInput, TeamWeekLineup } from "./outlook";
import type { LineupWeekStats } from "./queries";

/**
 * The reads one week's answers are all computed from, gathered once per request.
 *
 * `stats` is {@link LineupWeekStats}' population — the week **whole**, games
 * already played included and marked — because that is the reading a lineup
 * decision needs and it is a superset of what a projection column needs. A
 * horizon read cannot be served from here and must not try: it drops the played
 * games on purpose (see `listPlayerWeekStats`), which is the opposite filter.
 *
 * `positions` and `teams` come off one `players` row each, which is what makes
 * them one query — see `getPlayerLineupMeta`.
 */
export type WeekProjectionInputs = {
  season: string;
  week: number;
  /**
   * The player ids the reads were made for — the union of every roster the
   * request speaks for.
   *
   * Carried rather than re-derived because the lock set is folded over it: a
   * player with a stored row and a player without one are both candidates for a
   * kickoff-accurate lock, so the population is the roster union and not the
   * rows that came back.
   */
  playerIds: readonly string[];
  /** The week's stat lines for those players, each marked with its day lock. */
  stats: readonly LineupWeekStats[];
  /**
   * Player id → the positions he is eligible at. Empty where nothing on this
   * snapshot solves a lineup — see `readWeekProjectionInputs`' `metadata`.
   */
  positions: Record<string, string[]>;
  /** Player id → his NFL team, for joining him to a kickoff. Empty likewise. */
  teams: Record<string, string | null>;
};

/**
 * Every player's projected points for the week under one league's scoring.
 *
 * The projection *column*, which is a different question from what a lineup is
 * worth and is answered off the same rows: a player whose game is already
 * played keeps his number here, since those are points he scored in the lineup
 * the reader is looking at.
 *
 * `score` is passed in rather than the settings, on `groupWeeklyPoints`' own
 * terms — it is what keeps this module free of `./score`'s vocabulary and lets
 * one snapshot answer for two leagues.
 */
export function weekProjectionPoints(
  stats: readonly PlayerWeekStats[],
  score: (stats: Record<string, number> | null) => number,
): Map<string, number> {
  const projection = new Map<string, number>();
  for (const row of stats) projection.set(row.player_id, score(row.stats));
  return projection;
}

/**
 * The players whose game *date* has passed — `listLineupWeekStats`' own flag,
 * lifted off the snapshot.
 *
 * The fallback half of the lock: `lockedPlayers` folds the schedule's kickoff
 * instants over this and only ever locks earlier, so a schedule that can't be
 * read degrades to exactly this set.
 */
export function dayLockedPlayers(
  stats: readonly LineupWeekStats[],
): Set<string> {
  return new Set(stats.filter((row) => row.locked).map((row) => row.player_id));
}

/**
 * Stat rows bucketed by player, so each league scores its own rosters' rows
 * rather than re-scanning the union per league.
 *
 * Mechanical plumbing shared by the week solve and the horizon readers in
 * `./outlook` — one spelling, because two would be free to disagree about a
 * player rostered in several of a request's leagues.
 */
export function bucketPlayerRows<T extends PlayerWeekStats>(
  stats: readonly T[],
): Map<string, T[]> {
  const rowsByPlayer = new Map<string, T[]>();
  for (const row of stats) {
    let rows = rowsByPlayer.get(row.player_id);
    if (!rows) rowsByPlayer.set(row.player_id, (rows = []));
    rows.push(row);
  }
  return rowsByPlayer;
}

/** What the solve needs beyond the snapshot: the two facts the schedule decides. */
export type WeekSolveInputs = {
  /**
   * Players whose seats are settled — day-accurate off the snapshot, refined to
   * the minute wherever the schedule named a kickoff. Resolved by the caller
   * because the refinement is a network read and the fallback is not.
   */
  locked: ReadonlySet<string>;
  /**
   * Team → kickoff instant for the week, or null where there is nothing honest
   * to order against. Null is "no answer" and reaches every lineup's
   * `kickoff_order` as null — never an identity lineup dressed up as already
   * ordered.
   */
  kickoffs: ReadonlyMap<string, number> | null;
};

/**
 * One week's current-versus-optimal lineup for every team in every league given
 * — the whole of what {@link getWeekLineups} decides, with the reads lifted out.
 *
 * Every league passed must already be projectable and every team's players must
 * be covered by the snapshot; both are the caller's to establish, because both
 * are what it read the snapshot for.
 *
 * The scoring is per league and the candidates are per team, which is why this
 * is a loop rather than a map: a player projected the same points is a starter
 * on one roster and bench depth on another, and the same stat line is worth two
 * different numbers in two leagues.
 */
export function solveWeekLineups({
  inputs,
  leagues,
  locked,
  kickoffs,
  score,
}: {
  inputs: WeekProjectionInputs;
  leagues: readonly Projectable<LeagueTeamsInput>[];
  score: (
    scoring: Record<string, number>,
  ) => (stats: Record<string, number> | null) => number;
} & WeekSolveInputs): Map<string, Map<number, TeamWeekLineup>> {
  const rowsByPlayer = bucketPlayerRows(inputs.stats);

  const teams = new Map<string, Map<number, TeamWeekLineup>>();
  for (const league of leagues) {
    // One week asked for, so the grouping holds one entry — read through the
    // same helper the horizon path uses rather than a second spelling of it.
    const points =
      groupWeeklyPoints(
        rosterPlayerIds(league.teams).flatMap((id) => rowsByPlayer.get(id) ?? []),
        score(league.scoringSettings),
      ).get(inputs.week) ?? new Map<string, number>();

    const byTeam = new Map<number, TeamWeekLineup>();
    for (const team of league.teams) {
      const candidates = lineupCandidates(
        team,
        inputs.positions,
        // Zero for a player this week doesn't project, which is what
        // `compareLineup` needs: he can only ever fill a slot nobody else
        // wanted, and dropping him would overstate what the current lineup is
        // scoring. (The horizon path omits him instead, because there the
        // distinction is a bye rather than a zero — see `./weekly`.)
        (id) => points.get(id) ?? 0,
      );

      const comparison = compareLineup({
        rosterPositions: league.rosterPositions,
        starters: team.starters,
        players: candidates,
        locked,
        bestBall: league.bestBall,
      });

      byTeam.set(team.roster_id, {
        optimal_points: comparison.optimal_points,
        current_points: comparison.current_points,
        points_left: comparison.points_left,
        lineup: comparison.current,
        sit: comparison.sit,
        start: comparison.start,
        // Null for a best-ball league before anything is looked up: Sleeper
        // seats that lineup after the games, so there is no seat order for a
        // manager to set — the same reason its sit/start are empty.
        kickoff_order: league.bestBall
          ? null
          : kickoffOrdered(comparison.current, inputs, kickoffs, locked),
      });
    }
    teams.set(league.league_id, byTeam);
  }

  return teams;
}

/**
 * One team's lineup re-seated by kickoff — the thin join between the snapshot
 * and the pure ordering, deciding nothing itself: eligibility, holds and the
 * objective all live in `./kickoff-order`, and a player whose team or instant is
 * unknown arrives there as a null kickoff and keeps his seat.
 */
function kickoffOrdered(
  lineup: readonly LineupSlot[],
  inputs: WeekProjectionInputs,
  kickoffs: ReadonlyMap<string, number> | null,
  locked: ReadonlySet<string>,
): KickoffSeat[] | null {
  if (!kickoffs) return null;

  const players: KickoffPlayer[] = [];
  for (const seat of lineup) {
    if (!seat.player_id) continue;
    const team = inputs.teams[seat.player_id] ?? null;
    players.push({
      player_id: seat.player_id,
      positions: inputs.positions[seat.player_id] ?? [],
      kickoff: team === null ? null : (kickoffs.get(team) ?? null),
    });
  }

  return orderLineupByKickoff({ lineup, players, locked });
}
