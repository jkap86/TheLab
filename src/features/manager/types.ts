import type {
  AdpPayload,
  AdpPlayerPayload,
  LeagueAdpEntry,
  LeagueDetailPayload,
  LeagueKtcEntry,
  LeagueKtcValue,
  LeaguematePayload,
  LeagueRankSet,
  LeaguesProgressMessage,
  LeaguesResultMessage,
  LeagueTeamPayload,
  ManagerAdpValuePayload,
  ManagerKtcPayload,
  ManagerLeaguematesPayload,
  ManagerPlayersPayload,
  ManagerRanksPayload,
} from "@/shared/contract";
import type {
  DraftPickAsset,
  LeagueRank,
  ManagerLeague,
  ProjectedRank,
} from "@/shared/manager";
import type { PlayerSummary } from "@/shared/players";
import type {
  LeagueOutlook,
  PlayerOutlook,
  PlayerSplit,
  TeamOutlook,
} from "@/shared/projections";

/**
 * The shapes this feature renders.
 *
 * Everything that crosses the network is an alias of the wire contract in
 * `@/shared/contract` rather than a parallel declaration, so the client can't
 * drift from what the routes actually send. Re-exported here so components have
 * one import site.
 */
export type {
  AdpPayload,
  AdpPlayerPayload,
  DraftPickAsset,
  LeagueAdpEntry,
  LeagueKtcEntry,
  LeagueKtcValue,
  LeagueOutlook,
  LeagueRank,
  LeagueRankSet,
  ManagerLeague,
  PlayerOutlook,
  PlayerSplit,
  PlayerSummary,
  ProjectedRank,
  TeamOutlook,
};

/** A team as sent to the client (manager avatar id resolved to a URL). */
export type LeagueTeamView = LeagueTeamPayload;

/** The `/api/league/[leagueId]` response consumed by the expanded league view. */
export type LeagueDetailResult = LeagueDetailPayload;

/** A `result` message from the leagues stream. */
export type LeaguesResult = LeaguesResultMessage;

/** A `progress` message from the leagues stream. */
export type SyncProgress = LeaguesProgressMessage;

/** The `/api/user/[username]/players` response the shares view counts over. */
export type ManagerPlayersResult = ManagerPlayersPayload;

/** A league member as sent to the client (avatar resolved to a URL). */
export type LeaguemateView = LeaguematePayload;

/** The `/api/user/[username]/leaguemates` response that view counts over. */
export type ManagerLeaguematesResult = ManagerLeaguematesPayload;

/** The `/api/user/[username]/ranks` response the league cards annotate from. */
export type ManagerRanksResult = ManagerRanksPayload;

/** The `/api/user/[username]/ktc` response the league cards price from. */
export type ManagerKtcResult = ManagerKtcPayload;

/** The `/api/user/[username]/adp-value` response the league cards value from. */
export type ManagerAdpValueResult = ManagerAdpValuePayload;
