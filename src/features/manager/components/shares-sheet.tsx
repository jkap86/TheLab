"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import dynamic from "next/dynamic";

import { LeagueFiltersPlaceholder } from "@/features/shared";

import { useSubjectFilters } from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import type { ColumnPreset } from "../metric-cell";
import { rankByName } from "../name-search";
import type { ShareMetric, ShareMetricContext } from "../share-metrics";
import {
  type SubjectKind,
  removeSubjectAt,
  subjectKey,
  toggleSubject,
} from "../subjects";
import type { AdpPlayerPayload } from "../types";
import { ColumnsBar } from "./columns-bar";
import { ErrorCard } from "./manager-leagues-status";
import type { ShareRow } from "./share-list";
import { MatchToggle, SubjectToken } from "./subject-parts";
import { PanelLoading, PanelMessage } from "./ui";

/**
 * The league filters, split from this sheet the way both other call sites split
 * them — the module path named directly rather than the `@/features/shared`
 * barrel, since a re-export there puts the dialog in the static graph of every
 * page importing anything from that barrel and the `dynamic()` then defers bytes
 * the browser has already been sent. The placeholder holds the key's box in the
 * title bar while the chunk lands.
 */
const LeagueFiltersModal = dynamic(
  () =>
    import("@/features/shared/ui/league-filters-modal").then(
      (m) => m.LeagueFiltersModal,
    ),
  {
    ssr: false,
    loading: () => <LeagueFiltersPlaceholder label="Filters" seat="bar" />,
  },
);

/** How the shell hands its selection wiring to the list it is drawing. */
export type SharesSelection<T> = {
  /** Whether this row is one of the subjects narrowing the league list. */
  isSelected: (row: T) => boolean;
  /** Toggle it — the sheet commits live, so a press is the whole gesture. */
  onSelect: (row: T) => void;
};

/**
 * A shares browse, as a sheet over the leagues page.
 *
 * It replaces the 26rem panel the *shares* keys used to drop under the rail, and
 * the thing it replaces is not the list — it is what the list was allowed to say.
 * A name and a count is the table the Players and Leaguemates tabs were before
 * their columns were pickable, while either tab is one click away carrying
 * exposure, record, win rate, league mix and (for a player) the board price for
 * exactly these rows. So the sheet is that tab's list, over this one, with the
 * same four pickable columns and the league filters key beside them.
 *
 * **It is one shell for both kinds, and that is the same argument
 * {@link ShareList} settles one level down.** A player share and a leaguemate
 * share are the same subject held across some of the manager's leagues, so the
 * dialog, the field, the columns rail, the count readout and the selection wiring
 * are the same apparatus twice — and a second copy of it is one width change away
 * from the two browses disagreeing about how a share reads, in whichever file
 * didn't get edited. What varies is the population, the catalogue and the words,
 * which is what the props are; the two variants that supply them are
 * {@link PlayerSharesSheet} and {@link LeaguemateSharesSheet}, and each is the
 * reads plus its own copy and nothing else.
 *
 * Five things are load-bearing.
 *
 * **It is glass, and the glass is spent on the frame.** Everything else in this
 * app is a lit metal face on an opaque ground, so a translucent panel is the one
 * new material here: it is what says the leagues page is still underneath rather
 * than navigated away from, which is what keeps a sheet this size honest about
 * being a control over that page. The rows themselves sit on an opaque well —
 * four numbers a row read over a hundred league cards drifting behind them is the
 * one thing the effect is not allowed to buy.
 *
 * **A native `<dialog>`, and that is what makes the two keys safe.** The filters
 * modal and the columns editor are dialogs of their own opened from inside this
 * one; the platform stacks them in the top layer, closes the innermost on Escape,
 * and — the part a hand-rolled overlay gets wrong — a press inside them never
 * reaches this dialog's own box, so the backdrop-click dismissal below can't fire
 * under them. The rail's panel dismisses on a document `pointerdown` for want of
 * that, which is exactly the listener that would have closed this sheet the moment
 * a filter was pressed.
 *
 * **It commits live.** A row press toggles the subject and the league list behind
 * the glass narrows immediately — there is no draft and no Apply, because a row's
 * count states how many leagues hold *that* subject, which is true whatever else
 * is picked. The bar's readout is the same `N of M` the rail carries, so the sheet
 * states its effect where a reader can see it without moving the sheet.
 *
 * **The list is counted over `leagueFiltered`, not over `filtered`.** The menu a
 * selection is made from must not collapse to that selection — the rule
 * `subjectOptions` keeps, and the reason the sheet's own denominator can differ
 * from the page's count by design: the numerator is what you picked, the
 * denominator is what you picked it from. Each variant counts its own shares over
 * that list rather than the shell doing it, since a share's denominator is the
 * population that contributed one (rosters for a player, member lists for a
 * person) and never simply the leagues on screen.
 *
 * **The columns are the matching tab's columns.** Same persisted `share`
 * selection, same catalogue, so aiming a column here aims it there — one board
 * seen twice rather than two that agree until someone changes one.
 */
export function SharesSheet<T extends ShareRow>({
  view,
  open,
  onClose,
  kind,
  title,
  subject,
  loadingLabel,
  emptyLabel,
  noMatchLabel,
  rows,
  leagueCount,
  error,
  subjectId,
  metrics,
  presets,
  columns,
  adp,
  onColumnChange,
  onColumns,
  onReset,
  children,
}: {
  view: FilteredLeagues;
  open: boolean;
  onClose: () => void;
  /** Which half of the selection a row of this list is — see {@link Subject}. */
  kind: SubjectKind;
  /** The sheet's own name, in the title bar: `Player shares`. */
  title: string;
  /**
   * What one row is — the heading over the name column, and the noun the storey
   * counts in. Singular and capitalised (`Player`, `Leaguemate`).
   */
  subject: string;
  /** What is being read while `rows` is null — the populations differ per kind. */
  loadingLabel: string;
  /** A real answer, not an error: the filtered leagues hold nobody of this kind. */
  emptyLabel: string;
  /** Nothing matched what was typed — the field's own empty state. */
  noMatchLabel: string;
  /**
   * Every row, most-shared first, or null while the population behind them is
   * still being read. Unfiltered by the field: narrowing to what a reader typed is
   * this shell's, so the count and the preview subject can't disagree with it.
   */
  rows: T[] | null;
  /** Leagues the shares are out of — each variant's own `league_count`. */
  leagueCount: number;
  /** A failed read, shown only when there are no rows to keep on screen. */
  error: string | null;
  /**
   * The row's Sleeper id: the subject it toggles, and its key in the list. One
   * function because a share row *is* a subject — a player id or a user id.
   */
  subjectId: (row: T) => string;
  /** The catalogue this list's columns pick from, for the rail and the editor. */
  metrics: ShareMetric[];
  presets: ColumnPreset[];
  columns: string[];
  /**
   * The ADP board the market metrics read, where this list's rows are on one —
   * omitted by the leaguemates variant, exactly as `ShareList.adpFor` is.
   */
  adp?: Map<string, AdpPlayerPayload>;
  onColumnChange: (slot: number, key: string) => void;
  onColumns: (keys: readonly string[]) => void;
  onReset: () => void;
  /** The list itself, given what survived the field and how to pick a row. */
  children: (rows: T[], selection: SharesSelection<T>) => React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Generated for the reason the two dialogs *inside* this one generate theirs:
  // a literal id in a component is a duplicate waiting for a second mount.
  const titleId = useId();
  const [query, setQuery] = useState("");
  const { subjects, setSubjects } = useSubjectFilters();

  // The field is live over the whole list rather than capped, which is the point
  // of the browse: what the search panel's top eight leaves out is the tail a
  // reader came here to scroll.
  const shown = useMemo(
    () => (rows ? rankByName(rows, (row) => row.name, query, Infinity) : []),
    [rows, query],
  );

  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectKey)),
    [subjects.subjects],
  );
  const selection = useMemo<SharesSelection<T>>(
    () => ({
      isSelected: (row) => chosen.has(subjectKey({ kind, id: subjectId(row) })),
      onSelect: (row) =>
        setSubjects(toggleSubject(subjects, { kind, id: subjectId(row) })),
    }),
    [chosen, kind, subjectId, subjects, setSubjects],
  );

  // The one thing a `<dialog>` can't be told declaratively. `close` fires for
  // Escape and the backdrop alike, so the parent hears every way out through the
  // same handler.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      // `showModal` autofocuses the first focusable descendant, which here is the
      // filters key — a control wearing a focus ring reads as pressed. The field
      // takes it instead: the sheet is opened to be typed into or scrolled, and
      // the trap and Escape still belong to the dialog.
      inputRef.current?.focus();
    }
  }, [open]);

  // Reopening on a stale query would show a filtered list under an emptied field
  // on the next open otherwise — the field is cleared on the way out, not the
  // way in, so nothing flashes while the sheet is still on screen.
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const leagues = view.data?.leagues ?? null;
  const total = view.leagueFiltered.length;
  const picked = subjects.subjects.length;
  const noun = subject.toLowerCase();
  const first = rows?.[0] ?? null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // **Both handlers test the target, and `onClose` has to.** The filters
      // modal and the columns editor are dialogs *inside* this one, and React
      // walks its own tree for `close` — which does not bubble in the DOM — so
      // an unguarded handler here fires when either of them closes, taking the
      // sheet down with the dialog a reader just dismissed. That is the rule the
      // platform's stacking otherwise gives for free, and the one thing this
      // sheet has to spell out.
      onClose={(event) => {
        if (event.target === ref.current) close();
      }}
      // The backdrop is the dialog's own pseudo-element, so a click landing on
      // the dialog box itself is a click outside the panel.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      // A thinner scrim than the other two dialogs wear: this one is meant to be
      // seen through, and at their 0.72 the page behind the glass is gone.
      className="m-auto h-[min(88vh,54rem)] w-[min(1180px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.5)]"
    >
      <div
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-active/25 bg-gradient-to-b from-[rgba(24,45,60,0.72)] to-[rgba(9,20,31,0.86)] shadow-[0_50px_90px_-30px_rgba(0,0,0,0.95),0_0_70px_-24px_rgba(0,255,229,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl"
        style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
      >
        {/* The panel's specular rail, as the filters dialog and the header plate
            wear — without it a face this large reads as a sheet of glass rather
            than as a milled part made of it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/70 to-transparent"
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-transparent px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-4">
          <h2
            id={titleId}
            className="shrink-0 font-display text-sm font-semibold tracking-tight"
          >
            {title}
          </h2>

          {/* The league filters, in the bar rather than left behind on the page:
              every row's share is out of the leagues the *other* filters leave,
              so narrowing to dynasty rewrites all 981 numbers and reorders the
              list under them. It opens over this sheet, which is the platform's
              own stack — see the note above on why that is safe here. */}
          {leagues && leagues.length > 0 && (
            <LeagueFiltersModal
              filters={view.filters}
              onChange={view.setFilters}
              leagues={leagues}
              seat="bar"
            />
          )}

          <div className="order-last flex min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-foreground/10 bg-[#06111b] px-2.5 py-1.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-within:border-active/60 sm:order-none sm:basis-auto">
            <SearchIcon />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun} shares`}
              aria-label={`Search ${noun} shares`}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/30"
            />
          </div>

          {/* The sheet's own answer, in the words the rail uses for it. Dimmed
              while the maps behind a selection are still being read, since the
              number is briefly zero and a confident zero is worse than an
              obviously pending one. */}
          <span
            // The sheet commits live, so this is the only feedback a press on a
            // row gives — announced when it moves rather than only when a reader
            // navigates back up to it.
            role="status"
            className={`ml-auto shrink-0 font-mono text-[11px] tabular-nums sm:ml-0 ${
              view.subjectsLoading ? "text-foreground/25" : "text-foreground/55"
            }`}
          >
            {picked > 0 ? (
              <>
                <b className="font-bold text-active">{view.filtered.length}</b> of{" "}
                {total} leagues
              </>
            ) : (
              `${total} leagues`
            )}
          </span>

          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="lab-chip lab-chip-sm grid size-7 shrink-0 place-items-center rounded-full text-foreground/55 transition-colors hover:text-active"
          >
            <CloseIcon />
          </button>
        </div>

        {/* `px-2` on the rail, to the pixel: the ledge is laid on a card's own
            geometry (its border, its `pl-5`), and inside the sheet the cards
            carry the well's padding on top of that. Without the same 8px here
            every heading would sit short of the number it names. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4">
          {first && (
            <div className="px-2">
              <ColumnsBar
                metrics={metrics}
                columns={columns}
                subject={subject}
                presets={presets}
                // The head of the *unfiltered* list rather than of what the field
                // left: the preview says what a metric looks like, and a reader
                // who has typed three letters should not find the editor
                // previewing whoever that happened to match. Named in the
                // editor's footer, so a share count can't pass as the column's
                // own answer.
                ctx={{
                  leagues: first.leagues,
                  leagueCount,
                  adp: adp?.get(subjectId(first)) ?? null,
                } satisfies ShareMetricContext}
                previewLabel={first.name}
                onColumnChange={onColumnChange}
                onColumns={onColumns}
                onReset={onReset}
                storey={
                  // The tokens name themselves and the rows say what a press
                  // does by doing it, so the storey carries no caption and no
                  // instruction: with nothing picked it is the count alone.
                  <>
                    {subjects.subjects.map((token, i) => (
                      <SubjectToken
                        key={subjectKey(token)}
                        subject={token}
                        label={view.subjectDisplay(token)}
                        onRemove={() => setSubjects(removeSubjectAt(subjects, i))}
                      />
                    ))}
                    {picked > 1 && (
                      <MatchToggle
                        match={subjects.match}
                        onMatch={(match) => setSubjects({ ...subjects, match })}
                      />
                    )}
                    <span className="ml-auto shrink-0 pr-1 font-mono text-[10px] tabular-nums text-foreground/55">
                      {shown.length} {noun}
                      {shown.length === 1 ? "" : "s"}
                    </span>
                  </>
                }
              />
            </div>
          )}

          {/* The list's own ground: opaque, so the numbers are never read over
              the page moving behind the glass. `min-h-0` is what lets it shrink
              into the sheet rather than pushing the bar off the top. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-[rgba(3,11,18,0.72)] p-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.65),inset_0_0_0_1px_rgba(255,255,255,0.05)]">
            {error && !rows ? (
              <ErrorCard message={error} />
            ) : !rows ? (
              <PanelLoading>{loadingLabel}</PanelLoading>
            ) : shown.length === 0 ? (
              <PanelMessage>
                {query.trim() ? noMatchLabel : emptyLabel}
              </PanelMessage>
            ) : (
              children(shown, selection)
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0 text-foreground/45"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
