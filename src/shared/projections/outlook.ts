import { getFantasyPositions, getPlayerLineupMeta } from "@/shared/players";
import { getWeekKickoffs } from "@/shared/schedule";

import { aggregateWeeklyStats } from "./aggregate";
import type { PlayerWeekStats } from "./aggregate";
import { isProjectable, lineupCandidates, rosterPlayerIds } from "./candidates";
import type { KickoffSeat } from "./kickoff-order";
import { lockedPlayers } from "./locks";
import { compareLineup, optimalLineup, recognisedSlots } from "./optimal";
import type { LineupComparison, LineupSlot } from "./optimal";
import {
  getProjectedStatKeys,
  getRemainingWeeks,
  listLineupWeekStats,
  listPlayerWeekStats,
} from "./queries";
import { scoreStatLine, unprojectedScoring } from "./score";
import {
  bucketPlayerRows,
  dayLockedPlayers,
  solveWeekLineups,
} from "./week-inputs";
import type { WeekProjectionInputs } from "./week-inputs";
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
   * Keyed by player id, over every candidate — the whole roster, IR and taxi
   * included — who is projected in at least one remaining week. A player with
   * no projection at all (out for the season, off Sleeper's slate) has no
   * entry: the same absence-is-not-zero rule the weekly solve applies per week.
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
      points: scoreStatLine(entry.stats, scoring),
      weeks: entry.weeks.length,
    };
  }

  // The same rows scored a week at a time, which the season total above doesn't
  // need and the weekly lineups can't do without. Scoring is linear, so a player's
  // total is one dot product over his summed stat line — but which players *start*
  // changes week to week, so that sum has to be broken back out per week to know
  // what a lineup is worth in it.
  const weeklyPoints = groupWeeklyPoints(stats, (s) =>
    scoreStatLine(s, scoring),
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
  };
}

/** What {@link getWeeklyTeamPoints} needs from one league. */
export type LeagueTeamsInput = {
  league_id: string;
  rosterPositions: readonly string[] | null;
  scoringSettings: Record<string, number> | null;
  teams: readonly OutlookRoster[];
  /**
   * Whether Sleeper seats this league's lineup itself — read only by
   * {@link getWeekLineups}, which is the one entry point here that asks what a
   * roster is *currently* starting. See {@link compareLineup} for what it
   * changes; absent reads as an ordinary lineup league, which is what Sleeper's
   * own omitted `best_ball` setting means.
   */
  bestBall?: boolean;
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
 *
 * {@link getWeekLineups} deliberately does *not* come through here, though it
 * opens with the same two lines: it reads one named week and it needs the games
 * already played, which is the opposite of what `listPlayerWeekStats` is for.
 * What the three still share is every *rule* — `isProjectable`,
 * `rosterPlayerIds`, `lineupCandidates`, the slot vocabulary — which is what the
 * extraction into `./candidates` was actually for. This is I/O, and two
 * genuinely different reads are two reads.
 */
async function readBatchInputs(
  season: string,
  leagues: readonly LeagueTeamsInput[],
  inputs?: HorizonProjectionInputs,
) {
  const projectable = leagues.filter(isProjectable);
  if (projectable.length === 0) return null;

  const shared =
    inputs ?? (await readHorizonProjectionInputs({ season, leagues: projectable }));
  if (shared.weeks.length === 0) return null;

  return {
    projectable,
    weeks: shared.weeks,
    stats: shared.stats,
    positions: shared.positions,
  };
}

/**
 * The reads {@link readBatchInputs} makes, as a value a *caller* can hold.
 *
 * The `readWeekProjectionInputs` shape one horizon along, and it exists for the
 * same reason: several answers on one screen are computed from these identical
 * rows, and without a snapshot each of them reads them again. A default Manager
 * load is three requests — the projected ranks, the KTC starter values and the
 * ADP starter values — and each of the three opened by reading every stat line
 * of every remaining week for every player on every roster of the account, plus
 * the positions of all of them.
 *
 * The same four rules the week's snapshot keeps:
 *
 * - **Reads, never derivations.** The scoring is per league and the solve is per
 *   caller, so both are computed *from* this rather than baked into it — which
 *   is what lets one account's ranks and its two value lenses share one fetch.
 * - **Passed down explicitly** (the optional `inputs` above), because a snapshot
 *   that outlived its request would be a cache with no key that could say whose
 *   rosters it held. `shared/manager/manager-snapshot` is where one is held for
 *   a manager, keyed and bounded.
 * - **A callee handed none reads its own**, so every existing caller is
 *   unaffected by construction — `getLeagueOutlook` and the week's solve never
 *   come through here at all.
 * - **What it does not need, it does not fetch**: with no projectable league or
 *   nothing left on the schedule it answers empty without touching the two
 *   expensive reads, which is exactly what `readBatchInputs` did with its two
 *   early returns.
 *
 * Empty `weeks` is how "nothing to project" travels, rather than a null: a
 * caller can then be handed the snapshot unconditionally, and the reason its own
 * subset is unprojectable stays its own question.
 */
export type HorizonProjectionInputs = {
  /** The season these rows were read for — the snapshot's own subject. */
  season: string;
  /** Weeks still ahead, ascending; empty when there is nothing to project. */
  weeks: number[];
  /** Every stat line stored for those weeks, for every player asked about. */
  stats: PlayerWeekStats[];
  /** Lineup eligibility per player id, as the players cache holds it. */
  positions: Record<string, string[]>;
};

/**
 * Read {@link HorizonProjectionInputs} for a set of leagues in one pass.
 *
 * The player ids are the union across every *projectable* league given, which is
 * what makes a snapshot taken over a superset usable by a caller holding a
 * subset: an extra player's rows are extra keys in a map nothing opens, and both
 * consumers bucket by their own rosters.
 */
export async function readHorizonProjectionInputs({
  season,
  leagues,
}: {
  season: string;
  leagues: readonly LeagueTeamsInput[];
}): Promise<HorizonProjectionInputs> {
  const empty: HorizonProjectionInputs = {
    season,
    weeks: [],
    stats: [],
    positions: {},
  };

  const projectable = leagues.filter(isProjectable);
  if (projectable.length === 0) return empty;

  const weeks = await getRemainingWeeks(season);
  if (weeks.length === 0) return empty;

  const playerIds = rosterPlayerIds(projectable.flatMap((l) => l.teams));

  const [stats, positions] = await Promise.all([
    listPlayerWeekStats({ season, weeks, playerIds }),
    getFantasyPositions(playerIds),
  ]);

  return { season, weeks, stats, positions };
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
  inputs,
}: {
  season: string;
  leagues: readonly LeagueTeamsInput[];
  /**
   * The stat lines and positions to solve against, where a caller has already
   * read them for a superset of these leagues — see
   * {@link HorizonProjectionInputs}. Absent, this reads its own, which is what
   * keeps every existing caller unaffected.
   */
  inputs?: HorizonProjectionInputs;
}): Promise<WeeklyTeamPoints> {
  const input = await readBatchInputs(season, leagues, inputs);
  if (!input) return { weeks: [], points: new Map(), bench: new Map() };
  const { projectable, weeks, stats, positions } = input;

  const rowsByPlayer = bucketPlayerRows(stats);

  const points = new Map<string, Map<number, number>>();
  const bench = new Map<string, Map<number, number>>();
  for (const league of projectable) {
    const scoring = league.scoringSettings;
    const weeklyPoints = groupWeeklyPoints(
      rosterPlayerIds(league.teams).flatMap((id) => rowsByPlayer.get(id) ?? []),
      (s) => scoreStatLine(s, scoring),
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
  inputs,
}: {
  season: string;
  leagues: readonly LeagueTeamsInput[];
  /** As {@link getWeeklyTeamPoints}' — the reads, where a caller already holds them. */
  inputs?: HorizonProjectionInputs;
}): Promise<OptimalLineups> {
  const input = await readBatchInputs(season, leagues, inputs);
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
        return entry ? scoreStatLine(entry.stats, scoring) : 0;
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

/** What one team is starting this week against what it could still be starting. */
export type TeamWeekLineup = {
  /**
   * The best lineup this roster can still reach: slots held by a player whose
   * game has been played stay as they are, the rest are solved.
   */
  optimal_points: number;
  /** What the lineup Sleeper currently holds projects for it. */
  current_points: number;
  /** `optimal − current`: the points the current lineup leaves on the bench. */
  points_left: number;
  /**
   * The lineup those totals are read off — what this roster is **actually**
   * starting, in slot order, with the slots this code doesn't recognise dropped.
   *
   * Carried rather than left to be rebuilt from `starters`, because a caller
   * holding that array cannot reproduce this one: the unrecognised slots come out
   * by a rule that lives here, and in a best-ball league the array is not the
   * lineup at all — Sleeper seats the optimal one, so that is what this holds
   * (see {@link compareLineup}).
   */
  lineup: LineupSlot[];
  /** Started players the best reachable lineup benches — the swaps to make. */
  sit: string[];
  /** Benched players it starts: the other end of those same swaps. */
  start: string[];
  /**
   * The same starters re-seated so the lineup locks strict-seats-first —
   * earlier kickoffs into dedicated slots, later ones into the flexes, in the
   * same seat order as `lineup`. See `./kickoff-order` for the ordering and
   * `kickoffMoves` for reading the seat changes off the pair.
   *
   * Null is "no answer", never "already ordered": a best-ball league (nobody
   * seats that lineup — Sleeper does, after the games), a week the schedule
   * supplies no kickoff instants for, or a kickoff read that failed. Already
   * ordered is this array equal to `lineup`, seat by seat.
   */
  kickoff_order: KickoffSeat[] | null;
};

export type WeekLineups = {
  /** The week every number here is for — the caller's own, echoed back. */
  week: number;
  /**
   * League id → roster id → that team's week. A league that can't be projected
   * (no slots or scoring on file, no rosters) is absent, as is every league when
   * the week has no stored projections left to read.
   */
  teams: Map<string, Map<number, TeamWeekLineup>>;
};

/**
 * One week's current-versus-optimal lineup for every team across many leagues —
 * the lineup checker's whole question, asked once for a hundred-odd leagues.
 *
 * The fourth batch entry point beside {@link getLeagueOutlook},
 * {@link getWeeklyTeamPoints} and {@link getOptimalLineups}, and it differs from
 * all three in the same way: they answer over the *rest of the season*, where a
 * lineup being set this Sunday is a fact about one week. Summing a horizon
 * answers a roster-shape question; this answers "what does today's lineup cost
 * you", which is a different number and the only one a lineup checker can act
 * on.
 *
 * It re-uses {@link compareLineup} rather than re-deriving the comparison, so
 * the gap a row prints and the gap the expanded league panel prints are one
 * rule — including the one that matters most as advice, that a starter with no
 * projection scores zero rather than being quietly dropped from the lineup he is
 * actually in.
 *
 * **Every team passed is solved**, the same contract {@link getOptimalLineups}
 * keeps: a caller that only needs the two rosters in a matchup should pass those
 * two, not the league.
 *
 * **It reads the week whole and locks what has been played**, which is the one
 * place it parts company with everything else here. The horizon reads drop a
 * played game because those points cannot be scored again; drop them from a
 * lineup decision and a starter who has already played reads as an empty slot,
 * so the solver seats a Sunday player over a Thursday one and the gap names a
 * swap Sleeper will refuse. {@link listLineupWeekStats} keeps those rows and
 * marks them, and {@link compareLineup} holds their slots — so what comes back
 * is the best lineup reachable *from here*, and `points_left` is points a
 * manager can still go and get. The lock is kickoff-accurate wherever the
 * schedule names an instant: {@link lockedPlayers} folds the week's
 * `start_time`s — the same read the kickoff ordering below makes — over the
 * day-accurate `game_date` flag, and the fold only ever locks *earlier*, so a
 * schedule that can't be read degrades to the midnight-ET fallback rather
 * than unlocking a played game.
 *
 * **A best-ball league is answered as a league with nothing to decide**, which is
 * the one league where `starters` is not the lineup: Sleeper seats the best one
 * itself once the games are in, so `lineup` is the optimal lineup, `points_left`
 * is zero and there is no swap to name. The flag rides on each league rather than
 * being derived here, since it is a fact about the league's settings and this
 * module reads projections. See {@link compareLineup}.
 *
 * **Each lineup also comes back re-seated by kickoff** (`kickoff_order`): the
 * same starters with earlier games in stricter slots and later games in the
 * flexes, so a manager can keep the flexible seats open longest — see
 * `./kickoff-order`, where the ordering lives. Its inputs are the one read here
 * that leaves this app's own data (the schedule call, through
 * `shared/schedule`'s in-memory cache), and it is judged per read: a schedule
 * that can't be read costs the ordering — null, never an identity lineup
 * dressed up as "already ordered" — and nothing else.
 */
export async function getWeekLineups({
  season,
  week,
  leagues,
  inputs,
}: {
  season: string;
  week: number;
  leagues: readonly LeagueTeamsInput[];
  /**
   * A snapshot the caller has already read for this same season, week and
   * roster union — see {@link readWeekProjectionInputs}. Absent, this reads one
   * of its own, which is what every caller that has nothing to share does.
   *
   * It is the caller's job that the snapshot covers these leagues, because
   * covering them is what it read it for: a snapshot narrower than the rosters
   * handed over would quietly project the missing players at zero, which is
   * this file's own definition of the wrong answer that looks like a right one.
   */
  inputs?: WeekProjectionInputs;
}): Promise<WeekLineups> {
  const projectable = leagues.filter(isProjectable);
  if (projectable.length === 0) return { week, teams: new Map() };

  const shared =
    inputs ??
    (await readWeekProjectionInputs({
      season,
      week,
      playerIds: rosterPlayerIds(projectable.flatMap((l) => l.teams)),
    }));

  // The clause of the contract above that nothing else implements: a week with
  // no stored projections for any of these rosters is *absence*, never a map of
  // confident zeros. Without this, every league solved against nothing came
  // back `{optimal: 0, current: 0, points_left: 0}`, and "0.0 points left"
  // reads as "your lineup is already optimal" — the one wrong answer here that
  // looks like a working one.
  if (shared.stats.length === 0) return { week, teams: new Map() };

  // Kickoff instants for the lock and the re-seat below, read once for the
  // account like the snapshot's positions: when a player's game kicks off is a
  // fact about the schedule, not about any league. Judged per read — a failure
  // costs the ordering (null) and the lock's minute-accuracy (the day fallback
  // stands), never the lineups.
  const kickoffs = await weekKickoffs(season, week);

  // One set for the account: whether a game has been played is a fact about
  // the schedule, so it is the same answer in every league the player is
  // rostered in. Kickoff-accurate where the instants answer, the day-accurate
  // `game_date` flag where they don't — and the fold only ever locks earlier,
  // so a schedule that can't be read degrades to the old behaviour rather
  // than unlocking a played game. The rule lives in `./locks`; `now` is one
  // reading per request, so every league judges the same instant.
  const dayLocked = dayLockedPlayers(shared.stats);
  const locked = kickoffs
    ? lockedPlayers({
        playerIds: shared.playerIds,
        dayLocked,
        teams: shared.teams,
        kickoffs,
        now: Date.now(),
      })
    : dayLocked;

  return {
    week,
    // Every decision below this line is pure and testable without a database —
    // see `./week-inputs`, which is where the solve lives.
    teams: solveWeekLineups({
      inputs: shared,
      leagues: projectable,
      locked,
      kickoffs,
      score: (scoring) => (stats) => scoreStatLine(stats, scoring),
    }),
  };
}

/**
 * The reads every answer about one week is computed from — the week's stat
 * lines and the player metadata the lineup solve joins them to — gathered once
 * so a request that asks two questions of them pays for one fetch.
 *
 * **Two queries, and it used to be four.** `getLeagueWeekView` read the week's
 * projections for its per-player column and {@link getWeekLineups} read the
 * identical rows again for the lineups, while the lineup path asked `players`
 * once for eligibility and once more for each player's NFL team. The rows are
 * the same rows and the two `players` facts are the same row (see
 * `getPlayerLineupMeta`), so the duplication was arithmetic rather than
 * judgement.
 *
 * **The snapshot does not decide anything**, which is what keeps it shareable:
 * scoring is per league and locking is per request, so both are computed from
 * it rather than baked into it.
 */
export async function readWeekProjectionInputs({
  season,
  week,
  playerIds,
  metadata = true,
}: {
  season: string;
  week: number;
  playerIds: string[];
  /**
   * Whether anything reading this snapshot will solve a lineup off it.
   *
   * The eligibility and NFL team are the *solve's* inputs alone — a projection
   * column is scored off the stat lines and nothing else — so a caller that has
   * already established there is no lineup to solve (a league with no slots or
   * scoring on file, which {@link getWeekLineups} refuses before reading
   * anything) leaves that read unmade rather than paying for a map nothing will
   * open. Absent reads as *on*, so a caller that hasn't thought about it gets
   * the whole snapshot.
   */
  metadata?: boolean;
}): Promise<WeekProjectionInputs> {
  const [stats, meta] = await Promise.all([
    listLineupWeekStats({ season, week, playerIds }),
    metadata
      ? getPlayerLineupMeta(playerIds)
      : Promise.resolve({ positions: {}, teams: {} }),
  ]);

  return {
    season,
    week,
    playerIds,
    stats,
    positions: meta.positions,
    teams: meta.teams,
  };
}

/**
 * The week's kickoff instants, or null when there is nothing honest to order
 * against: a week the schedule names no believable instants for, or the read
 * failing outright.
 *
 * The ordering itself holds any *single* player it can't date (see
 * `./kickoff-order`), but with nothing dated at all the identity answer would
 * read as "already ordered" — a claim about a schedule this process hasn't
 * seen — so the whole ordering answers null instead. The player half of that
 * join is on the snapshot now, which is what leaves this the one read here that
 * leaves this app's own data.
 */
async function weekKickoffs(
  season: string,
  week: number,
): Promise<Map<string, number> | null> {
  try {
    const byTeam = await getWeekKickoffs(season, week);
    return byTeam.size === 0 ? null : byTeam;
  } catch (error) {
    console.error(`[projections] kickoff inputs failed for week ${week}:`, error);
    return null;
  }
}
