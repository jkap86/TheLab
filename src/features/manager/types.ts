import type {
  LeagueDetailPayload,
  LeaguesProgressMessage,
  LeaguesResultMessage,
  LeagueTeamPayload,
  ManagerLeague,
} from "@/shared/manager";
import type { PlayerSummary } from "@/shared/players";

/**
 * The shapes this feature renders.
 *
 * Everything that crosses the network is an alias of the wire contract in
 * `@/shared/manager` rather than a parallel declaration, so the client can't
 * drift from what the routes actually send. Re-exported here so components have
 * one import site.
 */
export type { ManagerLeague, PlayerSummary };

/** A team as sent to the client (manager avatar id resolved to a URL). */
export type LeagueTeamView = LeagueTeamPayload;

/** The `/api/league/[leagueId]` response consumed by the expanded league view. */
export type LeagueDetailResult = LeagueDetailPayload;

/** A `result` message from the leagues stream. */
export type LeaguesResult = LeaguesResultMessage;

/** A `progress` message from the leagues stream. */
export type SyncProgress = LeaguesProgressMessage;
