"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useMemo, useState } from "react";

import {
  HeaderSlot,
  LeagueFiltersModal,
  PageShell,
  activeFilterCount,
  adpNarrowingCount,
  adpQueryString,
  filterSummary,
  todayIso,
  useAdp,
  useAdpDensity,
} from "@/features/shared";
import { AdpTrigger } from "@/features/shared/ui/adp-trigger";

import { useAdpControls } from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { aggregateRecord } from "../record";

/**
 * The board drawer, loaded the first time it is opened.
 *
 * It is the largest hidden component in the manager tool — the pinned filter
 * block, the value-curve slider, the NFL-calendar layer and the range scrubber's
 * whole brush-over-a-histogram (another ~560 lines on its own) — and none of it
 * is on screen until the trigger is pressed. Statically imported it was parsed
 * and evaluated before the first league card could be drawn, on all three tabs.
 *
 * The **trigger** stays statically imported: it is in the header at first paint,
 * it carries the badge that says what the board is set to, and it is small.
 * Splitting the part that is visible from the part that isn't is the whole point
 * of the exercise — see `TradesHome` for the same split, and `ColumnsBar` for a
 * third.
 */
const AdpDrawer = dynamic(
  () => import("@/features/shared/ui/adp-drawer").then((m) => m.AdpDrawer),
  { ssr: false },
);
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
 * tabs off the one per-manager store: the drawer, and a trigger rendered into
 * the app bar's seat. The two are still two controls and not one — the league
 * filters narrow *this manager's leagues*, the board narrows *the drafts in the
 * database* — and the split is now spatial as well: the filters are a key in the
 * header plate's own bottom edge, over the list they narrow, and the board sits
 * up in the chrome with the population it describes, which belongs to no manager
 * at all. The board names itself inside the drawer; no tab repeats that on the
 * page.
 */
export function LeaguesViewLayout({
  view,
  stat,
  columns,
  children,
}: {
  view: FilteredLeagues;
  /** The tab's own headline count, shown in the header readout's side rail. */
  stat: HeaderStat;
  /**
   * The tab's stat-column headings, pinned with the header — see
   * {@link ManagerHeader}'s own note on why they ride there. Each tab builds its
   * own, since the catalogue behind them is the tab's grain and not this
   * scaffold's business; a tab whose list has no stat columns omits it.
   */
  columns?: ReactNode;
  /** The tab's content, rendered once at least one league passes the filters. */
  children: ReactNode;
}) {
  const { data, searched, progress, refreshing, error, filters, setFilters, filtered } =
    view;
  const { controls, setControls, resetControls, defaultSeason } = useAdpControls();
  const [boardOpen, setBoardOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  if (boardOpen && !everOpened) setEverOpened(true);

  // Gated on the drawer being open: a tab nobody has opened the board on should
  // cost no ADP request. The gate is on the *fetch* and not on the read, which
  // is what the shared cache buys — on the Players tab, whose own column already
  // reads this board, opening the drawer now shows it immediately and asks for
  // nothing. (It used to be two fetches of an identical query, one per hook.)
  const query = useMemo(
    () => adpQueryString(controls, todayIso()),
    [controls],
  );
  const board = useAdp(query, { enabled: boardOpen });

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
        // Named only when it narrows something: the default summary ("all
        // leagues") is the absence of a selection describing itself.
        scope={activeFilterCount(filters) > 0 ? filterSummary(filters) : null}
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
        // Only where there are rows for it to head: a heading rail over "no
        // leagues match these filters" names columns nothing is under.
        columns={filtered.length > 0 ? columns : undefined}
      />

      {/* The trigger is drawn in the app bar rather than in the header's dock —
          the board describes every crawled draft rather than this manager's
          leagues, so it belongs to the chrome the way the tools menu does, and
          up there it is reachable from the bottom of a several-hundred-row list
          on all three tabs. Only its *box* moves: it is still a child of this
          layout, so it reads the same ADP store and drives the drawer below
          without anything being threaded through two server layouts.
          A manager with no leagues has no board worth opening, so the seat
          simply goes unfilled and the bar carries one less part. */}
      {hasLeagues && (
        <HeaderSlot>
          <AdpTrigger
            range={controls.range}
            season={controls.season}
            draftCount={board.data?.draft_count ?? null}
            narrowed={adpNarrowingCount(controls, defaultSeason)}
            onClick={() => setBoardOpen(true)}
          />
        </HeaderSlot>
      )}

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

      {/* Latched rather than gated on `boardOpen`, so the drawer isn't
          unmounted by its own close and a second press is instant. */}
      {everOpened && (
      <AdpDrawer
        open={boardOpen}
        onClose={() => setBoardOpen(false)}
        controls={controls}
        onChange={setControls}
        onReset={resetControls}
        defaultSeason={defaultSeason}
        leagues={data.leagues}
        // The manager's own leagues, so "Match a league…" is a name they
        // recognise — see the prop's note for why the trades board passes none.
        seedLeagues={data.leagues}
        board={board}
        density={density}
      />
      )}
    </PageShell>
  );
}
