import type { DraftPickAsset } from "./draft-picks";

/**
 * A manager's league — the shape read from Postgres by {@link getManagerLeagues}
 * and sent to the client on the leagues stream. Single source of truth for both
 * the DB layer and the `manager` feature.
 */
export type ManagerLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar: string | null;
  record: { wins: number; losses: number; ties: number } | null;
  /** League config (roster slots, waivers, etc.), as stored by Sleeper. */
  settings: Record<string, unknown> | null;
  /**
   * The lineup slots, in order — `["QB","RB",…,"BN"]` as Sleeper stores them.
   *
   * Carried on the wire because it holds what `settings` doesn't: what a league
   * actually starts. The client's slot rules count groups of these — how many
   * QB-eligible slots, how many individual defenders, how many flexes — and every
   * group is read through the shared slot vocabulary rather than by matching slot
   * names, so a new flex counts the moment the solver learns it.
   */
  roster_positions: string[] | null;
  /** Scoring rules keyed by stat, as stored by Sleeper. */
  scoring_settings: Record<string, number> | null;
};

/**
 * The team on the other side of a week's matchup — the roster, and whoever owns
 * it as `league_users` has them.
 *
 * `owner_id` is null for an orphan team, and the three name fields are null with
 * it: a roster nobody holds still plays a game, and the row is what says so.
 */
export type MatchupOpponent = {
  roster_id: number;
  owner_id: string | null;
  display_name: string | null;
  team_name: string | null;
  /** Avatar id (not a URL); null when the manager has no avatar. */
  avatar: string | null;
};

/**
 * One league's matchup for a manager in a given week, as read by
 * {@link getManagerMatchups}.
 *
 * **A null `opponent` is a real answer and not a missing one.** Sleeper returns a
 * *side* per roster, and the two sides of a game share a `matchup_id` that is
 * null for a roster with nobody to play — a bye in an odd-sized league, or a week
 * the league hasn't scheduled. A league with nothing stored for the week is
 * absent from the read entirely, which is the other answer: not that there is no
 * opponent, but that we have not fetched one.
 */
export type ManagerMatchup = {
  league_id: string;
  /** The manager's own roster in that league. */
  roster_id: number;
  opponent: MatchupOpponent | null;
};

/**
 * A league member as read from `league_users` — identity only, no roster.
 * Read by {@link getManagerLeaguemates}.
 */
export type Leaguemate = {
  user_id: string;
  display_name: string | null;
  /** Avatar id (not a URL); null when the user has no avatar. */
  avatar: string | null;
};

/**
 * Every member of each of a manager's leagues for a season — what counting
 * leaguemates is built from. `members` keeps the manager's own id so a league
 * they share with nobody still reads as cached rather than missing; `users`
 * resolves each id once, however many leagues share it. Read by
 * {@link getManagerLeaguemates}.
 */
export type ManagerLeaguemates = {
  /** League id → the user ids in that league's cached member list. */
  members: Record<string, string[]>;
  /** User ids → identity, one entry per user. */
  users: Record<string, Leaguemate>;
};

/**
 * One team within a league: its roster (player ids) plus the standings figures
 * derived from the Sleeper roster settings. `manager` is null for orphan teams
 * (no owner assigned). Read by {@link getLeagueDetail}.
 */
export type LeagueTeam = {
  roster_id: number;
  owner_id: string | null;
  manager: {
    user_id: string;
    display_name: string;
    /** Avatar id (not a URL); null when the manager has no avatar. */
    avatar: string | null;
    team_name: string | null;
  } | null;
  record: { wins: number; losses: number; ties: number };
  /** Points for / against, decimals folded in (e.g. 1234.56). */
  fpts: number;
  fpts_against: number;
  /** Every rostered player id. */
  players: string[];
  /** Starting lineup, positionally aligned with the league's starting slots. */
  starters: string[];
  reserve: string[];
  taxi: string[];
  /**
   * The future draft picks this team currently owns — its own untraded picks
   * plus any it acquired, each tagged with the roster it originally belonged to
   * (see {@link ownedDraftPicks}). A dynasty league spans the next three drafts,
   * rolling forward as each rookie class is taken ({@link dynastyPickGrid});
   * every other format shows only the seasons its picks have actually been
   * traded in, which is nothing at all for a redraft league.
   */
  picks: DraftPickAsset[];
};

/**
 * One league's slots, scoring and every team's roster — what projecting all of
 * a manager's leagues in one pass needs, and nothing more: no standings, no
 * member names, none of what {@link getLeagueDetail} resolves for a single
 * league's panel. Read by {@link getManagerLeagueRosters}.
 */
export type LeagueRosterSet = {
  league_id: string;
  /** Ordered starting-slot + bench labels (e.g. ["QB","RB","FLEX","BN"]). */
  roster_positions: string[] | null;
  /** Scoring rules keyed by stat, as stored by Sleeper. */
  scoring_settings: Record<string, number> | null;
  /**
   * Whether Sleeper seats this league's lineup itself. Read by the week's lineup
   * solve, where it is the difference between a gap a manager can act on and one
   * quoted against a lineup nobody sets — see `compareLineup`.
   */
  best_ball: boolean;
  /**
   * Whether the league plays every team against the week's median score as well
   * as against its scheduled opponent — Sleeper's `league_average_match`.
   *
   * Read by the lineup checker's matchups route, where it is the difference
   * between solving the two rosters in a game and solving the whole league: a
   * median is the middle of *every* team's week, so there is no narrower set of
   * rosters that can answer it.
   */
  median_match: boolean;
  teams: {
    roster_id: number;
    owner_id: string | null;
    players: string[];
    starters: string[];
    reserve: string[];
    taxi: string[];
    /**
     * Standings figures from the Sleeper roster settings — every team's, not
     * just the manager's, because ranking the manager by record or points for
     * needs the whole league's. Carried here rather than in a second query since
     * the rosters read is already fetching these rows.
     */
    record: { wins: number; losses: number; ties: number };
    /** Points for, decimals folded in (e.g. 1234.56). */
    fpts: number;
  }[];
};

/**
 * A league's rosters + standings for the expanded league view. `teams` is
 * pre-sorted into standings order (wins, then points for). Read by
 * {@link getLeagueDetail}.
 */
export type LeagueDetail = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  /** Ordered starting-slot + bench labels (e.g. ["QB","RB","FLEX","BN"]). */
  roster_positions: string[] | null;
  /**
   * Scoring rules keyed by stat, as stored by Sleeper. Needed to project this
   * league's rosters: its numbers, not Sleeper's default PPR.
   */
  scoring_settings: Record<string, number> | null;
  /**
   * League config — waivers, the trade deadline, playoff shape — as stored by
   * Sleeper, and the same blob {@link ManagerLeague.settings} carries.
   *
   * Read by nothing on the server: the panel's Settings tab is what asked for
   * it, and it is a blob rather than promoted columns for the reason the schema
   * note gives — promote a key when something queries or joins on it. What is
   * *not* in here is worth knowing before reaching for a key: the roster count
   * is `total_rosters` on the league row (the teams are on this payload, so the
   * panel counts them), and the format is read through `BEST_BALL_SQL` into
   * {@link best_ball} rather than off `settings.best_ball`, so the panel and the
   * board cannot disagree about what best ball is.
   */
  settings: Record<string, unknown> | null;
  /**
   * Whether Sleeper seats this league's lineup itself — see
   * {@link LeagueRosterSet.best_ball}. It reaches the panel as well as the solve,
   * since a starters list with nothing to swap has to say why.
   */
  best_ball: boolean;
  /**
   * Whether the league plays every team against the week's median as well as
   * against its opponent — see {@link LeagueRosterSet.median_match}.
   *
   * Read through the same fragment for the reason `best_ball` is read through
   * one: the lineup checker's row prints a mark against this bar and the panel
   * that row opens prints the bar itself, so a league counted as a median league
   * in one and not the other is a difference no type can catch.
   */
  median_match: boolean;
  /**
   * Sleeper's `settings.type` as `LEAGUE_TYPE_SQL` reads it — 2 for dynasty,
   * 1 for keeper, 0 (and anything unparseable) for redraft.
   *
   * It was always read to build the dynasty pick grid and then dropped; it is
   * carried out now because the *values* read needs exactly this fact to know
   * which of the two ADP markets this league plays in, and it used to buy it
   * with a second query against `leagues` for the league it had already read
   * (`getLeagueAdpBoards([leagueId])`). One read answers both — see
   * {@link adpBoardTypeOf}.
   */
  league_type: number;
  teams: LeagueTeam[];
};
