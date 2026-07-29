import type { PlaceholderPick } from "@/shared/picktracker";
import type { PlayerSummary } from "@/shared/players";
import type { LeagueOutlook, ProjectionFilters } from "@/shared/projections";
import type { UserInfo } from "@/shared/sleeper";

import type { AdpFilters } from "./adp-filters";
import type { SyncProgress, SyncSummary } from "./sync";
import type { LeagueDetail, LeagueTeam, ManagerLeague } from "./types";

/**
 * The wire contract between the league API routes and the client that reads
 * them.
 *
 * Declared once, here, and imported by both sides: the route handlers annotate
 * what they send with these types and the `manager` feature annotates what it
 * receives, so a change to one end that the other doesn't follow is a type
 * error rather than a runtime surprise.
 */

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

/** `GET /api/league/[leagueId]` — standings and rosters for one league. */
export type LeagueDetailPayload = Omit<LeagueDetail, "teams"> & {
  teams: LeagueTeamPayload[];
  /** Player ids → resolved name/position/team, for rendering rosters. */
  players: Record<string, PlayerSummary>;
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

/** The error body every league API route returns on a non-2xx. */
export type ApiErrorPayload = { error: string };
