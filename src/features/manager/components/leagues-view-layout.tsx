"use client";

import type { ReactNode } from "react";

import { PageShell } from "@/features/shared";

import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { ManagerHeader, type ManagerTab } from "./manager-header";
import { LeaguesFilters } from "./manager-leagues-filters";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";
import { PanelMessage } from "./ui";

/**
 * The chrome every `/manager/[searched]/…` tab shares: the wide shell, the
 * cold-load state, the header with its count line, the filter bar, and the note
 * that stands in when the filters match nothing.
 *
 * The three tabs were three line-for-line copies of this scaffold — one edit away
 * from disagreeing on how a cold load, a failed refresh or an empty account
 * looks. Only three things ever varied between them: the count line under the
 * header, the body inside the filters, and (for leagues) that a narrowed count
 * reads "X of Y". Those are the props; everything structural lives here once,
 * paired with {@link useFilteredLeagues}, which owns the stream and filter state
 * this renders around.
 *
 * The body is `children` rather than always rendered so a tab's content only has
 * to reason about a non-empty filtered list: the "no leagues match these filters"
 * case is handled here, above it, the same way for all three.
 */
export function LeaguesViewLayout({
  view,
  active,
  count,
  children,
}: {
  view: FilteredLeagues;
  active: ManagerTab;
  /** The tab's own count line, shown beside the season and sync state. */
  count: ReactNode;
  /** The tab's content, rendered once at least one league passes the filters. */
  children: ReactNode;
}) {
  const { data, searched, progress, refreshing, error, filters, setFilters, filtered } =
    view;

  // Cold load: nothing cached yet.
  if (!data) {
    return (
      <PageShell width="wide">
        {error ? (
          <ErrorCard message={error} />
        ) : (
          <LoadingState searched={searched} progress={progress} />
        )}
      </PageShell>
    );
  }

  const { user, season, summary } = data;

  return (
    <PageShell width="wide">
      <ManagerHeader
        user={user}
        searched={searched}
        active={active}
        season={season}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
        refreshError={error}
      >
        {count}
      </ManagerHeader>

      {data.leagues.length === 0 ? (
        <EmptyState season={season} />
      ) : (
        <>
          <LeaguesFilters filters={filters} onChange={setFilters} />
          {filtered.length === 0 ? (
            <PanelMessage>No leagues match these filters.</PanelMessage>
          ) : (
            children
          )}
        </>
      )}
    </PageShell>
  );
}
