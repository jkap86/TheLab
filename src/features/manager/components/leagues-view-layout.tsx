"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useMemo } from "react";

import {
  HeaderSlot,
  PageShell,
  activeFilterCount,
  adpNarrowingCount,
  adpBoardRead,
  filterSummary,
  useAdp,
  useAdpDensity,
  useAdpLeagues,
  useTodayIso,
} from "@/features/shared";
import { AdpTrigger } from "@/features/shared/ui/adp-trigger";
import { useLatchedDisclosure } from "@/features/shared/use-latched-disclosure";

import {
  useAdpControls,
  useManagerSeason,
  useSubjectFilters,
} from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { aggregateRecord } from "../record";
import { subjectSummary } from "../subjects";

/**
 * The board drawer, loaded the first time it is opened.
 *
 * It is the largest hidden component in the manager tool — the pinned filter
 * block, the value-curve slider, the NFL-calendar layer and the lookback
 * counter with its density channel — and none of it is on screen until the
 * trigger is pressed. Statically imported it was parsed and evaluated before
 * the first league card could be drawn, on all three tabs.
 *
 * The **trigger** stays statically imported: it is in the header at first paint,
 * it carries the mark that says the board *has been* narrowed, and it is small.
 * Splitting the part that is visible from the part that isn't is the whole point
 * of the exercise — see `TradesHome` for the same split, and `ColumnsBar` for a
 * third.
 *
 * **What that mark is not is a badge naming the setting.** `range`, `season` and
 * `draftCount` are passed to it and reach only its `aria-label`; on screen the
 * trigger lights three bars and says "ADP", which is deliberate — there is no
 * room in the app bar to write the board out, and the drawer names itself the
 * moment it opens. Worth being exact about here, because "says what the board is
 * set to" is a claim a reader on a phone (where there is no hover either) cannot
 * check, and the props' presence makes it look true from this file.
 */
const AdpDrawer = dynamic(
  () => import("@/features/shared/ui/adp-drawer").then((m) => m.AdpDrawer),
  { ssr: false },
);

// The module path rather than `@/features/shared`: the plate is shared with the
// lineup checker now, and it is deliberately kept off that barrel so the pages
// with no plate don't carry it — see the folder's own index.
import {
  ManagerHeader,
  type HeaderStat,
} from "@/features/shared/ui/manager-header";
import { ViewSwitch } from "@/features/shared/ui/view-switch";
import { EmptyState, ErrorCard, LoadingState } from "./manager-leagues-status";
import { SubjectRail } from "./subject-rail";
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
 * database* — and the split is spatial: the filters lead the subject rail below,
 * over the list they narrow and beside the other question asked of it, and the
 * board sits up in the chrome with the population it describes, which belongs to
 * no manager at all. The board names itself inside the drawer; no tab repeats
 * that on the page.
 *
 * **What this layout no longer renders is the filters' key.** It was seated in
 * the header plate's corner and is on the rail now ({@link SubjectRail}), which
 * is why `filters` is destructured here for the scope line alone. The corner
 * seat itself is retired: the lineup checker was the last page in it and grew
 * the same rail, so `ManagerHeader` has no `filters` prop at all now.
 */
export function LeaguesViewLayout({
  view,
  stat,
  columns,
  views,
  children,
}: {
  view: FilteredLeagues;
  /** The tab's own headline count, shown in the header readout's side rail. */
  stat: HeaderStat;
  /**
   * The tab's filter rail and stat-column headings — a {@link ColumnsBar}, whose
   * billet pins itself under the app bar while this list scrolls past. Each tab
   * builds its own, since the catalogue behind the headings is the tab's grain
   * and not this scaffold's business.
   *
   * It is rendered here as a *sibling* of the header and of the list rather than
   * inside either, and that is what makes the pinning work at all: a sticky part
   * travels only as far as its own parent's box, so the box it needs is the one
   * the rows are in — see {@link ListLedge}.
   */
  columns?: ReactNode;
  /**
   * The row between the header plate and the filter rail: which reading of this
   * account is on screen.
   *
   * {@link ViewSwitch} by default — the three views as three routes, the one you
   * are on cut into the page. The leagues list passes its own
   * ({@link ManagerViewDrawers}), because there the other two are drawers over it
   * rather than routes away from it, so the row is two keys and no cell for the
   * page you are already on.
   *
   * A node rather than a flag, since what varies is a whole part and the state
   * behind it: the drawer row owns which browse is up, and a boolean here would
   * make this scaffold the place that knew. The seat and its clearance stay this
   * layout's, which is what keeps the two rows interchangeable.
   */
  views?: ReactNode;
  /** The tab's content, rendered once at least one league passes the filters. */
  children: ReactNode;
}) {
  // `filters` is read for the scope line and nothing else now — the control that
  // *writes* it is seated on the subject rail, which takes both halves off the
  // view it is already handed.
  const { data, searched, progress, refreshing, error, filters, filtered } = view;
  const {
    controls,
    setControls,
    resetControls,
    defaultSeason,
    // The league rules' answer — what the board and every number priced off it
    // are narrowed to. Named apart from this page's own `scope` line below,
    // which is the *manager* filters stated in words.
    scope: boardScope,
  } = useAdpControls();
  const { subjects } = useSubjectFilters();
  // The header's season stepper. `activeSeason` is the ladder's ceiling — the
  // app's own season, resolved on the server by the manager layout — where
  // `selectedSeason` is only read by the cold-load screen: everywhere else the
  // season shown is the one the *payload* came back with, so the tab can never
  // name a season the list beneath it isn't from.
  const {
    season: selectedSeason,
    activeSeason,
    setSeason,
  } = useManagerSeason();
  const {
    open: boardOpen,
    mounted: everOpened,
    show: openBoard,
    hide: closeBoard,
  } = useLatchedDisclosure();

  // Gated on the drawer being open: a tab nobody has opened the board on should
  // cost no ADP request. The gate is on the *fetch* and not on the read, which
  // is what the shared cache buys — on the Players tab, whose own column already
  // reads this board, opening the drawer now shows it immediately and asks for
  // nothing. (It used to be two fetches of an identical query, one per hook.)
  // Watched rather than read once, so a relative window follows the calendar in
  // a tab left open overnight — see {@link useTodayIso}.
  const today = useTodayIso();
  const read = useMemo(
    () => adpBoardRead(controls, boardScope, today),
    [controls, boardScope, today],
  );
  const board = useAdp(read, { enabled: boardOpen });

  // The crawled leagues the board's rules run over, asked for only once the
  // drawer has been opened — the dialog inside it counts its options over this,
  // and the store beside it asks for the same entry whenever a rule is set, so
  // the two gates are one request.
  const { leagues: boardLeagues } = useAdpLeagues(controls.season, {
    enabled: everOpened,
  });

  // The density the window control draws, behind the same gate. It takes no
  // query and re-fetches on nothing: it describes the crawled population
  // *before* any board filter, which is what keeps the bars from reshaping
  // under the hand choosing a window against them.
  const density = useAdpDensity(boardOpen);

  // The header's record, over the leagues the filters leave — so it answers
  // "how am I doing in *these* leagues" and moves when the selection does.
  const record = useMemo(() => aggregateRecord(filtered), [filtered]);

  // The two selections in one phrase, in the order they are applied: what these
  // leagues *are*, then who is in them. Either half may be absent, and both
  // absent is no line at all rather than "all leagues" — the default describing
  // itself is what the plate used to carry permanently.
  const scope = useMemo(() => {
    const parts = [
      activeFilterCount(filters) > 0 ? filterSummary(filters) : null,
      subjectSummary(subjects, view.subjectLabel),
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [filters, subjects, view.subjectLabel]);

  // Cold load: nothing cached yet.
  if (!data) {
    return (
      <PageShell width="wide">
        {error ? (
          <ErrorCard message={error} />
        ) : (
          // The season names itself here because stepping back to one this
          // manager has never been synced for is a cold, foreground sync — the
          // same screen a first visit gets, and the one moment a reader needs
          // telling *which* season they are waiting on. The stepper itself is
          // not drawn on this screen: it belongs to the plate, and a second
          // spelling of it standing alone would be one control with two shapes.
          <LoadingState
            searched={searched}
            season={selectedSeason}
            progress={progress}
          />
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
        // The payload's season, never the selection: they agree today, and
        // saying so here is what stops a cached previous season being shown
        // under a tab naming the one still loading.
        season={season}
        seasonControl={{ latest: activeSeason, onChange: setSeason }}
        refreshing={refreshing}
        progress={progress}
        summary={summary}
        refreshError={error}
        record={record}
        // Named only when it narrows something: the default summary ("all
        // leagues") is the absence of a selection describing itself. The
        // subjects join it because the record beside it is summed over the list
        // *they* leave — a scope line naming only the league filters would be
        // labelling a number counted over something narrower than it says.
        scope={scope}
        leagueCount={filtered.length}
        stat={stat}
      />

      {/* The three views of this account, over the row that narrows whichever
          one you are on. **Ungated where the rail below it is gated on
          `hasLeagues`**, because it is navigation rather than a control over the
          list: an account holding no leagues has nothing to narrow and still has
          a Players tab, so the rail goes and this stays. The cold-load screen
          returns above this, which is right for the same reason — up there the
          header naming the account is not drawn either, and a switch between
          three readings of an account is not worth offering before there is one.

          Seated between the plate and the rail rather than inside either. The
          plate says whose account this is, this says which reading of it, and
          the rail says which rows that reading leaves — three questions, in the
          order they are asked. */}
      {views ?? <ViewSwitch searched={searched} />}

      {/* The page's two filter rows and the list's own heading rail, between the
          card and the rows and belonging to neither: they narrow the list, and
          the billet has to be able to pin over it.

          Drawn whenever there are leagues, and it is the *tab* that says whether
          the heading billet under the subject rail has rows to head — see
          `ColumnsBar`'s `headings`. What must not happen is this slot swapping
          between two different trees as the list narrows: it used to, and
          remounting the rail closed the search panel on exactly the press that
          emptied the list, which is the press that most needs undoing. The
          fallback is only for a tab whose list has not loaded yet. */}
      {hasLeagues && (columns ?? <SubjectRail view={view} />)}

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
            onClick={openBoard}
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
        scope={boardScope}
        onClose={closeBoard}
        controls={controls}
        onChange={setControls}
        onReset={resetControls}
        defaultSeason={defaultSeason}
        leagues={boardLeagues}
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
