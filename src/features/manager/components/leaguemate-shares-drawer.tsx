"use client";

import { useMemo } from "react";

import type {
  ManagerLeague,
  ManagerLeaguematesPayload,
} from "@/shared/contract";

import {
  SharesDrawer,
  subjectKey,
  type LeagueSubjects,
  type SharesDrawerRow,
  type Subject,
} from "@/features/shared";

import { leaguemateShares } from "../helpers/leaguemates";
import { rowRecord } from "../helpers/season-summary";

/**
 * Leaguemate shares: everyone the manager plays against, and in how many
 * leagues.
 *
 * Same population rule as the players drawer beside it — see that file.
 *
 * **The record is a column now rather than a figure hung on the row**, and it
 * is still the manager's *own* combined record across the leagues they share
 * with that person, not the leaguemate's. It is the one number this page can
 * honestly put there: a leaguemate's record lives on their roster row in each
 * league, and reading twelve of those to answer a list is a different query.
 * What it says — "you are 14–8 in the leagues you share with Slim" — is also
 * the more interesting fact. It is folded through `rowRecord`, the same
 * aggregate the identity plate reads: one spelling, two readers.
 *
 * **The note under the name is gone**, which is what the record becoming a
 * column bought: it used to carry that same record, and the same fact twice on
 * one row is one of them too many.
 */
export function LeaguemateSharesDrawer({
  open,
  onClose,
  leagues,
  leagueTotal,
  filterSummary,
  read,
  selfId,
  subjects,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  /** League-filtered, subject-unnarrowed. */
  leagues: readonly ManagerLeague[];
  /** Every league on the page, for the panel's population readout. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  read: {
    data: ManagerLeaguematesPayload | null;
    loading: boolean;
    error: string | null;
  };
  /** The page's manager, dropped from their own list. Null before the stream answers. */
  selfId: string | null;
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
}) {
  const shares = useMemo(
    () =>
      read.data
        ? leaguemateShares(leagues, read.data.members, read.data.users, selfId)
        : null,
    [leagues, read.data, selfId],
  );

  const rows = useMemo<SharesDrawerRow[]>(
    () =>
      (shares?.mates ?? []).map((mate) => ({
        key: mate.user_id,
        id: mate.user_id,
        name: mate.name,
        held: mate.leagues.length,
        // Folded here rather than in the drawer — see `SharesDrawerRow.record`.
        record: rowRecord(mate.leagues),
        // The stored avatar rides through as a url rather than as a mounted
        // `<Avatar>`: the bezel is a fixed 1.875rem and `Avatar`'s `md` grows
        // to 2.25rem inside a container this wide. Same image, same fallback
        // initial — see the drawer's `Badge`.
        badge: {
          round: true,
          imageUrl: mate.avatar_url,
          label: mate.name.charAt(0).toUpperCase(),
        },
      })),
    [shares],
  );

  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectKey)),
    [subjects],
  );

  return (
    <SharesDrawer
      open={open}
      onClose={onClose}
      side="right"
      kind="leaguemate"
      title="Leaguemate shares"
      noun="leaguemates"
      rows={rows}
      leagueCount={shares?.league_count ?? 0}
      leagueTotal={leagueTotal}
      filterSummary={filterSummary}
      loading={read.loading}
      error={read.error}
      emptyMessage="No leaguemates in these leagues yet."
      selected={(subject) => chosen.has(subjectKey(subject))}
      onToggle={onToggle}
    />
  );
}
