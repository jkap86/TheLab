"use client";

import { useMemo, type ReactNode } from "react";

import { PageShell } from "@/features/shared";

import { defaultAdpControls, seasonOptions } from "../adp-controls";
import { filterSummary } from "../filters";
import { useAdpControls } from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { aggregateRecord } from "../record";
import { AdpFilters } from "./adp-filters";
import { LeagueFiltersModal } from "./league-filters-modal";
import { ManagerHeader, type HeaderStat, type ManagerTab } from "./manager-header";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";
import { PanelMessage } from "./ui";

/**
 * The chrome every `/manager/[searched]/…` tab shares: the wide shell, the
 * cold-load state, the header — its headline count and the filters' trigger
 * folded into it — and the note that stands in when the filters match nothing.
 *
 * The three tabs were three line-for-line copies of this scaffold — one edit away
 * from disagreeing on how a cold load, a failed refresh or an empty account
 * looks. Only three things ever varied between them: the tab's own count, the
 * body inside the filters, and (for leagues) that a narrowed count
 * reads "X of Y". Those are the props; everything structural lives here once,
 * paired with {@link useFilteredLeagues}, which owns the stream and filter state
 * this renders around.
 *
 * The body is `children` rather than always rendered so a tab's content only has
 * to reason about a non-empty filtered list: the "no leagues match these filters"
 * case is handled here, above it, the same way for all three.
 *
 * The header's record is summed here rather than in the header, so it is one
 * memo over the filtered list every tab shares — and so the header stays a thing
 * that renders numbers rather than one that derives them.
 *
 * The shared ADP bar lives here too, so it shows identically on all three tabs
 * from the one per-manager store, above the body but below the empty-filter
 * check — the board is a fact about the market, not about which leagues the
 * header filters leave. Its caption is the tab's to supply through `adpCaption`.
 */
export function LeaguesViewLayout({
  view,
  active,
  stat,
  adpCaption,
  children,
}: {
  view: FilteredLeagues;
  active: ManagerTab;
  /** The tab's own headline count, shown in the header readout's side rail. */
  stat: HeaderStat;
  /** The line under the ADP bar — what it drives on this tab. */
  adpCaption?: ReactNode;
  /** The tab's content, rendered once at least one league passes the filters. */
  children: ReactNode;
}) {
  const { data, searched, progress, refreshing, error, filters, setFilters, filtered } =
    view;
  const { controls, setControls } = useAdpControls();

  // The header's record, over the leagues the filters leave — so it answers
  // "how am I doing in *these* leagues" and moves when the selection does.
  const record = useMemo(() => aggregateRecord(filtered), [filtered]);

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
  const hasLeagues = data.leagues.length > 0;
  const activeControls = controls ?? defaultAdpControls(season);

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
        record={record}
        scope={filterSummary(filters)}
        leagueCount={filtered.length}
        stat={stat}
        filters={
          hasLeagues ? (
            <LeagueFiltersModal
              filters={filters}
              onChange={setFilters}
              leagues={data.leagues}
            />
          ) : undefined
        }
      />

      {!hasLeagues ? (
        <EmptyState season={season} />
      ) : (
        <div className="flex flex-col gap-4">
          <AdpFilters
            controls={activeControls}
            onChange={setControls}
            leagues={data.leagues}
            seasons={seasonOptions(season)}
            caption={adpCaption}
          />
          {filtered.length === 0 ? (
            <PanelMessage>No leagues match these filters.</PanelMessage>
          ) : (
            children
          )}
        </div>
      )}
    </PageShell>
  );
}
