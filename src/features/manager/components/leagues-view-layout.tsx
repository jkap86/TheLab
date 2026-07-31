"use client";

import { type ReactNode, useMemo, useState } from "react";

import {
  LeagueFiltersModal,
  PageShell,
  filterSummary,
} from "@/features/shared";

import { adpQueryString, todayIso } from "../adp-controls";
import { useAdpControls } from "../filters-context";
import { useAdp } from "../hooks/use-adp";
import { useAdpDensity } from "../hooks/use-adp-density";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { aggregateRecord } from "../record";
import { AdpDrawer, AdpTrigger } from "./adp-drawer";
import { ManagerHeader, type HeaderStat } from "./manager-header";
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
 * The shared ADP board lives here too, so it opens identically from all three
 * tabs off the one per-manager store: a trigger in the header's state cluster,
 * beside the league filters' own, and the drawer behind it. The two triggers are
 * neighbours and not one control — the league filters narrow *this manager's
 * leagues*, the board narrows *the drafts in the database* — which is why they
 * are separate buttons rather than two sections of one dialog. The board names
 * itself inside the drawer; no tab repeats that on the page.
 */
export function LeaguesViewLayout({
  view,
  stat,
  children,
}: {
  view: FilteredLeagues;
  /** The tab's own headline count, shown in the header readout's side rail. */
  stat: HeaderStat;
  /** The tab's content, rendered once at least one league passes the filters. */
  children: ReactNode;
}) {
  const { data, searched, progress, refreshing, error, filters, setFilters, filtered } =
    view;
  const { controls, setControls, resetControls, defaultSeason } = useAdpControls();
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

  // The strip the range scrubber draws, behind the same gate. It takes no query
  // and re-fetches on nothing: it describes the crawled population *before* any
  // board filter, which is what lets a window be dragged across it without the
  // bars reshaping under the hand choosing them.
  const density = useAdpDensity(boardOpen);

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

  return (
    <PageShell width="wide">
      <ManagerHeader
        user={user}
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
        board={
          hasLeagues ? (
            <AdpTrigger
              range={controls.range}
              season={controls.season}
              draftCount={board.data?.draft_count ?? null}
              loading={board.loading}
              onClick={() => setBoardOpen(true)}
            />
          ) : undefined
        }
      />

      {!hasLeagues ? (
        <EmptyState season={season} />
      ) : (
        <div className="flex flex-col gap-4">
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
        onReset={resetControls}
        defaultSeason={defaultSeason}
        leagues={data.leagues}
        board={board}
        density={density}
      />
    </PageShell>
  );
}
