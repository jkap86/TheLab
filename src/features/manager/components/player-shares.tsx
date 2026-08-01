"use client";

import { PLAYER_SHARE_METRICS } from "../share-metrics";
import type { PlayerShare } from "../shares";
import type { AdpPlayerPayload } from "../types";
import { ShareList } from "./share-list";
import { PositionBadge } from "./ui";

/**
 * Every player the manager rosters, most-owned first, each expanding to the
 * leagues that hold him.
 *
 * The list itself is `ShareList`, which `leaguemate-shares` also is — this file
 * is only what goes in the first column (the position pill, and the NFL team as
 * the dim note after the name) and which metrics the cards' stat columns can
 * hold. Players get the ADP ones on top of the shared count-and-record set: the
 * price is looked up by player id from the board `useAdp` fetched, and a player
 * the board didn't price — too few picks in the matched drafts, or none at all —
 * reads as an em dash, the same distinction the projections carry between a real
 * zero and no data.
 */
export function PlayerShares({
  shares,
  leagueCount,
  adp,
  columns,
}: {
  shares: PlayerShare[];
  /** Leagues the shares are out of — see `PlayerShares.league_count`. */
  leagueCount: number;
  /** ADP by player id, from the board the filters selected. */
  adp: Map<string, AdpPlayerPayload>;
  /**
   * The stat-column selection, owned by the tab above — the heading rail that
   * edits it is pinned in the manager header, on the other side of this list.
   */
  columns: string[];
}) {
  return (
    <ShareList
      rows={shares}
      leagueCount={leagueCount}
      rowKey={(share) => share.player_id}
      icon={(share) => <PositionBadge position={share.position} />}
      note={(share) => share.team}
      metrics={PLAYER_SHARE_METRICS}
      columns={columns}
      adpFor={(share) => adp.get(share.player_id) ?? null}
    />
  );
}
