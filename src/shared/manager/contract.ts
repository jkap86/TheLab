import type { PlayerSummary } from "@/shared/players";
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

/** The error body every league API route returns on a non-2xx. */
export type ApiErrorPayload = { error: string };
