import { getFantasyPositions } from "@/shared/players";

import { aggregateWeeklyStats } from "./aggregate";
import type { PlayerWeekStats } from "./aggregate";
import { compareLineup, startingSlots } from "./optimal";
import type { LineupComparison, RosterPlayer } from "./optimal";
import {
  getProjectedStatKeys,
  getRemainingWeeks,
  listPlayerWeekStats,
} from "./queries";
import { derivedScoring, scoreProjection, unprojectedScoring } from "./score";
import { SLOT_POSITIONS } from "./slots";
import { groupWeeklyPoints, weeklyLineupSplit, weeklyRosters } from "./weekly";
import type { PlayerSplit } from "./weekly";

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
export type TeamOutlook = LineupComparison & {
  roster_id: number;
  /**
   * The team's projected points for the rest of the season: each remaining week's
   * own best lineup, summed.
   *
   * Not `optimal_points`, and always at least as large. That one is a single
   * lineup ranked on season-long totals — the answer to "who belongs in my
   * starting slots from here". This is the answer to "what will this roster
   * score", which lets the lineup change every week: a bye costs one week instead
   * of a slot, and two players who take turns being the better start both count.
   * The two differ by a few percent on a normal roster and by much more on one
   * carrying a hurt starter, so they are shown as different numbers rather than
   * one being quietly used for the other.
   *
   * Mid-week it covers only the games still to be played, like every other total
   * here — the week in progress contributes what is left of it, and a starter
   * whose game is over frees his slot for whoever hasn't played yet.
   */
  weekly_optimal_points: number;
  /**
   * The other side of `weekly_optimal_points`: what every candidate who didn't
   * start is projected for, over the same horizon.
   *
   * How much production this roster is carrying without playing — depth on a good
   * team, a logjam on a badly balanced one. Worth showing beside the projected
   * total rather than derived from it, since the two together say something
   * neither says alone: two teams projecting the same points are not the same team
   * if one of them has twice as much sitting behind its starters.
   */
  weekly_bench_points: number;
  /**
   * `weekly_optimal_points` broken out per player: what each one is projected for
   * in the weeks he makes that week's lineup, and in the weeks he doesn't.
   *
   * Keyed by player id, and only the players who were candidates for this team's
   * lineup — IR and taxi are excluded here for the same reason they are excluded
   * from the lineup itself, so a row for one of them has no split to show.
   *
   * A team-level answer rather than a league-level one, which is why it sits here
   * and not in `players`: the same projection makes the lineup on one roster and
   * doesn't on another, so who a player is stuck behind is a fact about his team.
   */
  weekly_split: Record<string, PlayerSplit>;
};

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
 * The sum of the weekly optimals is the answer to the *other* question — what the
 * roster will score between now and the end — so each team also carries it as
 * `weekly_optimal_points`. It costs one lineup solve per team per week, which is
 * cheap next to the query that fed it, and those solves also say *which* players
 * filled the slots — kept as `weekly_split` rather than thrown away, since it is
 * the only thing that separates a bench player who is occasionally the better
 * start from one who is never startable at all.
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

  // The same rows scored a week at a time, which the season total above doesn't
  // need and the weekly lineups can't do without. Scoring is linear, so a player's
  // total is one dot product over his summed stat line — but which players *start*
  // changes week to week, so that sum has to be broken back out per week to know
  // what a lineup is worth in it.
  const weeklyPoints = groupWeeklyPoints(stats, (s) =>
    scoreProjection(s, scoringSettings),
  );

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

      const comparison = compareLineup({
        rosterPositions,
        starters: team.starters,
        players: candidates,
      });

      const weekly = weeklyLineupSplit(
        // The slots the comparison itself used, so a league with a slot this
        // code doesn't recognise leaves it out of both numbers rather than one.
        // A candidate unprojected for a week is omitted from it rather than
        // passed as a zero — the rule lives (and is tested) in `./weekly`.
        comparison.optimal.map((slot) => slot.slot),
        weeklyRosters(candidates, weeks, weeklyPoints),
      );

      return {
        roster_id: team.roster_id,
        ...comparison,
        weekly_optimal_points: weekly.points,
        weekly_bench_points: weekly.bench_points,
        weekly_split: weekly.players,
      };
    }),
    unprojected_scoring: unprojectedScoring(scoringSettings, statKeys),
    derived_scoring: derivedScoring(scoringSettings),
  };
}

/** What {@link getWeeklyTeamPoints} needs from one league. */
export type LeagueTeamsInput = {
  league_id: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  teams: readonly OutlookRoster[];
};

export type WeeklyTeamPoints = {
  /** Weeks the totals cover, ascending — empty when nothing remains to play. */
  weeks: number[];
  /**
   * League id → roster id → that team's `weekly_optimal_points`. A league that
   * can't be projected (no slots or scoring on file, no rosters) is absent.
   */
  points: Map<string, Map<number, number>>;
};

/**
 * `weekly_optimal_points` for every team across many leagues in one pass — the
 * one number {@link getLeagueOutlook} computes that is worth having for a whole
 * account at once, because ranking a roster means projecting everyone else's.
 *
 * A separate entry point rather than `getLeagueOutlook` in a loop because the
 * loop would repeat the reads a hundred-plus times per request: the remaining
 * weeks, the stat lines and the positions are fetched once for the union of
 * every league's rosters, and only the scoring and the lineup solves — the
 * parts that genuinely differ per league — run per league. Everything skipped
 * here (aggregates, splits, current-lineup diffs, scoring caveats) is a
 * per-panel answer the league detail route already serves.
 */
export async function getWeeklyTeamPoints({
  season,
  leagues,
}: {
  season: string;
  leagues: readonly LeagueTeamsInput[];
}): Promise<WeeklyTeamPoints> {
  const projectable = leagues.filter(
    (l) => l.rosterPositions?.length && l.scoringSettings && l.teams.length > 0,
  );
  if (projectable.length === 0) return { weeks: [], points: new Map() };

  const weeks = await getRemainingWeeks(season);
  if (weeks.length === 0) return { weeks: [], points: new Map() };

  const playerIds = [
    ...new Set(projectable.flatMap((l) => l.teams.flatMap((t) => t.players))),
  ].filter(Boolean);

  const [stats, positions] = await Promise.all([
    listPlayerWeekStats({ season, weeks, playerIds }),
    getFantasyPositions(playerIds),
  ]);

  // Bucketed by player once, so each league scores its own rosters' rows rather
  // than re-scanning the whole account's union per league.
  const rowsByPlayer = new Map<string, PlayerWeekStats[]>();
  for (const row of stats) {
    let rows = rowsByPlayer.get(row.player_id);
    if (!rows) rowsByPlayer.set(row.player_id, (rows = []));
    rows.push(row);
  }

  const points = new Map<string, Map<number, number>>();
  for (const league of projectable) {
    const scoring = league.scoringSettings!;
    const leaguePlayers = [
      ...new Set(league.teams.flatMap((t) => t.players)),
    ].filter(Boolean);
    const weeklyPoints = groupWeeklyPoints(
      leaguePlayers.flatMap((id) => rowsByPlayer.get(id) ?? []),
      (s) => scoreProjection(s, scoring),
    );

    // The recognised starting slots, as compareLineup derives them — an unknown
    // slot is left out of the total here the same way it is left out there.
    const slots = startingSlots(league.rosterPositions!).filter(
      (slot) => slot in SLOT_POSITIONS,
    );

    const byTeam = new Map<number, number>();
    for (const team of league.teams) {
      // IR and taxi are candidates for nobody's lineup, as in getLeagueOutlook.
      const unavailable = new Set([...team.reserve, ...team.taxi]);
      const candidates: RosterPlayer[] = team.players
        .filter((id) => id && !unavailable.has(id))
        .map((id) => ({
          player_id: id,
          positions: positions[id] ?? [],
          // Never read: weeklyRosters re-scores every candidate against each
          // week's own projection, and the aggregate total isn't needed here.
          points: 0,
        }));

      byTeam.set(
        team.roster_id,
        weeklyLineupSplit(slots, weeklyRosters(candidates, weeks, weeklyPoints))
          .points,
      );
    }
    points.set(league.league_id, byTeam);
  }

  return { weeks, points };
}
