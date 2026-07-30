import { getFantasyPositions } from "@/shared/players";

import { aggregateWeeklyStats } from "./aggregate";
import type { PlayerWeekStats } from "./aggregate";
import { isProjectable, lineupCandidates, rosterPlayerIds } from "./candidates";
import { compareLineup, optimalLineup, recognisedSlots } from "./optimal";
import type { LineupComparison } from "./optimal";
import {
  getProjectedStatKeys,
  getRemainingWeeks,
  listPlayerWeekStats,
} from "./queries";
import { derivedScoring, scoreProjection, unprojectedScoring } from "./score";
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
  /**
   * Every rostered player id — IR and taxi included, since they are candidates
   * for the lineup like any bench player now, so the solver wants the whole list.
   */
  players: readonly string[];
  /** Starting lineup, positionally aligned with the league's starting slots. */
  starters: readonly string[];
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
   * Keyed by player id, over every player who was a candidate for this team's
   * lineup — which is the whole roster, IR and taxi included, since a stashed
   * player is treated as startable bench depth rather than as unavailable.
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
 * IR and taxi players are candidates like any bench player — a stashed player is
 * treated as depth that could be started, not as unavailable (Sleeper needs a
 * roster move to seat one, so the lineup is "best available once activated").
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
  // Gathered into a league so the guard can narrow it: `isProjectable` is the
  // same rule the batch entry points below filter on, so all three refuse a
  // league on one definition rather than three spellings of it.
  const league = { rosterPositions, scoringSettings, teams };
  if (!isProjectable(league)) return null;
  const scoring = league.scoringSettings;

  const weeks = await getRemainingWeeks(season);
  if (weeks.length === 0) return null;

  const playerIds = rosterPlayerIds(teams);

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
      points: scoreProjection(entry.stats, scoring),
      weeks: entry.weeks.length,
    };
  }

  // The same rows scored a week at a time, which the season total above doesn't
  // need and the weekly lineups can't do without. Scoring is linear, so a player's
  // total is one dot product over his summed stat line — but which players *start*
  // changes week to week, so that sum has to be broken back out per week to know
  // what a lineup is worth in it.
  const weeklyPoints = groupWeeklyPoints(stats, (s) =>
    scoreProjection(s, scoring),
  );

  return {
    weeks,
    players,
    teams: teams.map((team) => {
      const candidates = lineupCandidates(
        team,
        positions,
        (id) => players[id]?.points ?? 0,
      );

      const comparison = compareLineup({
        rosterPositions: league.rosterPositions,
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
    unprojected_scoring: unprojectedScoring(scoring, statKeys),
    derived_scoring: derivedScoring(scoring),
  };
}

/** What {@link getWeeklyTeamPoints} needs from one league. */
export type LeagueTeamsInput = {
  league_id: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  teams: readonly OutlookRoster[];
};

/**
 * The reads {@link getWeeklyTeamPoints} and {@link getOptimalLineups} share:
 * which leagues can be projected at all, the horizon, and — for the union of
 * every roster across them — the stat lines and the positions.
 *
 * One pass for the whole account, which is the reason those two exist rather
 * than a loop over {@link getLeagueOutlook}: these reads cost the same whether
 * one league asks or a hundred do, so a per-league loop would repeat them a
 * hundred times. What genuinely differs per league is the scoring and the solve,
 * and that stays with each caller.
 *
 * Null when there is nothing to project — no projectable league, or nothing left
 * on the schedule — so neither caller has to spell out the two ways that happens
 * before returning its own empty shape.
 */
async function readBatchInputs(
  season: string,
  leagues: readonly LeagueTeamsInput[],
) {
  const projectable = leagues.filter(isProjectable);
  if (projectable.length === 0) return null;

  const weeks = await getRemainingWeeks(season);
  if (weeks.length === 0) return null;

  const playerIds = rosterPlayerIds(projectable.flatMap((l) => l.teams));

  const [stats, positions] = await Promise.all([
    listPlayerWeekStats({ season, weeks, playerIds }),
    getFantasyPositions(playerIds),
  ]);

  return { projectable, weeks, stats, positions };
}

export type WeeklyTeamPoints = {
  /** Weeks the totals cover, ascending — empty when nothing remains to play. */
  weeks: number[];
  /**
   * League id → roster id → that team's `weekly_optimal_points`. A league that
   * can't be projected (no slots or scoring on file, no rosters) is absent.
   */
  points: Map<string, Map<number, number>>;
  /**
   * The other half of `points`, keyed the same way: each team's
   * `weekly_bench_points` — what its non-starters project over the horizon. The
   * weekly solve computes both at once, so carrying the bench costs nothing extra
   * and lets the ranks route place a roster by depth as well as by starters.
   */
  bench: Map<string, Map<number, number>>;
};

/**
 * `weekly_optimal_points` for every team across many leagues in one pass — the
 * one number {@link getLeagueOutlook} computes that is worth having for a whole
 * account at once, because ranking a roster means projecting everyone else's.
 *
 * A separate entry point rather than `getLeagueOutlook` in a loop because the
 * loop would repeat the reads a hundred-plus times per request — they are shared
 * across the account here (see {@link readBatchInputs}), leaving only the
 * scoring and the lineup solves to run per league. Everything skipped here
 * (aggregates, splits, current-lineup diffs, scoring caveats) is a per-panel
 * answer the league detail route already serves.
 */
export async function getWeeklyTeamPoints({
  season,
  leagues,
}: {
  season: string;
  leagues: readonly LeagueTeamsInput[];
}): Promise<WeeklyTeamPoints> {
  const input = await readBatchInputs(season, leagues);
  if (!input) return { weeks: [], points: new Map(), bench: new Map() };
  const { projectable, weeks, stats, positions } = input;

  // Bucketed by player once, so each league scores its own rosters' rows rather
  // than re-scanning the whole account's union per league.
  const rowsByPlayer = new Map<string, PlayerWeekStats[]>();
  for (const row of stats) {
    let rows = rowsByPlayer.get(row.player_id);
    if (!rows) rowsByPlayer.set(row.player_id, (rows = []));
    rows.push(row);
  }

  const points = new Map<string, Map<number, number>>();
  const bench = new Map<string, Map<number, number>>();
  for (const league of projectable) {
    const scoring = league.scoringSettings;
    const weeklyPoints = groupWeeklyPoints(
      rosterPlayerIds(league.teams).flatMap((id) => rowsByPlayer.get(id) ?? []),
      (s) => scoreProjection(s, scoring),
    );

    const slots = recognisedSlots(league.rosterPositions);

    const byTeam = new Map<number, number>();
    const byTeamBench = new Map<number, number>();
    for (const team of league.teams) {
      const candidates = lineupCandidates(
        team,
        positions,
        // Never read: weeklyRosters re-scores every candidate against each
        // week's own projection, and the aggregate total isn't needed here.
        () => 0,
      );

      // One solve yields both halves — the starters' total and the bench's — so
      // ranking a roster by depth costs nothing beyond ranking it by starters.
      const split = weeklyLineupSplit(
        slots,
        weeklyRosters(candidates, weeks, weeklyPoints),
      );
      byTeam.set(team.roster_id, split.points);
      byTeamBench.set(team.roster_id, split.bench_points);
    }
    points.set(league.league_id, byTeam);
    bench.set(league.league_id, byTeamBench);
  }

  return { weeks, points, bench };
}

export type OptimalLineups = {
  /** Weeks the lineups were ranked over, ascending — empty when none remain. */
  weeks: number[];
  /**
   * League id → roster id → the player ids that lineup starts, in slot order
   * with unfilled slots dropped. A league that can't be projected is absent.
   */
  lineups: Map<string, Map<number, string[]>>;
};

/**
 * The rest-of-season optimal lineup for every team across many leagues in one
 * pass — the same lineup {@link getLeagueOutlook} puts in a panel's Starters
 * list, for callers that need it across a whole account rather than one league.
 *
 * The third entry point beside that one and {@link getWeeklyTeamPoints}, and it
 * exists for the reason the second does: the reads it shares cost the same
 * whether one league asks or a hundred do (see {@link readBatchInputs}), so only
 * the scoring and the solve run per league.
 *
 * Cheaper per team than `getWeeklyTeamPoints`, because this lineup is ranked on
 * a season total: the stat lines are summed once for everyone (scoring is
 * linear, so a player's aggregate is league-independent — see `./aggregate`) and
 * each league scores that sum once per player, where the weekly totals need one
 * solve per team per week.
 *
 * Every team passed in is solved, so a caller wanting one roster per league
 * should pass one roster per league.
 */
export async function getOptimalLineups({
  season,
  leagues,
}: {
  season: string;
  leagues: readonly LeagueTeamsInput[];
}): Promise<OptimalLineups> {
  const input = await readBatchInputs(season, leagues);
  if (!input) return { weeks: [], lineups: new Map() };
  const { projectable, weeks, stats, positions } = input;

  // Summed once for the whole account: a stat line doesn't depend on whose
  // league it is read in, and only the scoring below does.
  const aggregated = aggregateWeeklyStats(stats);

  const lineups = new Map<string, Map<number, string[]>>();
  for (const league of projectable) {
    const scoring = league.scoringSettings;
    const slots = recognisedSlots(league.rosterPositions);

    const byTeam = new Map<number, string[]>();
    for (const team of league.teams) {
      const candidates = lineupCandidates(team, positions, (id) => {
        const entry = aggregated[id];
        return entry ? scoreProjection(entry.stats, scoring) : 0;
      });

      byTeam.set(
        team.roster_id,
        optimalLineup(slots, candidates)
          .map((slot) => slot.player_id)
          .filter((id): id is string => id !== null),
      );
    }
    lineups.set(league.league_id, byTeam);
  }

  return { weeks, lineups };
}
