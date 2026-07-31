"use client";

import { type ReactNode, useMemo, useState } from "react";

import { PageShell } from "@/features/shared";

import { adpQueryString, todayIso } from "../adp-controls";
import { useAdpControls } from "../filters-context";
import { useAdp } from "../hooks/use-adp";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { AdpDrawer, AdpTrigger } from "./adp-drawer";
import { ManagerHeader, type ManagerTab } from "./manager-header";
import { LeaguesFilters } from "./manager-leagues-filters";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";
import { PanelMessage } from "./ui";

/**
 * The chrome every `/manager/[searched]/…` tab shares: the wide shell, the
 * cold-load state, the header — its count line and the filter bar folded into it
 * — and the note that stands in when the filters match nothing.
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
 *
 * The shared ADP board lives here too, so it opens identically from all three
 * tabs off the one per-manager store: a trigger in the header's filter row and
 * the drawer behind it. Its caption — the line naming the board on the page
 * itself, which has to survive the drawer being closed — is the tab's to supply
 * through `adpCaption`.
 */
export function LeaguesViewLayout({
  view,
  active,
  count,
  adpCaption,
  children,
}: {
  view: FilteredLeagues;
  active: ManagerTab;
  /** The tab's own count line, shown beside the season and sync state. */
  count: ReactNode;
  /** The line under the ADP bar — what it drives on this tab. */
  adpCaption?: ReactNode;
  /** The tab's content, rendered once at least one league passes the filters. */
  children: ReactNode;
}) {
  const { data, searched, progress, refreshing, error, filters, setFilters, filtered } =
    view;
  const { controls, setControls } = useAdpControls();
  const [boardOpen, setBoardOpen] = useState(false);

  // Gated on the drawer being open: a tab nobody has opened the board on should
  // cost no ADP request. On the Players tab that means the same board is fetched
  // twice while the drawer is up — its own column already reads it — which is a
  // bounded cost paid only while someone is looking at both.
  const query = useMemo(
    () => adpQueryString(controls, todayIso()),
    [controls],
  );
  const board = useAdp(boardOpen ? query : null);

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
        filters={
          hasLeagues ? (
            <LeaguesFilters
              filters={filters}
              onChange={setFilters}
              trailing={
                <AdpTrigger
                  range={controls.range}
                  draftCount={board.data?.draft_count ?? null}
                  loading={board.loading}
                  onClick={() => setBoardOpen(true)}
                />
              }
            />
          ) : undefined
        }
      >
        {count}
      </ManagerHeader>

      {!hasLeagues ? (
        <EmptyState season={season} />
      ) : (
        <div className="flex flex-col gap-4">
          {adpCaption && (
            <p className="text-xs text-foreground/45">{adpCaption}</p>
          )}
          {filtered.length === 0 ? (
            <PanelMessage>No leagues match these filters.</PanelMessage>
          ) : (
            children
          )}
        </div>
      )}

      <AdpDrawer
        open={boardOpen}
        onClose={() => setBoardOpen(false)}
        controls={controls}
        onChange={setControls}
        leagues={data.leagues}
        board={board}
      />
    </PageShell>
  );
}
