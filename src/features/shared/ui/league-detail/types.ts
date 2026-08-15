import type {
  LeagueRosterValues,
  LeagueTeamPayload,
  LeagueWeekViewPayload,
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
  LeagueWeekViewPayload,
  PlayerOutlook,
  PlayerSplit,
  PlayerSummary,
  TeamOutlook,
};

/**
 * The week's numbers as the two tables read them: the payload, or null where the
 * panel was opened on a season or the week's read failed.
 *
 * One alias rather than three spellings of `LeagueWeekViewPayload | null` down
 * the tree, since every consumer treats "not asked for" and "asked for and
 * unanswerable" the same way — the metrics draw an em dash and say which.
 */
export type LeagueWeekView = LeagueWeekViewPayload | null;

/** A team as sent to the client (manager avatar id resolved to a URL). */
export type LeagueTeamView = LeagueTeamPayload;

/**
 * What this panel is drawn from: the core league read with whichever of its
 * three enrichments have landed.
 *
 * It is no longer one route's response — the prices, the outlook and the week
 * are three requests of their own now — so it is assembled by
 * {@link useLeagueDetail} and aliased here rather than in the contract, which
 * holds wire shapes and this is not one. The panel's own components are
 * unchanged by that: they always took empty prices and a null outlook as "no
 * answer yet", which is exactly what a request still in flight looks like.
 */
export type { LeagueDetailResult } from "../../use-league-detail";
