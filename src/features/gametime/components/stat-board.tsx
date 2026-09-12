"use client";

import { useMemo, useState } from "react";

import {
  BilletFinish,
  CONSOLE_FIGURE_WELL,
  CONSOLE_GLASS,
  CONSOLE_KEY,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
  CONSOLE_WINDOW_LEDGE,
  rankColor,
  Scanlines,
  sharePercentile,
  storeStatBoardOpen,
  useStatBoardOpen,
} from "@/features/shared";
import type { GametimeGame, GametimeStatLine } from "@/shared/contract";

import {
  narrowStatRows,
  NO_STAT_FILTERS,
  PHONE_SORTS,
  rankStatRows,
  SCORING_LABEL,
  sortLabel,
  STAT_COLUMNS,
  STAT_GRID_TEMPLATE,
  statFiltersActive,
  statGroupSpans,
  statLineSummary,
  statRows,
  statTeams,
  topStatRow,
} from "../helpers/stat-board";
import type {
  PositionFilter,
  RankedStatRow,
  StatBasis,
  StatBoardFilters,
  StatColumn,
  StatSortKey,
} from "../helpers/stat-board";

/**
 * The week's stat board: every skill player with a scoring line, sortable,
 * searchable and narrowed three ways, behind a bar pinned to the bottom of
 * the console.
 *
 * **It answers the one question the rest of this page cannot.** The cards say
 * what *your* lineups are doing and the two Browse panels say which of your
 * leagues a player is in; neither says what any given player actually **did**
 * this week. So it is a reference table rather than a drawer, and the
 * difference is what it acts on: a shares drawer is a narrowing control whose
 * press moves the league grid behind it, where nothing here touches the page
 * at all. That is also why it is a bar at the foot rather than a third Browse
 * key — a key in the rack's Browse channel would promise a narrowing it does
 * not make.
 *
 * **Feature-local, on `features/shared`'s own rule: one reader.** It moves
 * there the day the lineup checker takes it too, at which point the week and
 * the lines become props rather than a read.
 *
 * **The whole table is mounted only while the board is up.** A closed bar is
 * 52px of billet and nothing else — no rows, no header, no scroller — which
 * is `usePanelCap`'s `mounted` one component over and for its reason: a few
 * hundred rows behind a control most readers never press is a document the
 * page pays for on every frame the room pushes.
 *
 * **The order is filter, then sort, then rank**, and the rank is the row's
 * place *in the current view* rather than a stored ranking — so it renumbers
 * from 1 on every narrowing. A stored place would have a board narrowed to
 * tight ends open at rank 41.
 */
/**
 * The closed bar's own height, as the classes that declare it.
 *
 * **One spelling, because a second part has to clear it.** The board is
 * `fixed` to the foot of the viewport and so is the page's Browse dock, and
 * the dock lifts by exactly this — see `gametime-home.tsx`, which puts this on
 * the page root so both read the same number. A height written twice is a dock
 * that sits on the bar the first time either moves, and the symptom is a press
 * that misfires rather than anything that looks wrong.
 *
 * Whole class strings rather than a value interpolated into one: Tailwind finds
 * classes by scanning source text, so `[--stat-bar-h:${n}]` would generate
 * nothing at all. It is `DRAWER_BAR_HEIGHT`'s rule, one part over.
 */
export const STAT_BAR_H = "[--stat-bar-h:3rem] sm:[--stat-bar-h:3.25rem]";

export function StatBoard({
  week,
  lines,
  board,
  basis = "ppr",
  chromeClass = "",
}: {
  /** The week the page is on — the stepper's own, echoed by the payload. */
  week: number | null;
  /** Every player with a line, keyed by id — the payload's `players`. */
  lines: Readonly<Record<string, GametimeStatLine>>;
  /** The scoreboard, for each row's opponent and clock — the payload's `board`. */
  board: Readonly<Record<string, GametimeGame>>;
  /**
   * Which of the three scales the board prices on, stated on the bar.
   *
   * A prop rather than a league's `scoring_settings`: the board is
   * account-wide and spans leagues on different bases, so a per-league number
   * would be a claim no single league could support. See `statPoints`.
   */
  basis?: StatBasis;
  /**
   * The page's own stand-down class.
   *
   * The board is `fixed`, so it takes no part in the parked-card layout — but
   * a parked card is sized to the fold less a few pixels of breath, and a 52px
   * bar over its foot would cover the drawer bars at the bottom of its panes.
   * A parked card is the screen, and the page's chrome steps back for it; the
   * rack stays because the rack is the *app's* chrome rather than this page's.
   */
  chromeClass?: string;
}) {
  const open = useStatBoardOpen();
  const [filters, setFilters] = useState<StatBoardFilters>(NO_STAT_FILTERS);
  const [sort, setSort] = useState<{ key: StatSortKey; direction: 1 | -1 }>({
    key: "points",
    direction: -1,
  });

  // **The whole population**, priced once. The ramp below is anchored on its
  // mean and the bar's two readouts count over it, so it is deliberately the
  // list *before* any narrowing.
  const all = useMemo(() => statRows(lines, board, basis), [lines, board, basis]);
  const shown = useMemo(() => narrowStatRows(all, filters), [all, filters]);
  const rows = useMemo(
    () => rankStatRows(shown, sort.key, sort.direction),
    [shown, sort],
  );

  const teams = useMemo(() => statTeams(all), [all]);
  const top = useMemo(() => topStatRow(all), [all]);
  /**
   * The ramp's population — every row's points, **unfiltered**.
   *
   * `sharePercentile` is anchored on the mean rather than on a rank, which is
   * that function's own argument: ranking would spend full red and full green
   * on every view however tight the week was. Computed over the *narrowed*
   * set it would be the same fault one grain over — a player's colour moving
   * because the reader picked his position.
   */
  const population = useMemo(() => all.map((row) => row.points), [all]);

  const narrowed = statFiltersActive(filters);
  const press = (column: StatColumn) =>
    setSort((held) =>
      held.key === column.key
        ? { key: held.key, direction: (held.direction * -1) as 1 | -1 }
        : { key: column.key, direction: column.numeric ? -1 : 1 },
    );

  return (
    /* Fixed to the bottom edge and centred on the shell's own `max-w-6xl`, so
       the case's shoulders line up with the rack's above. `pointer-events` is
       off on the section and back on inside it: the gutter either side is
       transparent, and a page that could not be clicked through it would be a
       hundred cards behind a pane of glass. */
    <section
      aria-label="Weekly stat board"
      className={`lab-anim pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 transition-[height] duration-[340ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${chromeClass}`}
      style={{ height: open ? "calc(100dvh - var(--rack-clear))" : "var(--stat-bar-h)" }}
    >
      <div
        className={`pointer-events-auto relative flex w-full max-w-6xl flex-col overflow-hidden rounded-t-[1.125rem] bg-[image:var(--panel-case-bg)] shadow-[var(--panel-case-shadow)] ${STAT_BAR_H}`}
      >
        <Bar
          open={open}
          week={week}
          basis={basis}
          total={all.length}
          top={top}
        />
        {/* Mounted only while up — see the module note. */}
        {open && (
          <div className="relative flex min-h-0 flex-1 flex-col gap-2 p-2 sm:gap-2.5 sm:p-2.5">
            <Ledge
              filters={filters}
              onFilters={setFilters}
              teams={teams}
              shown={rows.length}
              total={all.length}
              narrowed={narrowed}
              sort={sort.key}
              onSort={(key) =>
                setSort({
                  key,
                  direction: (STAT_COLUMNS.find((c) => c.key === key)?.numeric ?? true)
                    ? -1
                    : 1,
                })
              }
              onReset={() => {
                setFilters(NO_STAT_FILTERS);
                setSort({ key: "points", direction: -1 });
              }}
            />
            <Table rows={rows} population={population} sort={sort} onPress={press} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The collapsed bar, which is also the open one's header — a billet strip,
 * and the whole of it is the button.
 *
 * It says the board exists and reports the week's headline without opening
 * it: how many players have a line, and who leads. **The basis is on it**, so
 * a reader is never left inferring which of three scales the figures are on —
 * `figured()`'s own reason for labelling the shares panels `Live`.
 *
 * Below `sm` the two readouts collapse into one and the legend shortens: the
 * desktop row is ~500px of content and a phone's is 348.
 */
function Bar({
  open,
  week,
  basis,
  total,
  top,
}: {
  open: boolean;
  week: number | null;
  basis: StatBasis;
  total: number;
  top: RankedStatRow | ReturnType<typeof topStatRow>;
}) {
  const label = week === null ? "Week —" : `Week ${week}`;
  return (
    <button
      type="button"
      onClick={() => storeStatBoardOpen(!open)}
      aria-expanded={open}
      className="relative flex h-[var(--stat-bar-h)] w-full shrink-0 cursor-pointer items-center gap-2 overflow-hidden border-0 bg-[image:var(--billet-bg)] px-2.5 text-left shadow-[var(--standing-strip-shadow)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60 sm:gap-3 sm:px-3.5"
    >
      <BilletFinish />
      {/* The lamp says the board is live rather than a static table. It is the
          page's own pulsing lamp (`lab-anim animate-pulse`) rather than a
          second spelling of one — the readout beside the week stepper already
          draws it, and two pulses at two rates on one page read as two
          different claims. */}
      <span
        aria-hidden
        className="lab-anim relative size-[0.4375rem] shrink-0 animate-pulse rounded-full bg-[var(--pip-lit-bg)] shadow-[0_0_8px_var(--accent-glow)]"
      />
      <span className="relative shrink-0 whitespace-nowrap font-display text-[length:var(--fs-14)] font-semibold uppercase tracking-[0.06em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] sm:text-[length:var(--fs-15)] sm:tracking-[0.08em]">
        Stat Board
      </span>

      {/* Desktop: the week and the basis in words, then a groove, then two
          readouts. Phone: one well carrying the week and the count. */}
      <span className="relative hidden shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:inline">
        {label} · {SCORING_LABEL[basis]}
      </span>
      <span
        aria-hidden
        className="relative hidden h-6 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)] sm:block"
      />

      <span className="relative inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-[0.4375rem] py-0.5 shadow-[var(--standing-well-shadow)] sm:hidden">
        <BayLabel>{week === null ? "Wk —" : `Wk ${week}`}</BayLabel>
        <BayFigure>{total}</BayFigure>
      </span>

      <span className="relative hidden min-w-0 flex-1 items-center gap-2 overflow-hidden sm:flex">
        <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 py-[0.1875rem] shadow-[var(--standing-well-shadow)]">
          <BayLabel>Players</BayLabel>
          <BayFigure>{total}</BayFigure>
        </span>
        {top && (
          <span className="inline-flex min-w-0 items-baseline gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 py-[0.1875rem] shadow-[var(--standing-well-shadow)]">
            <BayLabel>Top</BayLabel>
            <span className="min-w-0 truncate font-display text-[length:var(--fs-13)] font-medium text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]">
              {top.name ?? top.player_id}
            </span>
            <span className="shrink-0 font-display text-[length:var(--fs-14)] font-semibold tabular-nums text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]">
              {top.points.toFixed(1)}
            </span>
          </span>
        )}
      </span>

      <span className="relative ml-auto shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] sm:ml-0 sm:text-[length:var(--fs-10)] sm:tracking-[0.16em]">
        <span className="sm:hidden">{open ? "Close" : "Open"}</span>
        <span className="hidden sm:inline">{open ? "Collapse" : "Expand"}</span>
      </span>
      {/* The caret turns rather than swapping glyph — `DrawerBar`'s own, and
          `aria-hidden` because `aria-expanded` on the button already carries
          the state. */}
      <span
        aria-hidden
        className={`lab-anim relative w-4 shrink-0 text-right text-[length:var(--fs-13)] text-[color:var(--billet-label)] transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:w-5 sm:text-[length:var(--fs-14)] ${
          open ? "-rotate-90" : "rotate-90"
        }`}
      >
        ▸
      </span>
    </button>
  );
}

/** A stamped label in one of the bar's milled wells. */
function BayLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)]">
      {children}
    </span>
  );
}

/** Its figure. */
function BayFigure({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-display text-[length:var(--fs-13)] font-semibold tabular-nums text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)] sm:text-[length:var(--fs-14)]">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */

const POSITIONS: readonly PositionFilter[] = ["ALL", "QB", "RB", "WR", "TE"];

/**
 * The channel the position caps travel in.
 *
 * **`--rack-channel-bg` rather than `CONSOLE_CHANNEL`**, which is what the
 * design names and is the trap that constant's own doc records: its floor is
 * a black alpha, chosen so a recess is darker than its surround *in both
 * themes*, and that is right for a channel cut into dark stock. This one is
 * cut into the board's case, which is `--panel-case-bg` — near-white in
 * light — so 52% black there is not a channel milled into a part but a hole
 * punched through one, with `--billet-label`'s dark ink on it at about 2.3:1.
 * Measured on a light render, which is what caught it. The rack's own phone
 * caps sit in exactly this situation and this token is the answer that pass
 * arrived at: the same values in dark, and a shadow on stock with a lit lower
 * lip in light.
 */
const CAP_CHANNEL =
  "bg-[color:var(--rack-channel-bg)] shadow-[var(--rack-channel-shadow)]";

/**
 * The three narrowings and the Reset key, in a hole cut into the case.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. Two stacked rows
 * below `lg` and one wrapping row above, because a search field, five caps, a
 * team menu, a count and a key are ~700px of content.
 *
 * **The Sort menu exists only below `lg`**, where the column heads it stands
 * in for have nowhere to live. It offers a subset of the same columns, so the
 * two controls cannot come to name different orderings.
 */
function Ledge({
  filters,
  onFilters,
  teams,
  shown,
  total,
  narrowed,
  sort,
  onSort,
  onReset,
}: {
  filters: StatBoardFilters;
  onFilters: (filters: StatBoardFilters) => void;
  teams: readonly string[];
  shown: number;
  total: number;
  narrowed: boolean;
  sort: StatSortKey;
  onSort: (key: StatSortKey) => void;
  onReset: () => void;
}) {
  return (
    <div className="relative flex shrink-0 flex-col gap-1.5 rounded-xl bg-[color:var(--case-well-bg)] p-1.5 shadow-[var(--case-well-shadow)] lg:flex-row lg:flex-wrap lg:items-center lg:gap-2 lg:p-2">
      {/* Below `lg` the ledge is three rows and above it one that wraps, and
          the three wrappers are `lg:contents` so the items become the wide
          row's own children rather than being rendered twice. The desktop
          order is then set on the items, since `contents` flattens them into
          DOM order and the wide row wants Team before the count. */}
      <div className="flex items-center gap-1.5 lg:contents">
        <label className="relative inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 [background:var(--recess-bg)] shadow-[var(--track-shadow)] sm:gap-2 sm:px-3.5 lg:order-1 lg:min-w-48 lg:flex-[1_1_12rem]">
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="var(--readout-label)"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
            className="shrink-0"
          >
            <circle cx="10.5" cy="10.5" r="6" />
            <path d="M15 15l4.5 4.5" />
          </svg>
          <span className="sr-only">Search player</span>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
            placeholder="Search player"
            className="w-full min-w-0 border-0 bg-transparent py-2 font-mono text-[length:var(--fs-12)] tracking-[0.04em] text-[color:var(--billet-name)] outline-none placeholder:text-[color:var(--readout-label)]"
          />
        </label>

        {/* The Sort menu stands in for the column heads, which live in a table
            that is not drawn below `lg`. It offers a subset of the same
            columns, so the two controls cannot name different orderings. */}
        <label className={`${RECESS_PILL} shrink-0 lg:hidden`}>
          <span className={SELECT_LEGEND}>Sort</span>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as StatSortKey)}
            className={SELECT}
          >
            {PHONE_SORTS.map((key) => (
              <option key={key} value={key} className={OPTION}>
                {sortLabel(key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1.5 lg:contents">
        {/* The caps are a single-select rail in a deep channel, and the chosen
            one is the rack's own accent cap — one spelling of a lit cap in
            this app, so a reader who has pressed a Browse key knows this one.
            They stretch below `lg`, where the row is theirs. */}
        <span
          role="group"
          aria-label="Position"
          className={`${CAP_CHANNEL} flex flex-1 items-center gap-1 rounded-full p-1 lg:order-2 lg:flex-none`}
        >
          {POSITIONS.map((position) => {
            const lit = filters.position === position;
            return (
              <button
                key={position}
                type="button"
                aria-pressed={lit}
                onClick={() => onFilters({ ...filters, position })}
                className={`flex-auto rounded-full border px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] lg:flex-none lg:tracking-[0.14em] ${
                  lit
                    ? "border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] text-[var(--cap-accent-ink)] shadow-[var(--cap-accent-shadow)] [text-shadow:var(--cap-ink-emboss)]"
                    : "border-transparent text-[color:var(--billet-label)]"
                }`}
              >
                {position}
              </button>
            );
          })}
        </span>

        <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 py-1.5 shadow-[var(--standing-well-shadow)] lg:order-4 lg:gap-[0.4375rem] lg:px-2.5">
          <span className="hidden font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] lg:inline">
            Showing
          </span>
          <span
            role="status"
            className="font-mono text-[length:var(--fs-12-5)] tabular-nums text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]"
          >
            {shown} / {total}
          </span>
        </span>
      </div>

      {/* **A third row below `lg`, where the design's phone artboard draws
          neither of these.** Dropped, a phone reader cannot narrow by team at
          all and cannot clear three narrowings in one press — two controls
          rather than two labels, and the row they cost is ~36px of a board
          that has ~590 for its table. They do not fit on either row above:
          measured at 390, the caps and the count leave ~56px of the ledge and
          the Team menu alone wants ~85. */}
      <div className="flex items-center gap-1.5 lg:contents">
        <label className={`${RECESS_PILL} min-w-0 flex-1 lg:order-3 lg:flex-none`}>
          <span className={SELECT_LEGEND}>Team</span>
          <select
            value={filters.team}
            onChange={(e) => onFilters({ ...filters, team: e.target.value })}
            className={`${SELECT} min-w-0 flex-1`}
          >
            <option value="ALL" className={OPTION}>
              All
            </option>
            {teams.map((team) => (
              <option key={team} value={team} className={OPTION}>
                {team}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onReset}
          aria-disabled={!narrowed}
          className={`${CONSOLE_KEY} shrink-0 bg-[image:var(--key-metal)] py-1.5 lg:order-5 lg:ml-auto lg:py-2 ${
            narrowed ? "" : "opacity-50"
          }`}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

/** The recessed pill a native `<select>` sits in. */
const RECESS_PILL = `${CONSOLE_PANE_TRACK} inline-flex items-center gap-1.5 pl-2.5 pr-1 sm:gap-2 sm:pl-3.5 sm:pr-2`;

const SELECT_LEGEND =
  "shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--readout-label)]";

const SELECT =
  "cursor-pointer appearance-none border-0 bg-transparent py-2 pl-0 pr-1 font-mono " +
  "text-[length:var(--fs-12)] tracking-[0.06em] text-[color:var(--billet-name)] outline-none";

/**
 * A native `<option>` needs an explicit fill: the UA's popup is not part of
 * the page's cascade, so it inherits neither the pill's background nor its
 * ink, and a transparent option list on a dark platform menu is unreadable.
 * The one place in this file that names a colour outright, because there is no
 * theme to invert for — the popup is the platform's own surface.
 */
const OPTION = "bg-[#111b1e] text-[#ededed]";

/* ------------------------------------------------------------------ */

/**
 * The table: lit glass holding milled rows, in two arrangements.
 *
 * **A CSS grid rather than a `<table>`**, and the reason is the row: it reads
 * as a channel cut across the glass with 3px of glass between it and the next,
 * which a collapsed table cannot express — a `<tr>` has no box of its own to
 * round, inset or cast from.
 *
 * **Two arms rather than one.** Fifteen columns do not survive 390px, so the
 * phone takes the app's own two-line-below-`lg` row grammar (`SeatRow` and
 * `DrawerRow` both already turn this way) with the figures folded into one
 * stat line. They are two components gated by the cascade rather than one
 * with `lg:contents`, because what differs is the *content* and not only its
 * layout — nine columns become one string, and two cells become one. Both are
 * pure display and both gates are `display: none`, which takes one out of the
 * accessibility tree, so exactly one is ever read: `WeekStepper`'s own
 * precedent, and its two conditions.
 */
function Table({
  rows,
  population,
  sort,
  onPress,
}: {
  rows: readonly RankedStatRow[];
  population: readonly number[];
  sort: { key: StatSortKey; direction: 1 | -1 };
  onPress: (column: StatColumn) => void;
}) {
  const empty = rows.length === 0;
  return (
    <div className={`${CONSOLE_GLASS} flex min-h-0 flex-1 flex-col rounded-xl`}>
      <Scanlines />
      <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[3px] lg:overflow-x-auto">
        {/* The desktop arm scrolls sideways inside the glass rather than
            shrinking its columns: a figure column narrower than its figure is
            a number nobody can read, where a horizontal scroller is a table
            somebody can. */}
        {/* **Table semantics, spelled out.** A CSS grid has none of its own,
            so without them a screen reader is read four hundred rows of
            unlabelled numbers — and the sort state has nowhere to live either,
            since `aria-sort` belongs on a column header rather than on the
            button inside one. */}
        <div
          role="table"
          aria-label="Player stats"
          aria-rowcount={rows.length}
          className="hidden lg:block lg:min-w-[68.5rem]"
        >
          <Head sort={sort} onPress={onPress} />
          {rows.map((row) => (
            <WideRow key={row.player_id} row={row} population={population} />
          ))}
        </div>
        {/* The phone arm is a list rather than a table: its row is two lines
            of prose-ish readings rather than cells under headers, and there is
            no header for a column to be under. */}
        <ul className="m-0 list-none p-0 lg:hidden">
          {rows.map((row) => (
            <PhoneRow key={row.player_id} row={row} population={population} />
          ))}
        </ul>
        {empty && (
          <p className="m-5 mx-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-[color:var(--readout-label)] sm:mx-3 sm:text-[length:var(--fs-12)]">
            No player matches that narrowing.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The header, sticky at the top of the scroller: a machined ledge carrying two
 * grid rows.
 *
 * The first is the group labels, and their spans are read off the columns'
 * own runs (`statGroupSpans`) so the header and the grid cannot come to
 * disagree about how many tracks `Passing` covers. The second is the sort
 * keys, which are real `<button>`s carrying `aria-sort` on the cell they head.
 */
function Head({
  sort,
  onPress,
}: {
  sort: { key: StatSortKey; direction: 1 | -1 };
  onPress: (column: StatColumn) => void;
}) {
  const spans = statGroupSpans();
  return (
    // **No `overflow-hidden` on the ledge**, which is what the prototype
    // spells and is a clip that costs the header its own pinned columns: an
    // `overflow` other than `visible` makes an element a scroll container, so
    // a `sticky` descendant sticks to *it* rather than to the scroller — and
    // the ledge is exactly as wide as the grid, so sticking to it does
    // nothing at all. Measured at 1024, where the table overflows: the rows'
    // pinned cells held the edge and the heads above them slid away. The
    // radius is on the four corner cells instead, which is what the clip was
    // doing the rest of its work for.
    <div
      className={`${CONSOLE_WINDOW_LEDGE} sticky top-0 z-[3] mb-[5px] grid rounded-[7px]`}
      style={{ gridTemplateColumns: STAT_GRID_TEMPLATE }}
      role="row"
    >
      {spans.map((span, i) => (
        <span
          key={`${span.group ?? "none"}-${i}`}
          aria-hidden
          className={`row-start-1 flex items-center justify-center pt-1.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-[color:var(--billet-scope)] ${
            span.group === "Total"
              ? "sticky right-0 z-[4] justify-end rounded-tr-[7px] bg-[image:var(--window-ledge-bg)] px-2 shadow-[var(--stat-pin-right-shadow)]"
              : ""
          } ${i === 0 ? "sticky left-0 z-[4] rounded-tl-[7px] bg-[image:var(--window-ledge-bg)]" : ""}`}
          style={{ gridColumn: `span ${span.span}` }}
        >
          {span.group}
        </span>
      ))}
      {STAT_COLUMNS.map((column, i) => {
        const on = sort.key === column.key;
        const pinned = i === 0 ? "left" : column.key === "points" ? "right" : null;
        return (
          // The cell carries the sort state and the button carries the press:
          // `aria-sort` is a column header's property, and a `<button>` that
          // took the role would stop being announced as one.
          <span
            key={column.key}
            role="columnheader"
            aria-sort={on ? (sort.direction === -1 ? "descending" : "ascending") : "none"}
            className={`row-start-2 bg-[image:var(--window-ledge-bg)] ${
              pinned === "left"
                ? "sticky left-0 z-[4] rounded-bl-[7px] shadow-[var(--stat-pin-left-shadow)]"
                : pinned === "right"
                  ? "sticky right-0 z-[4] rounded-br-[7px] shadow-[var(--stat-pin-right-shadow)]"
                  : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onPress(column)}
              title={column.title}
              className={`flex h-[1.875rem] w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-2 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60 ${ALIGN[column.align]} ${
                on ? "text-[color:var(--billet-accent)]" : "text-[color:var(--billet-label)]"
              }`}
            >
              {column.label}
              <span aria-hidden className="text-[length:var(--fs-9)] text-[color:var(--billet-accent)]">
                {on ? (sort.direction === -1 ? "▼" : "▲") : ""}
              </span>
            </button>
          </span>
        );
      })}
    </div>
  );
}

const ALIGN: Record<StatColumn["align"], string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
};

/** The row height, compact — the design's own, and one number for both arms' cells. */
const WIDE_ROW = "h-[2.125rem]";

/**
 * One player, across fifteen columns.
 *
 * **Two pinned cells, each carrying its own fill.** A row well is a
 * translucent black over the glass, so a sticky cell without an opaque fill
 * smears every figure it slides across — which is why both paint
 * `--readout-bg` and restate the row's own lit lip. See
 * `--stat-pin-left-shadow`.
 */
function WideRow({
  row,
  population,
}: {
  row: RankedStatRow;
  population: readonly number[];
}) {
  const percentile = sharePercentile(row.points, population);
  return (
    <div
      role="row"
      className={`${CONSOLE_ROW_WELL} ${WIDE_ROW} mb-[3px] grid rounded-[7px]`}
      style={{ gridTemplateColumns: STAT_GRID_TEMPLATE }}
    >
      <span role="cell" className="sticky left-0 z-[2] flex min-w-0 items-center gap-2 rounded-l-[7px] bg-[image:var(--readout-bg)] px-2.5 shadow-[var(--stat-pin-left-shadow)]">
        <span
          aria-hidden
          className={`${CONSOLE_FIGURE_WELL} inline-flex size-[1.375rem] shrink-0 items-center justify-center font-mono text-[length:var(--fs-9)] tracking-[0.04em] text-[color:var(--readout-label)]`}
        >
          {row.rank}
        </span>
        <span className="min-w-0 truncate font-display text-[length:var(--fs-13)] font-medium text-[color:var(--readout-line)]">
          {row.name ?? row.player_id}
        </span>
      </span>
      <Cell align="center" className={POSITION_INK(row)}>
        {row.position}
      </Cell>
      <Cell align="center" className="text-[length:var(--fs-11)] tracking-[0.06em] text-[color:var(--readout-label)]">
        {row.team ?? EM_DASH}
      </Cell>
      <Cell align="center" className="text-[length:var(--fs-11)] tracking-[0.04em] text-[color:var(--readout-muted)]">
        {row.opponent ?? EM_DASH}
      </Cell>
      <Cell
        align="end"
        className={`pr-2.5 text-[length:var(--fs-10)] uppercase tracking-[0.04em] ${
          row.clock.live
            ? "text-readout [text-shadow:var(--readout-text-glow)]"
            : "text-[color:var(--stat-zero-ink)]"
        }`}
      >
        {row.clock.text}
      </Cell>
      <Figure value={row.pass_yd} />
      <Figure value={row.pass_td} />
      <Figure value={row.pass_int} alert />
      <Figure value={row.rush_yd} />
      <Figure value={row.rush_td} />
      <Figure value={row.rec} />
      <Figure value={row.rec_yd} />
      <Figure value={row.rec_td} />
      <Figure value={row.fumbles_lost} alert />
      <span role="cell" className="sticky right-0 z-[2] flex items-center justify-end rounded-r-[7px] bg-[image:var(--readout-bg)] px-2 shadow-[var(--stat-pin-right-shadow)]">
        <PointsFigure points={row.points} percentile={percentile} />
      </span>
    </div>
  );
}

const EM_DASH = "—";

/** A quarterback is lit, which is what makes a passing row scannable. */
const POSITION_INK = (row: { position: string }) =>
  `text-[length:var(--fs-10)] tracking-[0.1em] ${
    row.position === "QB"
      ? "text-[color:var(--billet-accent)]"
      : "text-[color:var(--readout-label)]"
  }`;

function Cell({
  align,
  className = "",
  children,
}: {
  align: StatColumn["align"];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span role="cell" className={`flex items-center font-mono ${ALIGN[align]} ${className}`}>
      {children}
    </span>
  );
}

/**
 * One stat.
 *
 * **A zero prints an em dash**, never `0` — the contract's own grammar, and
 * here the two readings genuinely are one: a player who caught nothing caught
 * nothing, and a column of noughts is a column nobody can scan. Interceptions
 * and lost fumbles ink `--error` when they are not, because those are the two
 * figures on the row a reader is looking for the *presence* of.
 */
function Figure({ value, alert = false }: { value: number; alert?: boolean }) {
  return (
    <span
      role="cell"
      className={`flex items-center justify-end pr-2.5 font-mono text-[length:var(--fs-12)] tabular-nums ${
        value === 0
          ? "text-[color:var(--stat-zero-ink)]"
          : alert
            ? "text-error"
            : "text-[color:var(--readout-line)]"
      }`}
    >
      {value === 0 ? EM_DASH : value}
    </span>
  );
}

/**
 * The points figure, inked by the ramp.
 *
 * `sharePercentile` over the **unfiltered** population, then `rankColor` for
 * the ink and `rankColor(pct, 0.4)` for the halo — one percentile behind both,
 * so the colour and its glow cannot disagree.
 */
function PointsFigure({ points, percentile }: { points: number; percentile: number }) {
  return (
    <span
      className={`${CONSOLE_FIGURE_WELL} inline-flex min-w-14 justify-end px-[7px] py-0.5 font-display text-[length:var(--fs-14)] font-semibold tabular-nums`}
      style={{
        color: rankColor(percentile),
        textShadow: `var(--standing-engrave), 0 0 14px ${rankColor(percentile, 0.4)}`,
      }}
    >
      {points.toFixed(1)}
    </span>
  );
}

/**
 * One player on two lines, for a pane fifteen columns cannot survive.
 *
 * Line 1 is the rank chip, the name and the points figure; line 2 is the
 * position, the matchup, the stat line and the clock. **The stat line is built
 * only from the groups he has a figure in** (`statLineSummary`), so a
 * receiver's row is never three dashes wide — which is the whole reason the
 * columns are folded rather than shrunk.
 */
function PhoneRow({
  row,
  population,
}: {
  row: RankedStatRow;
  population: readonly number[];
}) {
  const percentile = sharePercentile(row.points, population);
  return (
    <li
      className={`${CONSOLE_ROW_WELL} relative mb-[3px] flex h-[3.25rem] w-full flex-col justify-center gap-[3px] rounded-[7px] px-1.5`}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={`${CONSOLE_FIGURE_WELL} inline-flex w-5 shrink-0 justify-center py-px font-mono text-[length:var(--fs-9)] text-[color:var(--readout-label)]`}
        >
          {row.rank}
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-13)] font-medium text-[color:var(--readout-line)]">
          {row.name ?? row.player_id}
        </span>
        <PointsFigure points={row.points} percentile={percentile} />
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className={`w-5 shrink-0 text-center font-mono ${POSITION_INK(row)} text-[length:var(--fs-9)]`}>
          {row.position}
        </span>
        <span className="shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.04em] text-[color:var(--readout-muted)]">
          {row.team ?? EM_DASH}
          {row.opponent ? ` ${row.opponent}` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-right font-mono text-[length:var(--fs-9)] tracking-[0.02em] text-[color:var(--readout-label)]">
          {statLineSummary(row)}
        </span>
        {row.clock.text && (
          <span
            className={`shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.04em] ${
              row.clock.live
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-[color:var(--stat-zero-ink)]"
            }`}
          >
            {row.clock.text}
          </span>
        )}
      </span>
    </li>
  );
}
