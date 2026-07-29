"use client";

import type { PlayerShare } from "../shares";
import { ShareList } from "./share-list";
import { PositionBadge } from "./ui";

/**
 * Every player the manager rosters, most-owned first, each expanding to the
 * leagues that hold him.
 *
 * The table itself is `ShareList`, which `leaguemate-shares` also is — this file
 * is only what goes in the first column: the position pill, and the NFL team as
 * the dim note after the name.
 */
export function PlayerShares({
  shares,
  leagueCount,
}: {
  shares: PlayerShare[];
  /** Leagues the shares are out of — see `PlayerShares.league_count`. */
  leagueCount: number;
}) {
  return (
    <ShareList
      heading="Player"
      rows={shares}
      leagueCount={leagueCount}
      rowKey={(share) => share.player_id}
      icon={(share) => <PositionBadge position={share.position} />}
      note={(share) => share.team}
    />
  );
}
