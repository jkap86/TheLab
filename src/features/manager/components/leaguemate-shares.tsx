"use client";

import { Avatar } from "@/features/shared";

import type { LeaguemateShare } from "../leaguemates";
import { ShareList } from "./share-list";

/**
 * Everyone the manager shares a league with, most-shared first, each expanding to
 * the leagues they share.
 *
 * The player-shares table with a person where the player goes — same `ShareList`,
 * so the two can't drift apart. Labelled by username, per the standings rule: a
 * team name is a nickname someone picked for one league, and this list exists to
 * recognise the same person *across* leagues.
 */
export function LeaguemateShares({
  mates,
  leagueCount,
}: {
  mates: LeaguemateShare[];
  /** Leagues the shares are out of — see `LeaguemateShares.league_count`. */
  leagueCount: number;
}) {
  return (
    <ShareList
      heading="Manager"
      rows={mates}
      leagueCount={leagueCount}
      rowKey={(mate) => mate.user_id}
      icon={(mate) => (
        <Avatar url={mate.avatar_url} name={mate.name} size="sm" />
      )}
    />
  );
}
