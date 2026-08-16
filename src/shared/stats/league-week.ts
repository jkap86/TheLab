import type { LeagueTeam } from "@/shared/manager";
import { getPreviousLeagueScores, listRosterWeekPoints } from "@/shared/manager";
import type { RosterWeekPoints } from "@/shared/manager";
import {
  getWeekLineups,
  listLineupWeekStats,
  medianLineups,
  scoreStatLine,
} from "@/shared/projections";
import { getWeekGames } from "@/shared/schedule";
import type { TeamGame } from "@/shared/schedule";

import { playerPpg, ppgWindow, teamPpg } from "./ppg";
import type { Ppg, StatLine } from "./ppg";
import { listPlayerStatLines, listStoredStatWeeks } from "./queries";
import { allRegularWeeks, previousSeason } from "./weeks";

/**
 * One league read as a **week** rather than as a season.
 *
 * The thin composition file for this feature — I/O and no logic of its own, the
 * `projections/outlook` shape: it reads the week's projections, the played weeks
 * behind it and the league's own scored history, and hands each to a pure module
 * ({@link playerPpg}, {@link teamPpg}, {@link getWeekLineups}) that decides what
 * the number means. If a decision starts creeping into a loop here, it wants a
 * pure module.
 *
 * **Why the league panel needs one at all.** Everything else that panel shows is
 * a rest-of-season shape — what a roster is worth from here — which is the right
 * question when a reader arrives at a league and the wrong one when they arrive
 * at a *lineup*. A lineup is set for one week, so the two numbers worth putting
 * beside a player are what he projects in that week and what he has actually
 * been doing, and neither is a slice of the season aggregate.
 *
 * **The two halves read different sources on purpose.** A player's form is his
 * stat lines re-scored under this league's settings, because the same line is
 * worth different totals in two leagues and that difference is the whole reason
 * this app scores anything itself. A *team's* form is what the league recorded
 * it scoring — already scored, and already reflecting the lineup the manager
 * actually set, which no re-scoring of a roster could reproduce.
 */

/** Where a points-per-game average came from, so a column can say. */
export type PpgSource = {
  /** The season the averages were counted over. */
  season: string;
  /** The weeks that contributed — what the average is out of, league-wide. */
  weeks: number[];
  /**
   * True when this is the *previous* season standing in for a window with
   * nothing in it.
   *
   * A property of the read rather than of a row, which is the distinction that
   * keeps the column honest: the fallback fires because the window is empty
   * (week 1, or a season this database has not backfilled), never because one
   * player happens to have missed every game in it. A player with no games
   * inside a non-empty window is an em dash — he has not played — and mixing
   * the two would put last season's average beside this season's on the same
   * column with nothing saying which was which.
   */
  prior: boolean;
};

/**
 * One team's week: the two totals, the lineup behind them, and the swaps between.
 *
 * The lineup travels because the panel lists it — a week's roster half shows what
 * the team is *actually* starting, which is the one reading a manager can act on
 * — and it cannot be rebuilt from Sleeper's `starters` array on the other side of
 * the wire: unrecognised slots are dropped by a rule that lives in the solver,
 * and a best-ball league's array is not its lineup at all.
 */
export type TeamWeekProjection = {
  /** The best lineup still reachable. */
  optimal: number;
  /** What the lineup it is actually starting projects. */
  current: number;
  /** The difference: points still to be had by moving somebody. */
  points_left: number;
  /** That current lineup, in slot order. Points are per player on `projection`. */
  lineup: { slot: string; player_id: string | null }[];
  /** Started players the best reachable lineup benches. */
  sit: string[];
  /** Benched players it starts — the other end of those same swaps. */
  start: string[];
  /**
   * The same starters re-seated by kickoff, or null where there is no answer —
   * the solver's own field, passed through whole. See
   * {@link TeamWeekProjectionPayload.kickoff_order} for what the two spellings
   * of nothing mean on the other side of the wire.
   */
  kickoff_order: { slot: string; player_id: string | null }[] | null;
};

/**
 * The bar every team in a median league is measured against, in both readings.
 *
 * **Two numbers rather than one, because the panel prints one and the verdict is
 * counted on the other.** A roster heading shows the best lineup available with
 * what is currently set on its hover — comparing two *best* lineups is the
 * like-for-like reading of "who wins this week" — so a median printed beside two
 * such headings has to be the median of the same reading, or the three numbers
 * on screen are not comparable. The lineup checker's mark is counted on
 * `current` against `current`, which is what these lineups do if nothing is
 * touched, and that half is on the hover here exactly as each team's is.
 */
export type WeekMedian = {
  /** The middle of the best lineups available — what the headings beside it show. */
  optimal: number;
  /** The middle of the lineups actually set — what the week comes to untouched. */
  current: number;
};

/** What one league's week looks like: a projection and a form line, per subject. */
export type LeagueWeekView = {
  week: number;
  ppg_source: PpgSource;
  /** Player id → his projected points this week, in this league's scoring. */
  projection: Map<string, number>;
  /** Player id → his points per game over {@link PpgSource.weeks}. */
  ppg: Map<string, Ppg>;
  /** Roster id → that team's best and current lineup for the week. */
  team_projection: Map<number, TeamWeekProjection>;
  /**
   * The week's median, or null where there is none to have — which is most
   * leagues, since most do not carry Sleeper's `league_average_match`.
   *
   * It costs nothing to compute here and could not be computed anywhere
   * cheaper: this read already solves *every* team in the league, so the middle
   * of them is a fold over `team_projection` rather than a second solve. That is
   * the one asymmetry with the lineup checker's own read worth knowing — there,
   * a median is what makes a league expensive; here, it is free.
   */
  median: WeekMedian | null;
  /** Roster id → that team's points per game over the same window. */
  team_ppg: Map<number, Ppg>;
  /**
   * NFL team → its game this week, which is what lets a player row say who he
   * plays and when.
   *
   * Keyed by **team and not by player**: which game a player is in is a fact
   * about the club on his row, so keying it per player would carry the same
   * kickoff a dozen times over a league's rosters and leave twelve copies of it
   * free to disagree. The client joins on the team it already draws.
   *
   * Empty is a schedule this process could not read — never "everyone is on a
   * bye". A team missing from a *non-empty* map is the bye, which is the
   * distinction {@link weekGames} keeps and the reason the whole map crosses
   * rather than one entry per rostered team.
   */
  games: Map<string, TeamGame>;
};

/**
 * Assemble {@link LeagueWeekView} for one league and one week.
 *
 * The five reads are independent of each other and run together; each decides
 * for itself whether a failure is fatal at the call site above, since a panel
 * missing one column is worth more than a panel that failed. The schedule read
 * decides for itself down in {@link getWeekGames}, which answers an empty map
 * rather than throwing — its own note says why.
 */
export async function getLeagueWeekView({
  leagueId,
  season,
  week,
  teams,
  rosterPositions,
  scoringSettings,
  bestBall,
  medianMatch,
}: {
  leagueId: string;
  season: string;
  week: number;
  teams: readonly LeagueTeam[];
  rosterPositions: string[] | null;
  scoringSettings: Record<string, number> | null;
  /** Whether Sleeper seats this league's lineup itself — see `compareLineup`. */
  bestBall: boolean;
  /**
   * Whether the league plays every team against the week's median. It decides
   * only whether the fold below *runs*: a league without the setting has no
   * median to beat, and printing the middle of its teams anyway would invent a
   * bar its own scoring never applies.
   */
  medianMatch: boolean;
}): Promise<LeagueWeekView> {
  const playerIds = [
    ...new Set(teams.flatMap((team) => team.players ?? []).filter((id) => id && id !== "0")),
  ];

  const [projection, ppgRead, lineups, teamPpgByRoster, games] = await Promise.all([
    weekProjection({ season, week, playerIds, scoringSettings }),
    playerPpgWindow({ season, week, playerIds, scoringSettings }),
    teamProjection({
      leagueId,
      season,
      week,
      teams,
      rosterPositions,
      scoringSettings,
      bestBall,
    }),
    teamPpgWindow({ leagueId, week, teams }),
    // The same fetch the lineup solve above reads its kickoff instants from,
    // through one process-wide cache — so a panel naming a player's kickoff and
    // the ordering that re-seats him for it cost one schedule request between
    // them, and read one answer.
    getWeekGames(season, week),
  ]);

  return {
    week,
    ppg_source: ppgRead.source,
    projection,
    ppg: ppgRead.ppg,
    team_projection: lineups,
    // Free here and nowhere else: this read already solves every team, so the
    // middle of them is a fold rather than a second solve — see the field's own
    // note. The rule is `medianLineups`', not this file's.
    median: medianMatch ? medianLineups([...lineups.values()]) : null,
    team_ppg: teamPpgByRoster,
    games,
  };
}

/**
 * Every rostered player's projected points for the week, in this league's
 * scoring.
 *
 * **{@link listLineupWeekStats} rather than its horizon twin**, which is the one
 * decision in this function: that read keeps a game already played instead of
 * filtering it out. On a Sunday morning the horizon read has already dropped
 * every Thursday starter, so his projection column would read as an em dash for
 * the rest of the week — for points he did in fact score, in the lineup the
 * reader is looking at. The same call the week's lineup solve makes, so the
 * player's number and the team total above it come off one population.
 */
async function weekProjection({
  season,
  week,
  playerIds,
  scoringSettings,
}: {
  season: string;
  week: number;
  playerIds: string[];
  scoringSettings: Record<string, number> | null;
}): Promise<Map<string, number>> {
  const rows = await listLineupWeekStats({ season, week, playerIds });

  const projection = new Map<string, number>();
  for (const row of rows) {
    projection.set(row.player_id, scoreStatLine(row.stats, scoringSettings));
  }
  return projection;
}

/**
 * Each player's points per game over the weeks before this one — or over last
 * season, where there are none.
 *
 * The fallback is decided **once, for the whole read**, off whether the window
 * has any stored weeks at all. Two different things put it there and both are
 * legitimate: week 1, where the calendar supplies no prior weeks, and a
 * database that has not backfilled the ones that exist. Neither is worth
 * distinguishing to a reader — both mean "nothing this season to average" — and
 * treating the second as a column of em dashes would make a cold install look
 * broken instead of warming up.
 */
async function playerPpgWindow({
  season,
  week,
  playerIds,
  scoringSettings,
}: {
  season: string;
  week: number;
  playerIds: string[];
  scoringSettings: Record<string, number> | null;
}): Promise<{ source: PpgSource; ppg: Map<string, Ppg> }> {
  const window = ppgWindow(week);
  const stored = window.length
    ? await listStoredStatWeeks({ season, weeks: window })
    : [];

  let readSeason = season;
  let weeks = stored;
  let prior = false;

  if (stored.length === 0) {
    const previous = previousSeason(season);
    const priorWeeks = previous
      ? await listStoredStatWeeks({ season: previous, weeks: allRegularWeeks() })
      : [];
    if (previous && priorWeeks.length > 0) {
      readSeason = previous;
      weeks = priorWeeks;
      prior = true;
    }
  }

  const source: PpgSource = { season: readSeason, weeks, prior };
  if (weeks.length === 0) return { source, ppg: new Map() };

  const lines = await listPlayerStatLines({
    season: readSeason,
    weeks,
    playerIds,
  });

  const byPlayer = new Map<string, StatLine[]>();
  for (const line of lines) {
    let held = byPlayer.get(line.player_id);
    if (!held) byPlayer.set(line.player_id, (held = []));
    held.push({ week: line.week, stats: line.stats });
  }

  const ppg = new Map<string, Ppg>();
  for (const [playerId, held] of byPlayer) {
    const reading = playerPpg(held, scoringSettings);
    if (reading) ppg.set(playerId, reading);
  }
  return { source, ppg };
}

/**
 * Each team's best and current lineup for the week.
 *
 * {@link getWeekLineups} rather than a solve of its own — the same call the
 * lineup checker's own rows are built on, so the gap a card prints and the gap
 * the panel it opens prints are one rule, played-game locking included.
 */
async function teamProjection({
  leagueId,
  season,
  week,
  teams,
  rosterPositions,
  scoringSettings,
  bestBall,
}: {
  leagueId: string;
  season: string;
  week: number;
  teams: readonly LeagueTeam[];
  rosterPositions: string[] | null;
  scoringSettings: Record<string, number> | null;
  bestBall: boolean;
}): Promise<Map<number, TeamWeekProjection>> {
  const lineups = await getWeekLineups({
    season,
    week,
    leagues: [
      {
        league_id: leagueId,
        rosterPositions,
        scoringSettings,
        bestBall,
        teams: teams.map((team) => ({
          roster_id: team.roster_id,
          players: team.players,
          starters: team.starters,
          reserve: team.reserve,
          taxi: team.taxi,
        })),
      },
    ],
  });

  const byRoster = new Map<number, TeamWeekProjection>();
  for (const [rosterId, lineup] of lineups.teams.get(leagueId) ?? []) {
    byRoster.set(rosterId, {
      optimal: lineup.optimal_points,
      current: lineup.current_points,
      points_left: lineup.points_left,
      // The points are dropped: every one of them is on `projection`, keyed by
      // the same player id the row is drawn from, so carrying them here would be
      // one number written twice.
      lineup: lineup.lineup.map((seat) => ({
        slot: seat.slot,
        player_id: seat.player_id,
      })),
      sit: lineup.sit,
      start: lineup.start,
      // Already seat-shaped — the ordering never carried points to drop.
      kickoff_order: lineup.kickoff_order,
    });
  }
  return byRoster;
}

/**
 * Each team's points per game over the same window, from what the league
 * recorded.
 *
 * The prior-season half joins on the **owner**, since Sleeper re-issues roster
 * ids across the rollover and they follow nobody — see
 * {@link getPreviousLeagueScores}. A team whose manager did not play last season
 * (an expansion seat, a replacement manager) simply has no entry, which draws an
 * em dash.
 */
async function teamPpgWindow({
  leagueId,
  week,
  teams,
}: {
  leagueId: string;
  week: number;
  teams: readonly LeagueTeam[];
}): Promise<Map<number, Ppg>> {
  const window = ppgWindow(week);
  const scored = window.length
    ? await listRosterWeekPoints({ leagueId, weeks: window })
    : [];

  const played = scored.filter((row) => typeof row.points === "number");
  if (played.length > 0) return group(played, teams);

  // Nothing this season: carry last season's across on the owner.
  const byOwner = await getPreviousLeagueScores(leagueId);
  if (byOwner.size === 0) return new Map();

  const carried: RosterWeekPoints[] = [];
  for (const team of teams) {
    const weeks = team.owner_id ? byOwner.get(team.owner_id) : undefined;
    if (!weeks) continue;
    // Re-keyed onto *this* league's roster id, which is what the panel reads.
    for (const w of weeks) carried.push({ ...w, roster_id: team.roster_id });
  }
  return group(carried, teams);
}

/** Roster-week rows folded into one average per team. */
function group(
  rows: readonly RosterWeekPoints[],
  teams: readonly LeagueTeam[],
): Map<number, Ppg> {
  const byRoster = new Map<number, RosterWeekPoints[]>();
  for (const row of rows) {
    let held = byRoster.get(row.roster_id);
    if (!held) byRoster.set(row.roster_id, (held = []));
    held.push(row);
  }

  const ppg = new Map<number, Ppg>();
  for (const team of teams) {
    const held = byRoster.get(team.roster_id);
    if (!held) continue;
    const reading = teamPpg(held);
    if (reading) ppg.set(team.roster_id, reading);
  }
  return ppg;
}
