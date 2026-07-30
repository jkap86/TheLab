"use client";

import type { AdpPlayerPayload } from "../types";
import type { PlayerShare } from "../shares";
import { ShareList } from "./share-list";
import { PositionBadge } from "./ui";

/**
 * Every player the manager rosters, most-owned first, each expanding to the
 * leagues that hold him.
 *
 * The table itself is `ShareList`, which `leaguemate-shares` also is — this file
 * is only what goes in the first column (the position pill, and the NFL team as
 * the dim note after the name) and the optional ADP column. The ADP is looked up
 * by player id from the board `useAdp` fetched; a player the board didn't price
 * — too few picks in the matched drafts, or none at all — gets an em dash, the
 * same distinction the projections carry between a real zero and no data.
 */
export function PlayerShares({
  shares,
  leagueCount,
  adp,
}: {
  shares: PlayerShare[];
  /** Leagues the shares are out of — see `PlayerShares.league_count`. */
  leagueCount: number;
  /** ADP by player id, from the board the filters selected. */
  adp: Map<string, AdpPlayerPayload>;
}) {
  return (
    <ShareList
      heading="Player"
      rows={shares}
      leagueCount={leagueCount}
      rowKey={(share) => share.player_id}
      icon={(share) => <PositionBadge position={share.position} />}
      note={(share) => share.team}
      valueHeading="ADP"
      value={(share) => <AdpValue entry={adp.get(share.player_id) ?? null} />}
    />
  );
}

/** One player's ADP cell: the average, with its spread and sample on hover. */
function AdpValue({ entry }: { entry: AdpPlayerPayload | null }) {
  if (!entry) return <span className="text-foreground/25">—</span>;
  return (
    <span
      title={`Picks ${entry.min_pick}–${entry.max_pick} · ${entry.picks} draft${
        entry.picks === 1 ? "" : "s"
      } · ±${entry.stdev.toFixed(1)}`}
    >
      {entry.adp.toFixed(1)}
    </span>
  );
}
