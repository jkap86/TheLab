"use client";

import { Avatar } from "@/features/shared";

import type { LeaguemateShare } from "../leaguemates";
import { LEAGUEMATE_SHARE_METRICS } from "../share-metrics";
import { ShareList } from "./share-list";

/**
 * Everyone the manager shares a league with, most-shared first, each expanding to
 * the leagues they share.
 *
 * The player-shares list with a person where the player goes — same `ShareList`,
 * so the two can't drift apart. Labelled by username, per the standings rule: a
 * team name is a nickname someone picked for one league, and this list exists to
 * recognise the same person *across* leagues.
 *
 * Its cards offer the shared metrics only: the ADP ones price a *player*, so a
 * menu holding them here would offer a column that can never answer. The record
 * columns are the manager's own across the shared leagues — how he fares against
 * the crowd this person is part of.
 */
export function LeaguemateShares({
  mates,
  leagueCount,
  columns,
  onColumnChange,
  onReset,
}: {
  mates: LeaguemateShare[];
  /** Leagues the shares are out of — see `LeaguemateShares.league_count`. */
  leagueCount: number;
  /**
   * The stat-column selection, owned by the tab above — the heading rail that
   * edits it is pinned in the manager header, on the other side of this list.
   */
  columns: string[];
  onColumnChange: (slot: number, key: string) => void;
  onReset: () => void;
}) {
  return (
    <ShareList
      rows={mates}
      leagueCount={leagueCount}
      rowKey={(mate) => mate.user_id}
      icon={(mate) => (
        <Avatar url={mate.avatar_url} name={mate.name} size="sm" />
      )}
      metrics={LEAGUEMATE_SHARE_METRICS}
      columns={columns}
      onColumnChange={onColumnChange}
      onReset={onReset}
    />
  );
}
