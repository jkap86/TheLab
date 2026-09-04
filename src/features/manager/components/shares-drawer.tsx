"use client";

import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ManagerLeague } from "@/shared/contract";
import {
  CONSOLE_KEY_PILL,
  CONSOLE_TRACK,
  CONSOLE_WINDOW,
  MAX_SHARES_COLUMNS,
  mergeSharesColumns,
  Scanlines,
  SHARES_COLUMN_WIDTHS,
  SHARES_COLUMNS_BY_KIND,
  type SharesColumnId,
  sharesColumnLabel,
  sharesColumns,
  storeSharesColumns,
  useSharesColumns,
} from "@/features/shared";

import type { Subject, SubjectKind } from "../helpers/league-subjects";
import {
  formatCombinedRecord,
  formatWinPct,
  seasonSummary,
} from "../helpers/season-summary";

/**
 * The shares drawer: a native `<dialog>` pinned to one edge of the viewport,
 * holding a searchable list of subjects and how many of the manager's leagues
 * each one is in.
 *
 * **It is the native element for the reason both dialogs are** — `showModal()`
 * brings the focus trap, the Esc-to-close and the `::backdrop` with it, and no
 * dependency.
 *
 * **Write the margins as explicit sides, never `m-0` plus an `auto`.** A
 * `<dialog>` is centred by the UA's own `margin: auto`, and Tailwind emits the
 * `m-*` shorthand before the `ml-*`/`mr-*` longhands — so `m-0 ml-auto` is a
 * coin flip decided by emit order, exactly the trap `CONSOLE_KEY_PILL` exists to
 * keep a lit key out of.
 *
 * **The panel is a machined unit rather than a page pinned to an edge**: a
 * raised control deck (`--plate-raised-*`) over a recessed list tray, in a
 * `--housing-bg` frame with a gap on its three free sides — which is what makes
 * it read as a rack slid out rather than welded to the viewport. The frame is
 * the housing and not `--panel-bg`, because the panel gradient is the ground a
 * page stands on and this is an instrument standing on it.
 *
 * **The rows are raised keys, and they are still flat.** The lift on hover is a
 * `translateY` and a box-shadow — one composited layer at a time — and nothing
 * here spends a `perspective`, a `preserve-3d`, a per-row `translateZ` or a
 * `drop-shadow` filter. That is a budget rather than a style: the league grid
 * pays ~6 composited planes per card and gates all of it behind `pointer-fine:`
 * because iOS Safari's per-tab GPU budget dies on 113 of them, and this list is
 * an order of magnitude longer — ~1,500 players on that same account. Do not
 * promote it to `preserve-3d` to match the cards.
 *
 * **A row is one button, and it used to be two.** The chevron that expanded a
 * row into the leagues holding it is gone: pressing the row narrows the league
 * grid behind the drawer to exactly those leagues, and the grid is the better
 * answer — the same leagues, with their cards, one press earlier. The
 * constraint that shaped the old row is worth keeping written down, because it
 * is *why* the row is a `<button>` and not a `<details>`: a `<summary>` maps to
 * a leaf `button`, so a control nested inside one is unreliably reachable, and
 * a row with two jobs could not have been a disclosure. With one job it could
 * — and it still is not, because there is nothing left to disclose.
 *
 * The row's leagues are still *data*: the record column and the share are both
 * folded out of them.
 */

const SIDES = {
  left: {
    // Explicit sides, never `m-0` — see the note above. The padding is on the
    // three free sides only; the docked one has none, so the frame runs off the
    // edge it is hinged on.
    dialog: "my-0 ml-0 mr-auto py-3 pl-0 pr-3",
    panel: "rounded-r-3xl",
    animation: "drawer-in-left",
  },
  right: {
    dialog: "my-0 mr-0 ml-auto py-3 pl-3 pr-0",
    panel: "rounded-l-3xl",
    animation: "drawer-in-right",
  },
} as const;

export type SharesDrawerRow = {
  /** Stable across renders and unique within the list — never an index. */
  key: string;
  id: string;
  name: string;
  /** The bezel's ink and shape; the bezel itself is the drawer's. */
  badge: {
    /** Round for a person, square for a position. */
    round?: boolean;
    /** A stored avatar, where the row has one. */
    imageUrl?: string | null;
    /** What to draw when there is no image — a position, or an initial. */
    label: string;
  };
  /** A short trailing fact — a team, say. Absent is fine, and is on a person. */
  note?: string | null;
  /** How many of the counted leagues hold this row. */
  held: number;
  /**
   * Which ones — **data, not markup.** The record column and the win rate are
   * folded out of this list, over the same aggregate the header housing on the
   * page behind uses, so the two cannot be computed different ways.
   */
  leagues: ManagerLeague[];
  /** The player columns. Absent on a leaguemate row, which cannot offer them. */
  value?: number | null;
  age?: number | null;
  draftClass?: number | null;
};

/**
 * Which way each metric reads when it is the sort key, and it is fixed per
 * metric rather than a direction the reader flips.
 *
 * A press is one press: nobody wants oldest-player-first or the leagues they
 * hold a player in *fewest* of, and a toggle would put a second meaning on a
 * key whose first meaning is "order by this". Age is the one that ascends —
 * younger first is what a dynasty reader means by sorting on it.
 */
const SORT_ASCENDING: Record<SharesColumnId, boolean> = {
  value: false,
  // Younger first, which is what a dynasty reader means by sorting on age.
  age: true,
  class: false,
  record: false,
  share: false,
};

/** The main figure's size, per metric — a record and a share carry two lines. */
const CELL_TEXT: Record<SharesColumnId, string> = {
  value: "text-[0.8125rem]",
  age: "text-[0.8125rem]",
  class: "text-[0.8125rem]",
  record: "text-[0.6875rem]",
  share: "text-[0.6875rem]",
};

/** A row with its folded figures, ready to be sorted and drawn. */
type Prepared = {
  row: SharesDrawerRow;
  pct: number;
  /** `33–32`, or null where no league in the set has played. */
  record: string | null;
  /** The same set's win rate, for the sort. Null wherever `record` is. */
  winPct: number | null;
  /** `50.8%`, already spelled — the cell must not re-derive it. */
  winPctLabel: string | null;
};

export function SharesDrawer({
  open,
  onClose,
  side,
  kind,
  title,
  noun,
  rows,
  leagueCount,
  leagueTotal,
  filterSummary,
  loading,
  error,
  emptyMessage,
  filters,
  filtersActive,
  onClearFilters,
  selected,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  side: keyof typeof SIDES;
  kind: SubjectKind;
  title: string;
  /** Plural, lower case — "players", "leaguemates". Used in copy and labels. */
  noun: string;
  rows: SharesDrawerRow[];
  /** The denominator: leagues that contributed a roster or a member list. */
  leagueCount: number;
  /** Every league on the page, unfiltered — the readout's "of 113". */
  leagueTotal: number;
  /** What the league filters have been narrowed to, or null for nothing. */
  filterSummary: string | null;
  loading: boolean;
  error: string | null;
  /** What to say when there is genuinely nothing, as opposed to nothing matching. */
  emptyMessage: string;
  /**
   * The players drawer's filter controls — the Filters key and its tray.
   * Absent on the leaguemates panel, which has nothing to narrow by.
   *
   * The drawer no longer wraps this in a well of its own: one facet was a row
   * of chips and four is a panel, and a panel that owns its own grooves and
   * labels cannot be laid out from here. It is a fragment of two — a key for
   * the search row and a tray that wraps onto the line under it.
   */
  filters?: ReactNode;
  /** Whether anything is narrowing — the empty state's claim depends on it. */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  selected: (subject: Subject) => boolean;
  onToggle: (subject: Subject) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const [query, setQuery] = useState("");
  // A way of reading this list rather than a device preference, so it is
  // `useState` — the same call `LeagueTeams` makes about its metric select.
  // The *columns* are persisted, because those are a preference.
  const [sort, setSort] = useState<SharesColumnId | "name">("share");
  const [lifted, setLifted] = useState<SharesColumnId | null>(null);

  const stored = useSharesColumns();
  const cols = useMemo(() => sharesColumns(stored, kind), [stored, kind]);
  // A stored sort key naming a column this reader has since dropped falls back
  // to their own **rightmost** column rather than to a fixed default: the last
  // column is the one nearest the eye, and a fixed fallback would be a fourth
  // opinion about what this list is ordered by.
  const sortKey =
    sort === "name" || cols.includes(sort) ? sort : cols[cols.length - 1];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (dialog.open) return;
    dialog.showModal();

    // Fine pointer → the search field, which is what the drawer is for.
    // Coarse → the panel itself, so opening it on a phone does not raise the
    // software keyboard over the list it just showed.
    const fine =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)").matches;
    (fine ? inputRef.current : panelRef.current)?.focus();
  }, [open]);

  // Every route out of the drawer clears the search, so reopening it is not a
  // list still narrowed by something typed a minute ago. The *selection* is
  // deliberately not cleared — it is the narrowing on the grid behind.
  const close = () => {
    setQuery("");
    onClose();
  };

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const kept = needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle))
      : rows;

    const prepared: Prepared[] = kept.map((row) => {
      // The app's own aggregate, so the record in a row and the record in the
      // header housing cannot be computed two different ways — and a league
      // with no stored record is skipped rather than counted `0–0`.
      const summary = seasonSummary(row.leagues);
      // `formatCombinedRecord` always spells a string, so the gate is the game
      // count: a set of leagues that has played nothing shows no record rather
      // than an `0–0` claiming they went winless.
      const played = summary.games > 0;
      return {
        row,
        pct: leagueCount > 0 ? Math.round((row.held / leagueCount) * 100) : 0,
        record: played ? formatCombinedRecord(summary) : null,
        winPct: played ? summary.winPct : null,
        winPctLabel: played ? formatWinPct(summary) : null,
      };
    });

    if (sortKey === "name") {
      return prepared.sort((a, b) => a.row.name.localeCompare(b.row.name));
    }

    const ascending = SORT_ASCENDING[sortKey];
    return prepared.sort((a, b) => {
      const wa = weightOf(sortKey, a);
      const wb = weightOf(sortKey, b);
      // **A row with no value for the sorted metric sorts last**, in either
      // direction: an unpriced player is not the cheapest one and a player with
      // no recorded age is not the youngest. Falling back to a zero would put
      // every absence at one end of the scale as if it were an answer.
      if (wa === null || wb === null) {
        if (wa !== wb) return wa === null ? 1 : -1;
      } else if (wa !== wb) {
        return ascending ? wa - wb : wb - wa;
      }
      return a.row.name.localeCompare(b.row.name);
    });
  }, [rows, needle, leagueCount, sortKey]);

  // A narrowed list scrolled halfway down reads as an empty one.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [needle, sortKey]);

  const writeCols = (next: readonly SharesColumnId[]) =>
    storeSharesColumns(mergeSharesColumns(stored, kind, next));

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Esc: let the browser close it, but route the state through `close` so
        // the parent's `open` flag cannot drift from the element's.
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        // The dialog element is only ever the click target when the click
        // landed outside the panel.
        if (e.target === e.currentTarget) close();
      }}
      className={`${SIDES[side].dialog} h-dvh max-h-dvh w-[min(34rem,calc(100vw-1.5rem))] max-w-full overflow-hidden bg-transparent text-foreground backdrop:bg-[radial-gradient(130%_100%_at_50%_0%,rgba(0,0,0,0.5),rgba(0,0,0,0.78))] backdrop:backdrop-blur-[2.5px]`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        // `lab-anim` is the app's marker for anything decorative that moves;
        // the `prefers-reduced-motion` rule in globals.css stops all of it at
        // once. There is no exit animation — a native dialog is gone in the
        // frame it closes.
        className={`@container lab-anim relative flex h-full flex-col overflow-hidden border border-foreground/12 bg-[image:var(--housing-bg)] shadow-[var(--housing-shadow),0_60px_120px_-40px_rgba(0,0,0,0.85)] outline-none ${SIDES[side].panel}`}
        style={{
          animation: `${SIDES[side].animation} 0.24s cubic-bezier(0.2,0.9,0.3,1)`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--panel-grain)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-[image:var(--panel-specular)]"
        />

        {/* The control deck: one raised plate carrying four bands. Kept tight,
            because the list is what the panel is for. */}
        <div className="relative shrink-0 bg-[image:var(--plate-raised-bg)] shadow-[var(--plate-raised-shadow)]">
          {/* **The readout takes its own line below `@md`**, which a render at
              390 forced rather than the handoff asking for it: the engraved
              title and the Esc key are ~235px of a 354px panel, so inline the
              readout gets four characters — "ACRO…" — and the one thing on
              screen that says what the panel is counting over says nothing.
              Wrapped, it has the row to itself. One element either way, ordered
              by the cascade: a client component must not have to hydrate to
              learn a breakpoint. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-0 pt-1.5">
            <EngravedTitle id={titleId}>{title}</EngravedTitle>

            {/* **A closed dialog says nothing**, which is the whole reason this
                readout exists: the league filters already narrow the shares —
                `LeaguesHome` hands both drawers the filtered list and the folds
                count over exactly it — but nothing in here said so. */}
            <span
              className={`${CONSOLE_WINDOW} order-last flex min-w-0 basis-full items-center rounded-lg px-2.5 py-[0.3125rem] @md:order-none @md:basis-auto @md:flex-[1_1_0]`}
            >
              <Scanlines />
              <span className="relative truncate font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-readout-line">
                {population(leagueCount, leagueTotal, filterSummary)}
              </span>
            </span>

            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className={`${CONSOLE_KEY_PILL} ml-auto border-foreground/12 bg-[image:var(--key-bg)] px-[0.6875rem] py-1 text-[0.625rem] text-foreground/78 shadow-[var(--key-shadow)] hover:text-readout @md:ml-0`}
            >
              Esc
            </button>
          </div>

          <div className="flex flex-col gap-[0.3125rem] px-3 pb-2 pt-1.5">
            {/* **The row wraps, and the tray is what wraps onto the second
                line.** `PlayerFilters` is one component — the key and the tray
                it controls are one node and one `useId`, so they arrive in one
                slot — and a fragment cannot put half of itself in this row and
                half in the column outside it. So the row is the wrapping
                container and the tray takes a full basis, which is the same two
                lines the deck would have drawn. The vertical gap is the
                column's own, because the collapsed tray's negative margin is
                what cancels it. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-[0.3125rem]">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${noun}`}
                aria-label={`Search ${noun}`}
                // 16px or iOS Safari zooms the page on focus.
                className="min-w-0 flex-1 rounded-xl border border-black/60 bg-[image:var(--key-bg)] px-[0.6875rem] py-[0.3125rem] text-[16px] text-foreground/88 shadow-[var(--track-shadow)] placeholder:text-foreground/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:text-[0.8125rem]"
              />
              <span
                className={`${CONSOLE_WINDOW} inline-flex shrink-0 items-center rounded-xl px-[0.6875rem] py-[0.4375rem]`}
                role="status"
              >
                <Scanlines />
                <span className="relative font-mono text-[0.8125rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
                  {shown.length}
                </span>
              </span>
              {/* The Filters key rides here rather than in a well of its
                  own: this is the row with the spare width. Its tray is the
                  node beside it, and wraps — see above. */}
              {filters}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <SortTrack
                cols={cols}
                active={sortKey}
                onPick={(key) => setSort(key)}
              />
              <ColumnsStrip
                cols={cols}
                kind={kind}
                lifted={lifted}
                onLift={setLifted}
                onChange={writeCols}
              />
            </div>
          </div>
        </div>

        {/* The list tray, recessed into the deck above it. A recess has to be
            **darker than its surround in both themes**, which a black alpha is
            and a `--foreground` alpha is not — the latter inverts with the
            theme and would light the tray up in light mode. */}
        <div className="relative m-2 flex min-h-0 flex-1 flex-col rounded-[0.875rem] bg-black/[0.16] shadow-[var(--well-shadow)]">
          {shown.length > 0 && (
            <>
              {/* The header is laid out from the same widths the cells are, so
                  a label sits over the readout it names. The right padding is
                  the row padding plus the scroll padding plus the 11px gutter
                  `.lab-scroll` reserves. */}
              <div
                aria-hidden
                className="hidden shrink-0 items-center gap-2 pb-[0.3125rem] pl-5 pr-[calc(1.125rem+11px)] pt-2 @md:flex"
              >
                <span className="flex-1" />
                {cols.map((id) => (
                  <span
                    key={id}
                    style={{ width: SHARES_COLUMN_WIDTHS[id] }}
                    className={`shrink-0 whitespace-nowrap font-mono text-[0.5rem] uppercase tracking-[0.18em] ${
                      sortKey === id ? "text-active" : "text-foreground/40"
                    }`}
                  >
                    {sharesColumnLabel(id)}
                    {sortKey === id ? " ▼" : ""}
                  </span>
                ))}
              </div>
              <div
                aria-hidden
                className="mx-[0.6875rem] h-px shrink-0 bg-[linear-gradient(to_right,transparent,rgba(0,0,0,0.55),transparent)] shadow-[0_1px_0_color-mix(in_srgb,var(--foreground)_6%,transparent)]"
              />
            </>
          )}

          {/* The scroller is a flex child rather than absolutely positioned at
              the handoff's `top-[2.0625rem]`. Same pixels, and one fewer number
              that has to keep agreeing with a rendered height it cannot see —
              a header row a hair taller than the offset would overlap the first
              row silently, and a hair shorter would leave a gap. */}
          <div
            ref={listRef}
            className="lab-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 pl-[0.6875rem] pr-[0.4375rem] pt-2 [mask-image:linear-gradient(to_bottom,transparent_0,#000_0.625rem,#000_calc(100%-0.75rem),transparent_100%)]"
          >
            {loading ? (
              <Message>Reading {noun}…</Message>
            ) : error ? (
              <p
                role="alert"
                className="m-0 py-6 font-mono text-[0.8125rem] text-error"
              >
                {error}
              </p>
            ) : shown.length === 0 ? (
              // Two different claims, and the second is the reader's to undo.
              //
              // **`rows.length === 0` is not on its own the first claim**, and
              // it stopped being so when the facets became four. One position
              // chip could never empty the list — every chip counts over the
              // unfiltered population, so pressing one leaves at least its own
              // count — but four facets are an AND, and RB ∧ BAL ∧ 22–24 is
              // empty while all three chips read a number. Reported as
              // `emptyMessage` that is a claim about the account made by a
              // narrowing the reader could undo, with no key offered to undo
              // it.
              rows.length === 0 && !filtersActive ? (
                <Message>{emptyMessage}</Message>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 py-6 pr-3">
                  <Message>
                    {filtersActive
                      ? `No ${noun} match these filters.`
                      : `Nobody by that name.`}
                  </Message>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      onClearFilters?.();
                    }}
                    className={`${CONSOLE_KEY_PILL} border-foreground/10 bg-[image:var(--key-bg)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout`}
                  >
                    Clear
                  </button>
                </div>
              )
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {shown.map((prepared) => (
                  <ShareRow
                    key={prepared.row.key}
                    prepared={prepared}
                    cols={cols}
                    leagueCount={leagueCount}
                    selected={selected({ kind, id: prepared.row.id })}
                    onSelect={() => onToggle({ kind, id: prepared.row.id })}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/**
 * What the panel is counting over, in the title bar.
 *
 * **The denominator is leagues that contributed a roster or a member list**,
 * not the league count on the page: a league whose roster was never stored
 * contributes nothing and must not be counted, which is the same rule
 * `PlayerShares.league_count` is written by.
 *
 * The handoff spells the narrowed form as `Across 79 dynasty leagues of 113`,
 * with the summary inline. That reads well for its own one-word example and
 * badly for the ones this app actually produces — `filterSummary` joins its
 * parts with `·` and its labels include rule spellings like `QB+SF ≥ 2`, so the
 * summary lands between the count and the noun as `Across 79 Dynasty · QB+SF ≥
 * 2 leagues of 113`. The figures go first instead, which also puts them on the
 * side of the truncation that survives.
 */
function population(
  counted: number,
  total: number,
  summary: string | null,
): string {
  if (!summary) {
    return `Across all ${counted} league${counted === 1 ? "" : "s"}`;
  }
  return `Across ${counted} of ${total} leagues · ${summary}`;
}

/** The metric's own number for a row, or null where it has none. */
function weightOf(id: SharesColumnId, prepared: Prepared): number | null {
  switch (id) {
    case "value":
      return prepared.row.value ?? null;
    case "age":
      return prepared.row.age ?? null;
    case "class":
      return prepared.row.draftClass ?? null;
    case "record":
      return prepared.winPct;
    case "share":
      return prepared.row.held;
  }
}

/**
 * The panel's name, engraved.
 *
 * Two layers, the treatment `ManagerPlate` and `LabWordmark` share: an
 * `aria-hidden` extrusion copy under a face that is a gradient clipped to the
 * glyphs. **The depth has to be a `drop-shadow()` filter and never a
 * `text-shadow`** — the face's own colour is `transparent`, so a text-shadow
 * renders straight through the letterforms instead of under them.
 */
function EngravedTitle({ id, children }: { id: string; children: string }) {
  return (
    <span
      id={id}
      className="relative inline-block shrink-0 whitespace-nowrap text-[0.8125rem] font-bold uppercase leading-none tracking-[0.16em]"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 text-[var(--chrome-extrude)] [text-shadow:var(--chrome-extrude-shadow)]"
      >
        {children}
      </span>
      <span className="relative inline-block bg-[image:var(--chrome-face)] bg-clip-text text-transparent [filter:var(--wordmark-depth)]">
        {children}
      </span>
    </span>
  );
}

/**
 * The Sort track: one travelling key in a tight channel.
 *
 * **It offers exactly the columns on screen, plus Name** — not a fixed list.
 * The order and the number a reader is comparing have to come off one list, or
 * the sort can name a column that is not being shown.
 *
 * There is deliberately **no sort by position**: position is the `Pos` facet
 * above, which filters, and a control that both filters and orders on one axis
 * is two answers to one question.
 */
function SortTrack({
  cols,
  active,
  onPick,
}: {
  cols: readonly SharesColumnId[];
  active: SharesColumnId | "name";
  onPick: (key: SharesColumnId | "name") => void;
}) {
  const keys: { key: SharesColumnId | "name"; label: string }[] = [
    ...cols.map((id) => ({ key: id, label: sharesColumnLabel(id) })),
    { key: "name" as const, label: "Name" },
  ];

  return (
    <span className="inline-flex items-center gap-[0.4375rem]">
      <span className="shrink-0 font-mono text-[0.5rem] uppercase tracking-[0.18em] text-foreground/42">
        Sort
      </span>
      <span className={`${CONSOLE_TRACK} inline-flex items-center gap-1 p-1`}>
        {keys.map(({ key, label }) => {
          const on = active === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              aria-pressed={on}
              className={
                "inline-flex shrink-0 items-center gap-[0.3125rem] rounded-full border px-2.5 py-[0.3125rem] font-mono text-[0.625rem] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                (on
                  ? "border-active/55 bg-[image:var(--key-bg)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[var(--key-shadow),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                  : "border-transparent text-foreground/58 hover:text-readout")
              }
            >
              {label}
              {on && (
                <span aria-hidden className="text-[0.5rem] text-active">
                  {key === "name" ? "▲" : "▼"}
                </span>
              )}
            </button>
          );
        })}
      </span>
    </span>
  );
}

/**
 * The Columns strip: what is on screen, in the reader's order, then the spares.
 *
 * **A well and slabs, not a track and pills**, which is the console's own rule
 * rather than a style choice: a track holds one travelling key and a well holds
 * a panel of controls, and that shape difference is what stops the two adjacent
 * control groups from reading as one row of eight buttons.
 *
 * **The bounds are enforced by disabling, never by correcting** —
 * `lineup-columns-dialog.tsx`'s rule. The spare keys grey out at
 * {@link MAX_SHARES_COLUMNS} and the last chosen slab's drop control disables
 * at one, so an invalid set cannot be made in the first place.
 *
 * **Reordering is tap-to-lift, tap-to-drop, and it used to be a drag.** The
 * drag was `dragenter`-driven so the move was visible while it was being made,
 * and it was recorded here as mouse-only on the argument that the *set* stays
 * keyboard-reachable and a `◀ ▶` pair per slab is four more controls. Touch
 * broke that trade: HTML5 drag events do not fire at all on a phone, so the
 * order was not reachable there by any means. Arming a slab costs nothing at
 * rest — the insert slots exist only while one is lifted — and it lands the
 * keyboard order for free, which the drag never had.
 *
 * **The two slots either side of the lifted slab are omitted, not disabled.**
 * Dropping a slab back where it started is not a move, and a target that does
 * nothing is a target that has to be explained.
 */
function ColumnsStrip({
  cols,
  kind,
  lifted,
  onLift,
  onChange,
}: {
  cols: readonly SharesColumnId[];
  kind: SubjectKind;
  lifted: SharesColumnId | null;
  onLift: (id: SharesColumnId | null) => void;
  onChange: (next: readonly SharesColumnId[]) => void;
}) {
  const spares = SHARES_COLUMNS_BY_KIND[kind].filter((id) => !cols.includes(id));
  const locked = cols.length === 1;
  const full = cols.length >= MAX_SHARES_COLUMNS;
  const from = lifted ? cols.indexOf(lifted) : -1;

  const place = (to: number) => {
    if (!lifted) return;
    const rest = cols.filter((id) => id !== lifted);
    // **The insert index is read against the pre-move order.** Removing the
    // lifted slab shifts everything after it down one, so a slab moved
    // rightward would otherwise land back on the index it just vacated and the
    // move would visibly do nothing.
    rest.splice(to > from ? to - 1 : to, 0, lifted);
    onChange(rest);
    onLift(null);
  };

  const slot = (at: number) => {
    // Nothing lifted, or a slot either side of where it already sits.
    if (!lifted || at === from || at === from + 1) return null;
    return (
      <button
        key={`slot-${at}`}
        type="button"
        aria-label={`Move ${sharesColumnLabel(lifted)} here`}
        title="Move here"
        onClick={() => place(at)}
        className="h-[1.5625rem] w-[0.3125rem] shrink-0 rounded-full bg-active opacity-55 shadow-[0_0_10px_var(--accent-glow)] transition-[width,opacity] duration-150 hover:w-[0.5625rem] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
      />
    );
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-[0.4375rem]">
      <span className="shrink-0 font-mono text-[0.5rem] uppercase tracking-[0.18em] text-foreground/42">
        Columns
      </span>
      {/* `CONSOLE_WELL`'s surface at this strip's own radius, spelled rather
          than composed: two `rounded-*` utilities on one element is the
          specificity coin flip `CONSOLE_KEY_PILL` exists to keep colours out
          of, and a radius is not worth taking it for. */}
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-foreground/8 bg-[image:var(--key-bg)] p-1 shadow-[var(--well-shadow)]">
        {cols.map((id, i) => {
          const on = lifted === id;
          return (
            <Fragment key={id}>
              {slot(i)}
              <span
                className={
                  "inline-flex shrink-0 items-center gap-[0.3125rem] rounded-lg border bg-[image:var(--plate-raised-bg)] py-1 pl-[0.3125rem] pr-1.5 transition-[opacity,border-color] duration-150 " +
                  (on
                    ? "border-active opacity-50 shadow-[var(--key-shadow-pressed)]"
                    : "border-active/55 shadow-[var(--plate-raised-shadow)]")
                }
              >
                <button
                  type="button"
                  title={on ? "Cancel move" : `Move ${sharesColumnLabel(id)}`}
                  aria-label={on ? "Cancel move" : `Move ${sharesColumnLabel(id)}`}
                  aria-pressed={on}
                  onClick={() => onLift(on ? null : id)}
                  className={`cursor-pointer px-px font-mono text-[0.5rem] leading-[0.8] tracking-[-0.06em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                    on ? "text-active" : "text-foreground/38"
                  }`}
                >
                  ⣿
                </button>
                <button
                  type="button"
                  disabled={locked}
                  title={locked ? "At least one column" : `Remove ${sharesColumnLabel(id)}`}
                  onClick={() => {
                    onChange(cols.filter((k) => k !== id));
                    onLift(null);
                  }}
                  className={`whitespace-nowrap font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout [text-shadow:var(--readout-text-glow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                    locked ? "cursor-default" : "cursor-pointer"
                  }`}
                >
                  {sharesColumnLabel(id)}
                </button>
              </span>
            </Fragment>
          );
        })}
        {slot(cols.length)}

        {spares.length > 0 && (
          <span
            aria-hidden
            className="mx-0.5 h-[1.0625rem] w-px bg-[image:var(--groove)] shadow-[var(--groove-highlight)]"
          />
        )}

        {spares.map((id) => (
          <button
            key={id}
            type="button"
            disabled={full}
            title={
              full
                ? `${MAX_SHARES_COLUMNS} columns at most — drop one first`
                : `Add ${sharesColumnLabel(id)}`
            }
            onClick={() => onChange([...cols, id])}
            className={`shrink-0 whitespace-nowrap rounded-lg border border-foreground/9 px-[0.5625rem] py-[0.3125rem] font-mono text-[0.625rem] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
              full
                ? "cursor-not-allowed text-foreground/26"
                : "text-foreground/58 hover:text-readout"
            }`}
          >
            {sharesColumnLabel(id)}
          </button>
        ))}
      </span>
    </span>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 py-6 pl-2 font-mono text-[0.8125rem] text-foreground/60">
      {children}
    </p>
  );
}

/**
 * One row, as a key that can be held down.
 *
 * **Selected reads as pressed and lit rather than as a tinted stripe**, which
 * is also true of what it does: pressing it again clears the narrowing.
 *
 * The lift is a `translateY` under `motion-safe:`, not just under `.lab-anim` —
 * that rule clears `transition` and `animation`, so a lift written without the
 * variant would still jump instantly under reduced motion, which is the thing
 * the preference is about.
 *
 * **Below `@md` the cells wrap onto a line of their own**, which a render at
 * 390 forced rather than the handoff asking for it. Three cells are 13rem of a
 * 288px row once the badge and the gaps are paid for, which leaves the name
 * about eighteen pixels — every player read as a single initial and a full
 * stop. The alternative was the manager card's own answer, dropping the third
 * field below `sm`; it is wrong here because the column a reader put last is
 * usually Share, which is what the panel is for. Wrapping costs a taller row
 * and the column headers, which `@md:flex` takes off the tray at the same
 * width — and nothing is lost by that either, because the Columns strip in the
 * deck above names the same three in the same order, and the Sort track says
 * which one the list is ordered by.
 */
function ShareRow({
  prepared,
  cols,
  leagueCount,
  selected,
  onSelect,
}: {
  prepared: Prepared;
  cols: readonly SharesColumnId[];
  leagueCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row } = prepared;

  return (
    <li
      className={
        "lab-anim rounded-xl border bg-[image:var(--key-bg)] transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
        "motion-safe:hover:-translate-y-0.5 hover:border-active/40 hover:shadow-[var(--key-shadow),0_16px_26px_-14px_rgba(0,0,0,0.9),0_0_26px_-10px_var(--accent-glow)] " +
        (selected
          ? "border-active/50 shadow-[var(--key-shadow-pressed),inset_0_0_22px_color-mix(in_srgb,var(--accent)_14%,transparent),0_0_24px_-10px_var(--accent-glow)]"
          : "border-foreground/9 shadow-[var(--key-shadow)]")
      }
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-xl px-[0.6875rem] py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:flex-nowrap"
      >
        <Badge badge={row.badge} selected={selected} />

        {/* `basis` is the row minus the badge and its gap, so three cells
            cannot fit beside it and wrap to a line of their own — see the note
            on `ShareRow`. Above `@md` it is `auto` and the row is one line. */}
        <span className="min-w-0 flex-1 basis-[calc(100%-2.375rem)] @md:basis-auto">
          {/* Full opacity on the accent as text, per the theme rule: an alpha
              on it drops light mode's teal below AA. */}
          <span
            className={`block truncate text-[0.8125rem] tracking-[-0.005em] ${
              selected ? "font-semibold text-readout" : "text-foreground/85"
            }`}
          >
            {row.name}
          </span>
          {row.note && (
            <span className="block truncate font-mono text-[0.5625rem] uppercase tracking-[0.16em] text-foreground/46">
              {row.note}
            </span>
          )}
        </span>

        {cols.map((id) => (
          <Cell
            key={id}
            id={id}
            prepared={prepared}
            leagueCount={leagueCount}
          />
        ))}
      </button>
    </li>
  );
}

/**
 * The badge: a lit bezel with a position, an initial or an avatar in it.
 *
 * **The drawer owns it rather than taking a node from the caller**, which is a
 * change from the shape this component used to have. Two reasons, and the
 * second is the load-bearing one: the bezel is the drawer's surface, and the
 * ink is a *selected* state only the row knows. An `<Avatar>` mounted here
 * would also be the wrong size — its `md` grows to 2.25rem inside an
 * `@container` this wide, and the bezel is a fixed 1.875rem — so the stored
 * avatar rides through as a url and the bezel frames it.
 */
function Badge({
  badge,
  selected,
}: {
  badge: SharesDrawerRow["badge"];
  selected: boolean;
}) {
  const shape = badge.round ? "rounded-full" : "rounded-[0.375rem]";

  return (
    <span
      aria-hidden
      className={`inline-flex size-[1.875rem] shrink-0 items-center justify-center overflow-hidden border border-foreground/12 bg-[image:var(--bezel-bg)] shadow-[var(--bezel-shadow)] ${shape} ${
        badge.round
          ? "text-[0.75rem] font-semibold"
          : "font-mono text-[0.5625rem] uppercase tracking-[0.06em]"
      } ${selected ? "text-readout" : "text-foreground/68"}`}
    >
      {badge.imageUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={badge.imageUrl}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        badge.label
      )}
    </span>
  );
}

/**
 * One readout cell — one shape, five metrics.
 *
 * **Missing values render an em dash, never a zero**, in every one of them: an
 * unpriced player is off KTC's board rather than worthless, a player with no
 * stored age has no age rather than an age of nothing, and a set of leagues
 * that has played nothing has no record rather than an `0–0`.
 *
 * **None of them is coloured**, which is `ShareMeter`'s reasoning generalised:
 * `rankColor` says how *good* a position is, and none of these five has a good.
 * Holding a player in nine leagues is a different fact from holding him in one,
 * not a better result — and the same goes for a price, an age and a class. So
 * the figure is the readout's own ink and the meaning is in the number.
 */
function Cell({
  id,
  prepared,
  leagueCount,
}: {
  id: SharesColumnId;
  prepared: Prepared;
  leagueCount: number;
}) {
  const { row, pct } = prepared;

  let main = "—";
  let trail: string | null = null;
  let sub: string | null = null;
  let bar = false;

  switch (id) {
    case "value":
      if (row.value != null) main = row.value.toLocaleString();
      break;
    case "age":
      if (row.age != null) main = String(row.age);
      break;
    case "class":
      if (row.draftClass != null) main = String(row.draftClass);
      break;
    case "record":
      if (prepared.record) {
        main = prepared.record;
        sub = prepared.winPctLabel;
      }
      break;
    case "share":
      main = `${row.held}/${leagueCount}`;
      trail = `${pct}%`;
      bar = true;
      break;
  }

  return (
    <span
      style={{ width: SHARES_COLUMN_WIDTHS[id] }}
      className={`${CONSOLE_WINDOW} flex shrink-0 flex-col justify-center gap-0.5 self-stretch rounded-[0.4375rem] px-2 py-1.5`}
    >
      <Scanlines />
      <span
        className={`relative flex items-baseline justify-between gap-1 whitespace-nowrap font-mono leading-[1.2] tabular-nums text-readout [text-shadow:var(--readout-text-glow)] ${CELL_TEXT[id]}`}
      >
        <span>{main}</span>
        {trail && <span className="text-[0.5625rem] text-readout-label">{trail}</span>}
      </span>
      {sub && (
        <span className="relative font-mono text-[0.5625rem] leading-[1.2] tabular-nums text-readout-label">
          {sub}
        </span>
      )}
      {bar && (
        <span
          aria-hidden
          className="relative mt-0.5 block h-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
        >
          <span
            className="block h-1 rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
            // A held row is never drawn empty: at 1 of 113 a true-width bar is
            // invisible and reads as "none" rather than as "one".
            style={{ width: `${Math.max(pct, row.held > 0 ? 6 : 0)}%` }}
          />
        </span>
      )}
    </span>
  );
}
