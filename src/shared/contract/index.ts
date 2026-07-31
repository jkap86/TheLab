import type {
  AdpFilters,
  AdpRosterValue,
  DraftDensityMonth,
  LeagueDetail,
  Leaguemate,
  LeagueRank,
  LeagueTeam,
  LeagueType,
  ManagerLeague,
  ProjectedRank,
  SyncProgress,
  SyncSummary,
} from "@/shared/manager";
import type { KtcRosterValue } from "@/shared/ktc";
import type { PlaceholderPick } from "@/shared/picktracker";
import type { PlayersSyncSummary, PlayerSummary } from "@/shared/players";
import type { Trade } from "@/shared/trades";
import type {
  LeagueOutlook,
  ProjectionFilters,
  ProjectionsSyncSummary,
} from "@/shared/projections";

/**
 * The wire contract between this app's API routes and the client that reads
 * them — every route's payloads and stream messages, in one module.
 *
 * Declared once, here, and imported by both sides: the route handlers annotate
 * what they send with these types and the `manager` feature annotates what it
 * receives, so a change to one end that the other doesn't follow is a type
 * error rather than a runtime surprise.
 *
 * Types only, and everything it pulls from the domain modules comes in with
 * `import type` — those imports are erased at compile time, which is what lets
 * client code import this module without dragging `pg` into the bundle, and
 * what keeps the manager-module references here from being a runtime cycle.
 */

/** The public user shape returned by the app's user/leagues APIs. */
export type UserInfo = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  avatar_url: string | null;
};

/**
 * A team as sent to the client. The database stores an avatar *id*; the client
 * needs a URL, so the route resolves it and drops the raw id.
 */
export type LeagueTeamPayload = Omit<LeagueTeam, "manager"> & {
  manager:
    | (Omit<NonNullable<LeagueTeam["manager"]>, "avatar"> & {
        avatar_url: string | null;
      })
    | null;
};

/**
 * Per-player KeepTradeCut and ADP values on the board this league reads, for the
 * roster panel's selectable value columns.
 *
 * Both are keyed by player id with unpriced ids *absent* rather than zeroed — an
 * em dash on the roster, not a value of zero, the same reading the collapsed
 * card's KTC total takes. The board a value was read on travels with it
 * (`superflex`, `adp_league_type`), since the same player is worth materially
 * different totals across boards and reading a roster off the wrong one is wrong
 * at every position.
 */
export type LeagueRosterValues = {
  /**
   * Which board priced these: superflex where the league starts more than one
   * quarterback, 1QB otherwise. Shared by both lenses' hovers.
   */
  superflex: boolean;
  /** When the KTC rows were scraped, ISO 8601; null when nothing here is priced. */
  ktc_updated_at: string | null;
  /** The league type whose crawled drafts the ADP board averaged. */
  adp_league_type: LeagueType;
  /** How many crawled drafts stood behind the ADP board — a thin board is noisy. */
  adp_draft_count: number;
  /** Player id → KTC dynasty value on this league's board; unpriced ids absent. */
  ktc: Record<string, number>;
  /** Player id → ADP-derived draft-capital value on this league's board; unpriced absent. */
  adp: Record<string, number>;
  /** Player id → the raw average draft position behind that ADP value, for the hover. */
  adp_position: Record<string, number>;
};

/** `GET /api/league/[leagueId]` — standings and rosters for one league. */
export type LeagueDetailPayload = Omit<LeagueDetail, "teams"> & {
  teams: LeagueTeamPayload[];
  /** Player ids → resolved name/position/team, for rendering rosters. */
  players: Record<string, PlayerSummary>;
  /**
   * Per-player KTC and ADP values on this league's board, for the roster panel's
   * selectable value columns. Always present — an empty set of maps where nothing
   * on these rosters is priced — so the client needn't guard its shape.
   */
  values: LeagueRosterValues;
  /**
   * Every roster's best starting lineup for the rest of the season, ranked on
   * each player's projected points aggregated over `outlook.weeks` and scored
   * with *this* league's `scoring_settings` — so the same player is worth
   * different totals in two leagues, which is the point.
   *
   * One lineup per team rather than one per week: `optimal` answers "who belongs
   * in your starting slots from here", and `current`/`points_left`/`start`/`sit`
   * diff that against what the roster is starting today.
   *
   * `weekly_optimal_points` is the team total for the same horizon and is a
   * different number: it re-sets the lineup every week, so it covers byes and
   * alternating starts, and is the one to show as "what this team projects to
   * score" rather than either lineup's total. `weekly_split` is that same total
   * attributed player by player — how much of each one's projection lands in a
   * starting slot and how much of it never leaves the bench — so it is keyed by
   * player id but scoped to a team, since being stuck behind someone is.
   * `weekly_bench_points` is the team-level sum of those bench halves: the depth a
   * roster is carrying without playing, which is why it sits beside the projected
   * total in the standings rather than being folded into it.
   *
   * The horizon is the weeks actually stored, which the sync keeps a short window
   * of — read `outlook.weeks` rather than assuming it runs to week 18, and say
   * how far ahead the numbers reach wherever they surface.
   *
   * null when the league can't be projected: no slots or scoring settings on
   * file, or no weeks left on the schedule.
   */
  outlook: LeagueOutlook | null;
};

/** A manager's leagues, sent once from cache and again after a refresh. */
export type LeaguesResultMessage = {
  type: "result";
  user: UserInfo;
  season: string;
  leagues: ManagerLeague[];
  /** true when the leagues sent are cached and a refresh is warranted. */
  stale: boolean;
  /** true when a refresh is running and a second `result` will follow. */
  refreshing: boolean;
  /** Present only on the post-refresh message. */
  summary?: SyncSummary;
};

/** Per-league sync progress, so a 100+ league account can show a bar. */
export type LeaguesProgressMessage = SyncProgress & {
  type: "progress";
  /** `initial` is a cold foreground sync; `refresh` runs behind sent cache. */
  phase: "initial" | "refresh";
};

export type LeaguesErrorMessage = { type: "error"; error: string };

/**
 * `GET /api/user/[username]/players` — the manager's own roster in every league
 * they're in, which is what a count of player shares is built from.
 *
 * Rosters carry ids and nothing else: the client already has the league list off
 * the leagues stream and joins on `league_id`, so a league's name, record and
 * settings aren't repeated once per rostered player. `players` resolves the
 * union of those ids once for the same reason — a player on twenty rosters is
 * one entry here, where a per-roster payload would carry him twenty times.
 *
 * Read-only, and deliberately: the leagues stream is what syncs these rosters,
 * so a manager who has never been looked up comes back with an empty `rosters`
 * rather than triggering a second sync of their own.
 */
export type ManagerPlayersPayload = {
  season: string;
  /** League id → the player ids on the manager's roster there. */
  rosters: Record<string, string[]>;
  /** Player ids → name/position/team, for every id above the cache knows. */
  players: Record<string, PlayerSummary>;
};

/** A league member as sent to the client (avatar id resolved to a URL). */
export type LeaguematePayload = Omit<Leaguemate, "avatar"> & {
  avatar_url: string | null;
};

/**
 * `GET /api/user/[username]/leaguemates` — every member of every league the
 * manager is in, which is what a count of shared leagues is built from.
 *
 * The same shape as {@link ManagerPlayersPayload} with user ids where it has
 * player ids, for the same reasons: the client joins `members` against the
 * league list it already holds, and `users` resolves each id once however many
 * leagues share it. `members` keeps the manager's own id — its presence is what
 * marks a league as cached even when they share it with nobody — and the client
 * drops it from the counts, since it knows whose page it is on.
 *
 * Read-only like the sibling `players` route: it reads the membership the
 * leagues stream stored, so a manager it has never run for gets `{}` back.
 */
export type ManagerLeaguematesPayload = {
  season: string;
  /** League id → the user ids in that league's cached member list. */
  members: Record<string, string[]>;
  /** User ids → display name and avatar, for every id above. */
  users: Record<string, LeaguematePayload>;
};

/**
 * `GET /api/user/[username]/trades` — every completed trade in the manager's
 * leagues for a season, newest first.
 *
 * The same side-map shape as {@link ManagerPlayersPayload}: a trade carries ids,
 * and the players and managers those ids name are resolved once each in the maps
 * beside them rather than repeated per trade — a player traded in ten leagues is
 * one entry here. The league is an id for the same reason: the client already
 * holds the league list off the leagues stream, which is also what its league
 * filters read, so a name and a settings blob per trade would be repeated dozens
 * of times over.
 *
 * Read-only over what the leagues stream synced, like its siblings under this
 * prefix — a manager it has never run for gets an empty list rather than a sync
 * of their own, and a league is only as complete as the transaction weeks that
 * sync has fetched.
 */
export type ManagerTradesPayload = {
  season: string;
  /** Newest first, by when each trade completed. */
  trades: Trade[];
  /** Player ids → name/position/team, for every player in `trades` the cache knows. */
  players: Record<string, PlayerSummary>;
  /**
   * User ids → display name and avatar, for every side of every trade whose
   * roster has a cached owner. A side naming a user id absent here is one whose
   * member row isn't stored; the client falls back to the roster number.
   */
  managers: Record<string, LeaguematePayload>;
};

/**
 * The manager's place in one league across the metrics a league card ranks it
 * on. Each is independently nullable, because they don't all answer at the same
 * time: a league that has been drafted but not played has a projected rank and
 * no standings, and one nothing is projected in has the reverse.
 */
export type LeagueRankSet = {
  /** By record — wins, then points for as Sleeper breaks its own ties. */
  standing: LeagueRank | null;
  /** By points for. Carries the total, for saying what the rank is of. */
  points: (LeagueRank & { pointsFor: number }) | null;
  /** By projected points (`weekly_optimal_points`, this league's scoring). */
  proj: ProjectedRank | null;
  /**
   * By projected bench points (`weekly_bench_points`, this league's scoring) —
   * the depth a roster carries without playing, ranked highest-first so the
   * deepest bench is #1. Null on the same terms as `proj`: nothing left to
   * project, or every roster's bench prices at zero (an undrafted or shallow
   * league where no one is behind a starter). Carries the total, like `proj`.
   */
  proj_bench: ProjectedRank | null;
};

/**
 * `GET /api/user/[username]/ranks` — where the manager's roster sits in each of
 * their leagues, by record, by points for, by projected points, and by projected
 * bench.
 *
 * Several rankings rather than one because a card shows them side by side and two
 * of them (record, points for) cost nothing the rosters read wasn't already
 * fetching; only the projected ranks need the projections behind them, and the
 * starters and bench come out of one weekly solve. The KTC starter-value rank
 * travels with the sibling `ktc` route instead, since it is the one that already
 * has the prices.
 *
 * Read-only like the sibling `players` route: it ranks over the rosters and
 * projections the background work has stored, so a manager the leagues stream
 * has never run for gets `{}` rather than a sync of their own.
 */
export type ManagerRanksPayload = {
  season: string;
  /**
   * Weeks the projected totals cover, ascending — the horizon travels with the
   * number here as it does everywhere else. Empty when nothing remains to
   * project, in which case every `proj` is null (the record and points ranks
   * don't depend on it).
   */
  weeks: number[];
  /**
   * League id → the manager's ranks there. A league is absent when none of the
   * three can be formed: the manager holds no roster in it, or its rosters
   * aren't cached; a league present with, say, a `standing` but a null `proj` is
   * one that's been played but has nothing left to project.
   */
  ranks: Record<string, LeagueRankSet>;
};

/** One league's roster priced on KeepTradeCut, and how that value is split. */
export type LeagueKtcValue = KtcRosterValue & {
  /**
   * Which of KTC's two boards priced it: superflex where the league starts more
   * than one quarterback, 1QB otherwise. The same roster is worth materially
   * different totals on the two, so the board travels with the number instead of
   * being assumed by whoever reads it.
   */
  superflex: boolean;
};

/** A league's KTC value plus where its starter value ranks league-wide. */
export type LeagueKtcEntry = LeagueKtcValue & {
  /**
   * The manager's place among their leaguemates by starter KTC value — the
   * `split.starters` half, ranked across every team in the league.
   *
   * Null when the ranking can't be formed: the league can't be projected (so no
   * lineup to draw starters from), or every roster's starters price at zero
   * (an undrafted board). The card shows the rank where it exists and nothing
   * where it doesn't, the same way the projected rank does.
   */
  starters_rank: LeagueRank | null;
};

/**
 * `GET /api/user/[username]/ktc` — what the manager's own roster in each of
 * their leagues is worth on KeepTradeCut, and how much of that value is in a
 * starting lineup rather than behind one.
 *
 * Read-only like its `players` and `ranks` siblings under this prefix: it prices
 * the rosters the leagues stream has already written using the values the KTC
 * scrape has already stored, so a manager nobody has looked up comes back empty
 * rather than triggering a sync of their own.
 *
 * KTC publishes *dynasty* values and this app scrapes only that board, so the
 * numbers describe a keeper asset rather than a season's usefulness — they are
 * the wrong lens on a redraft league, and anything showing them should say
 * "dynasty" rather than leave it to be inferred.
 */
export type ManagerKtcPayload = {
  season: string;
  /**
   * When the KTC rows behind every number here were scraped, ISO 8601 — null
   * when nothing on these rosters is priced. A fifteen-minute cache of someone
   * else's numbers, so a client showing them should be able to say how old they
   * are, as `/api/projections` does.
   */
  updated_at: string | null;
  /**
   * Weeks the lineup behind every `split` was ranked over, ascending. Empty when
   * nothing remains to project, in which case every `split` is null and only the
   * totals are answerable.
   */
  weeks: number[];
  /**
   * League id → that roster's value and its starter-value rank. A league is
   * absent when the manager holds no roster in it; a league whose roster KTC
   * prices nothing is present with a zero total and `priced: 0`, which is a real
   * answer rather than a gap — a pre-draft roster is empty and a roster of
   * kickers is off the board.
   */
  leagues: Record<string, LeagueKtcEntry>;
};

/** One league's roster priced on ADP-derived draft value, and how it splits. */
export type LeagueAdpValue = AdpRosterValue & {
  /**
   * Which ADP board priced it: superflex where the league starts more than one
   * quarterback, 1QB otherwise. A quarterback goes far earlier in superflex
   * drafts, so the same roster is worth a different total on the two — the board
   * travels with the number rather than being assumed by whoever reads it, the
   * same rule the KTC value follows.
   */
  superflex: boolean;
  /**
   * The league type whose crawled drafts the board averaged — a dynasty startup
   * drafts rookies a redraft never sees, so pooling them would misprice both.
   */
  league_type: LeagueType;
  /**
   * How many crawled drafts stood behind this board. Shipped with the number the
   * way `/api/adp` reports what it averaged: a thin board is a noisy one, and a
   * board of zero is why a roster can come back unpriced.
   */
  draft_count: number;
};

/** A league's ADP value plus where its starter value ranks league-wide. */
export type LeagueAdpEntry = LeagueAdpValue & {
  /**
   * The manager's place among their leaguemates by starter ADP value — the
   * `split.starters` half, ranked across every team. Null on the same terms as
   * the KTC rank: no lineup to draw starters from, or every roster prices at zero
   * (a board with no matching drafts, or a pre-draft league).
   */
  starters_rank: LeagueRank | null;
};

/**
 * `GET /api/user/[username]/adp-value` — what the manager's roster in each league
 * is worth valued off crawled ADP, and where its starter value ranks.
 *
 * A third team-value lens beside `ktc` and the projected `ranks`: KTC is a
 * *dynasty* board and projections are a points model, where this reads the
 * *market consensus* of the drafts this app has actually crawled, priced against
 * the boards most like each league. Read-only over synced rosters and crawled
 * draft picks, like its siblings under this prefix.
 */
export type ManagerAdpValuePayload = {
  season: string;
  /**
   * Weeks the lineup behind every `split` was ranked over, ascending. Empty when
   * nothing remains to project, in which case every `split` is null and only the
   * totals answer.
   */
  weeks: number[];
  /**
   * League id → that roster's ADP value and its starter-value rank. Absent for a
   * league the manager holds no roster in; present with a zero total and
   * `priced: 0` where no rostered player is on the matching board.
   */
  leagues: Record<string, LeagueAdpEntry>;
};

/**
 * One newline-delimited JSON message on the
 * `GET /api/user/[username]/leagues` stream. Discriminated by `type`.
 */
export type LeaguesStreamMessage =
  | LeaguesResultMessage
  | LeaguesProgressMessage
  | LeaguesErrorMessage;

/**
 * One player's ADP row. Unlike the roster payloads, the player is resolved
 * inline rather than through a side map — each player appears exactly once here,
 * so there is nothing to deduplicate. `name` falls back to the player id when
 * the players cache doesn't know the id.
 */
export type AdpPlayerPayload = {
  /** Position in the full filtered set, 1-based — not within the page. */
  rank: number;
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  adp: number;
  min_pick: number;
  max_pick: number;
  stdev: number;
  /** Drafts that took this player, of `draft_count` matched. */
  picks: number;
};

/** `GET /api/adp` — ADP over the crawled drafts matching the query. */
export type AdpPayload = {
  /** The filters actually applied, defaults included. */
  filters: AdpFilters;
  /** Drafts the filters matched. */
  draft_count: number;
  /** Players in the full filtered set; 0 when the requested page is past its end. */
  player_count: number;
  players: AdpPlayerPayload[];
};

/**
 * `GET /api/adp/density` — crawled drafts per calendar month, for the strip the
 * board's date range is chosen against.
 *
 * A separate route from `/api/adp` rather than a field on it, because it answers
 * a question the board's filters must not touch: the histogram has to hold still
 * while a window is dragged across it. Sending it with the board would tie the
 * two together and refetch a whole shape every time one chip moves.
 */
export type AdpDensityPayload = {
  /** Ascending by month; months with no crawled drafts are absent, not zero. */
  months: DraftDensityMonth[];
};

/**
 * One player's projection for a week. The player is resolved inline, as in
 * `AdpPlayerPayload` — a player appears once per week, so there is nothing a side
 * map would deduplicate.
 *
 * `team` comes from the projection rather than the players cache: they disagree
 * after a trade, and the one that matters is who the player was projected as
 * playing for that week.
 */
export type ProjectionPlayerPayload = {
  /** Position in the full filtered set, 1-based — not within the page. */
  rank: number;
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  opponent: string | null;
  /** `YYYY-MM-DD` of the game. */
  game_date: string | null;
  /** Projected points in the requested scoring; null when Sleeper published none. */
  points: number | null;
  /** The full projected stat line, only when `?stats=1` was asked for. */
  stats?: Record<string, number>;
};

/** `GET /api/projections` — a week of stored projections, ranked. */
export type ProjectionsPayload = {
  /** The filters actually applied, with `week` resolved if it was left out. */
  filters: ProjectionFilters;
  /**
   * When these rows were last written, ISO 8601 — null when the week has none.
   * This is a cache of Sleeper's numbers, so a client showing them should say how
   * old they are.
   */
  updated_at: string | null;
  /** Players in the full filtered set; 0 when the page is past its end. */
  player_count: number;
  players: ProjectionPlayerPayload[];
};

/**
 * One placeholder pick as sent to the client: the pick tracker's kicker pick,
 * with the picking manager's avatar *id* resolved to a URL (as in
 * `LeagueTeamPayload`) and the raw id dropped.
 */
export type PicktrackerPickPayload = Omit<PlaceholderPick, "picked_by"> & {
  picked_by:
    | (Omit<NonNullable<PlaceholderPick["picked_by"]>, "avatar"> & {
        avatar_url: string | null;
      })
    | null;
};

/** `GET /api/picktracker/[leagueId]` — a league's placeholder draft, live. */
export type PicktrackerPayload = {
  league: {
    league_id: string;
    name: string;
    avatar_url: string | null;
  };
  draft_status: string;
  /** Teams per round — what the round.slot labels are numbered against. */
  teams: number;
  picks: PicktrackerPickPayload[];
  /** The placeholder now on the clock; null once the draft is complete. */
  next_pick: string | null;
};

/**
 * What `/api/projections/sync` answers with. The sync routes have no client
 * reader today (they exist for operators and cron), but their payloads live
 * here with everyone else's — a payload declared beside its route is exactly
 * the drift this module exists to stop.
 */
export type ProjectionsSyncPayload = ProjectionsSyncSummary;

/** What `/api/players/sync` answers with — see {@link ProjectionsSyncPayload}. */
export type PlayersSyncPayload = PlayersSyncSummary;

/** The error body every league API route returns on a non-2xx. */
export type ApiErrorPayload = { error: string };
