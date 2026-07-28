import { getFantasyPositions } from "@/shared/players";

import { aggregateWeeklyStats } from "./aggregate";
import { compareLineup } from "./optimal";
import type { LineupComparison, RosterPlayer } from "./optimal";
import {
  getProjectedStatKeys,
  getRemainingWeeks,
  listPlayerWeekStats,
} from "./queries";
import { derivedScoring, scoreProjection, unprojectedScoring } from "./score";

/**
 * Rest-of-season optimal lineups for every roster in one league.
 *
 * The thin I/O half of the lineup work: it reads the projections and the players
 * cache and hands the rest to the pure modules beside it (`./aggregate`,
 * `./score`, `./optimal`), which is where the logic worth testing lives.
 *
 * Three league-specific things make this a per-league answer rather than a board
 * anyone can read off `pts_ppr`:
 *
 * - the slots (`roster_positions`), which decide what a legal lineup even is;
 * - the scoring (`scoring_settings`), which is a few points a player away from
 *   Sleeper's defaults in all but a handful of leagues;
 * - nothing else — the horizon is the same for everyone, since every league in a
 *   season has the same weeks left.
 */

/** What this needs from a team to project it. */
export type OutlookRoster = {
  roster_id: number;
  /** Every rostered player id. */
  players: readonly string[];
  /** Starting lineup, positionally aligned with the league's starting slots. */
  starters: readonly string[];
  reserve: readonly string[];
  taxi: readonly string[];
};

/** One player's aggregate outlook under this league's scoring. */
export type PlayerOutlook = {
  /** Projected points over `weeks`, scored with the league's own settings. */
  points: number;
  /** How many of the remaining weeks the player is actually projected for. */
  weeks: number;
};

/** One team's rest-of-season lineup, with what it is starting today. */
export type TeamOutlook = LineupComparison & { roster_id: number };

export type LeagueOutlook = {
  /** Weeks aggregated, ascending — the horizon every number here covers. */
  weeks: number[];
  /** Per-player totals over that horizon, for rendering the roster. */
  players: Record<string, PlayerOutlook>;
  teams: TeamOutlook[];
  /**
   * Categories the league scores that projections don't supply at all.
   *
   * Rarely empty, and mostly harmless: nearly every league carries weights for
   * defence and special-teams events Sleeper doesn't project, which cost nothing
   * if nobody rosters a DEF or an IDP. Where it bites is a league that starts
   * those players — every one of their totals reads low, so a league with an IDP
   * slot and a long list here shouldn't be presented as authoritative.
   */
  unprojected_scoring: string[];
  /**
   * Categories the league scores that Sleeper publishes as a formula rather than
   * a projection, and which are therefore left out of every total here.
   *
   * Separate from `unprojected_scoring` because it can't be gated on the league
   * starting a defence: first-down and reception-split scoring applies to every
   * skill player, so a non-empty list here means every number on the page is
   * lower than the league's own settings would suggest — and, before this was
   * excluded, was higher than anything that could actually be scored.
   */
  derived_scoring: string[];
};

/**
 * The best lineup each roster could set for the rest of the season.
 *
 * One lineup per team, not one per week: players are ranked on their *aggregate*
 * projection over every remaining week, so the answer is "who should be in your
 * starting slots from here", not the sum of eighteen weekly optimals. Those
 * differ — a player on bye next week still belongs in the season-long lineup —
 * and the aggregate is the one that answers a roster-shape question.
 *
 * Returns null when the league can't be projected at all: no slots on file, no
 * scoring settings to score with, or nothing left on the schedule. Scoring a
 * league with no `scoring_settings` would come back all zeroes and look like a
 * roster of worthless players, so it is refused rather than guessed at.
 *
 * IR and taxi players are candidates for nobody's lineup — Sleeper won't let them
 * start, so offering them as advice would be offering an illegal lineup.
 */
export async function getLeagueOutlook({
  season,
  rosterPositions,
  scoringSettings,
  teams,
}: {
  season: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  teams: readonly OutlookRoster[];
}): Promise<LeagueOutlook | null> {
  if (!rosterPositions?.length || !scoringSettings || teams.length === 0) {
    return null;
  }

  const weeks = await getRemainingWeeks(season);
  if (weeks.length === 0) return null;

  const playerIds = [...new Set(teams.flatMap((t) => t.players))].filter(Boolean);

  const [stats, statKeys, positions] = await Promise.all([
    listPlayerWeekStats({ season, weeks, playerIds }),
    // The whole week's vocabulary, not this league's rosters' — see the query.
    getProjectedStatKeys({ season, weeks }),
    // Positions come from the players cache rather than the projection, which
    // stores none. A player the cache doesn't know is eligible for no slot and so
    // never starts — better than guessing a position and recommending a lineup
    // Sleeper would reject.
    getFantasyPositions(playerIds),
  ]);

  const aggregated = aggregateWeeklyStats(stats);

  const players: Record<string, PlayerOutlook> = {};
  for (const [playerId, entry] of Object.entries(aggregated)) {
    players[playerId] = {
      points: scoreProjection(entry.stats, scoringSettings),
      weeks: entry.weeks.length,
    };
  }

  return {
    weeks,
    players,
    teams: teams.map((team) => {
      const unavailable = new Set([...team.reserve, ...team.taxi]);
      const candidates: RosterPlayer[] = team.players
        .filter((id) => id && !unavailable.has(id))
        .map((id) => ({
          player_id: id,
          positions: positions[id] ?? [],
          points: players[id]?.points ?? 0,
        }));

      return {
        roster_id: team.roster_id,
        ...compareLineup({
          rosterPositions,
          starters: team.starters,
          players: candidates,
        }),
      };
    }),
    unprojected_scoring: unprojectedScoring(scoringSettings, statKeys),
    derived_scoring: derivedScoring(scoringSettings),
  };
}
