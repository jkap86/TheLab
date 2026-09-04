"use client";

import { useMemo } from "react";

import type {
  ManagerLeague,
  ManagerLeaguematesPayload,
} from "@/shared/contract";
import { Avatar } from "@/features/shared";

import type { LeagueSubjects, Subject } from "../helpers/league-subjects";
import { subjectKey } from "../helpers/league-subjects";
import { leaguemateShares } from "../helpers/leaguemates";
import { formatCombinedRecord, seasonSummary } from "../helpers/season-summary";
import { SharesDrawer, type SharesDrawerRow } from "./shares-drawer";

/**
 * Leaguemate shares: everyone the manager plays against, and in how many
 * leagues.
 *
 * Same population rule as the players drawer beside it — see that file.
 *
 * The extra figure on a row is **the manager's own** combined record across the
 * leagues they share with that person, not the leaguemate's. It is the one
 * number this page can honestly put there: a leaguemate's record lives on their
 * roster row in each league, and reading twelve of those to answer a list is a
 * different query. What it says — "you are 14–8 in the leagues you share with
 * Slim" — is also the more interesting fact.
 */
export function LeaguemateSharesDrawer({
  open,
  onClose,
  leagues,
  read,
  selfId,
  subjects,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  /** League-filtered, subject-unnarrowed. */
  leagues: readonly ManagerLeague[];
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
      (shares?.mates ?? []).map((mate) => {
        // Reuses the console's own aggregate, so the record in this row and the
        // one in the summary housing cannot be computed two different ways —
        // a league with no stored record is skipped rather than counted 0–0.
        const summary = seasonSummary(mate.leagues);
        // `formatCombinedRecord` always spells a string, so the gate is the
        // game count: a set of leagues that have played nothing shows no
        // record rather than a `0–0` claiming they went winless.
        const record = summary.games > 0 ? formatCombinedRecord(summary) : null;
        return {
          key: mate.user_id,
          id: mate.user_id,
          name: mate.name,
          held: mate.leagues.length,
          leagues: mate.leagues,
          icon: <Avatar url={mate.avatar_url} name={mate.name} size="md" />,
          extra: record ? (
            <span className="shrink-0 whitespace-nowrap font-mono text-[0.6875rem] tabular-nums text-foreground/55">
              {record}
            </span>
          ) : null,
        };
      }),
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
      loading={read.loading}
      error={read.error}
      emptyMessage="No leaguemates in these leagues yet."
      selected={(subject) => chosen.has(subjectKey(subject))}
      onToggle={onToggle}
    />
  );
}
