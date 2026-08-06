import type {
  LeagueDetailPayload,
  LeagueRosterValues,
  LeagueTeamPayload,
} from "@/shared/contract";
import type { DraftPickAsset } from "@/shared/manager";
import type { PlayerSummary } from "@/shared/players";
import type {
  LeagueOutlook,
  PlayerOutlook,
  PlayerSplit,
  TeamOutlook,
} from "@/shared/projections";

/**
 * The shapes this panel renders.
 *
 * Aliases of the wire contract rather than parallel declarations, so the panel
 * can't drift from what `/api/league/[leagueId]` actually sends — the same
 * arrangement `features/manager/types.ts` keeps for that feature, gathered here
 * so the panel's six components have one import site. Types only: everything
 * arrives as an erased `import type`, which is what lets these client files read
 * the domain barrels without dragging `pg` into the bundle.
 */
export type {
  DraftPickAsset,
  LeagueOutlook,
  LeagueRosterValues,
  PlayerOutlook,
  PlayerSplit,
  PlayerSummary,
  TeamOutlook,
};

/** A team as sent to the client (manager avatar id resolved to a URL). */
export type LeagueTeamView = LeagueTeamPayload;

/** The `/api/league/[leagueId]` response this panel is drawn from. */
export type LeagueDetailResult = LeagueDetailPayload;
