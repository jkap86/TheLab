"use client";

import { useCallback, useMemo, useState } from "react";

import {
  BilletFinish,
  canonicalReadings,
  CONSOLE_FIGURE_WELL,
  CONSOLE_FIGURE_WELL_SHELL,
  CONSOLE_GLASS,
  CONSOLE_KEY,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
  CONSOLE_WINDOW_LEDGE,
  DecisionsDeck,
  DecisionsList,
  decisionsFor,
  leaguesLeft,
  NarrowingChip,
  rankColor,
  ReadingKeys,
  removeSubject,
  Scanlines,
  sharePercentile,
  storeStatBoardOpen,
  subjectSlot,
  toggleSubjectReading,
  useStatBoardOpen,
  type LeagueSubjects,
  type WeekLineupEntry,
  type WeekReading,
  type WeekTwoSidedShare,
  type WeekTwoSidedShares,
} from "@/features/shared";
import type { GametimeGame, GametimeStatLine } from "@/shared/contract";

import {
  heldStatRows,
  narrowStatRows,
  NO_SHARES,
  NO_STAT_FILTERS,
  PHONE_SORTS,
  rankStatRows,
  SCORING_LABEL,
  SHARE_COLUMNS,
  SHARE_READING,
  sortLabel,
  STAT_COLUMNS,
  STAT_GRID_MIN,
  STAT_GRID_TEMPLATE,
  STAT_PINNED_RIGHT,
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
  ShareColumnKey,
  SortableStatColumn,
  StatBasis,
  StatBoardFilters,
  StatColumn,
  StatShareCounts,
  StatSortKey,
} from "../helpers/stat-board";

/**
 * **Player Scores**: every skill player with a scoring line, and beside him
 * how many of the reader's own lineups started him, sat him, and faced him.
 *
 * **It used to be two panels answering two halves of one question.** The board
 * was a bar at the foot of the console holding a table of the NFL's week and
 * nothing about the reader's leagues; the Player Scores drawer was a panel
 * docked left holding the reader's four counts and nothing about what the
 * player did. Anybody asking the question a Sunday actually raises — *he had
 * thirty-one points, and which of my lineups was he in?* — had to hold one
 * panel's answer in their head while they opened the other. One row with both
 * is that comparison already made, which is the whole of this merge.
 *
 * **The board's shell won because the table needed it.** Nineteen columns do
 * not fit a 34rem drawer, and the four counts fit a full-width table with room
 * to spare; so the drawer's rows came here rather than the table going there,
 * and the bar took the drawer's own legend with them.
 *
 * **What a row *does* is the one behaviour that changed.** In the drawer a
 * press picked the row — narrowing the league grid behind it — and opened the
 * decisions view in one gesture. Here a press opens the decisions view alone
 * and the narrowing lives behind the row's own tray key, because the two are
 * genuinely different questions and this table is mostly read rather than
 * pressed: a reader scanning four hundred rows for a name should not narrow
 * their page by touching one. See {@link pressReading}, which is where a
 * subject is now born and where it dies.
 *
 * **Feature-local, on `features/shared`'s own rule: one reader.** The four
 * readings' controls are not — `ReadingKeys` and `NarrowingChip` moved to
 * `features/shared/ui/week-readings.tsx` when this took them, because the
 * lineup checker's drawer still draws the same four keys and a second spelling
 * would be two trays that stopped agreeing about which dot is filled.
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
 * **One spelling, because the page's own layout has to clear it.** The board is
 * `fixed` to the foot of the viewport and the league list's bottom margin is
 * measured against it — see `gametime-home.tsx`, which puts this on the page
 * root so both read the same number. A height written twice is a last card
 * under the bar the first time either moves.
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
  shares = null,
  entries,
  subjects,
  onSubjects,
  figureLabel,
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
  /**
   * How the reader's own week treated each player — the fold, or null before
   * the page has any reason to have paid for it.
   *
   * **Folded once per entry list rather than here**, because the page holds the
   * gate: on a 113-league account that walk is the expensive half of the merge
   * and a reader who never opens the board should not pay for it. Null is a
   * board of four dashes a column, which is the honest reading of a question
   * nobody has asked yet.
   */
  shares?: WeekTwoSidedShares | null;
  /**
   * The league-filtered, subject-unnarrowed entries, for the decisions view.
   *
   * Its own rule rather than the fold's leftovers: `decisionsFor` walks the
   * lineups again, per player, and the population it walks has to be the one
   * the counts were folded over or a row's `7 of 12` and the list under it
   * would be counting different leagues.
   */
  entries: readonly WeekLineupEntry[];
  /** The grid's narrowing, which the page owns and the tray edits. */
  subjects: LeagueSubjects;
  /**
   * Edit the selection whole.
   *
   * A reducer rather than three callbacks, because every one of those edits is
   * `league-subjects.ts`'s to spell and this component's job is to say *which*
   * of them a press means. The page still owns the state, which is what keeps
   * a narrowing alive after the board is shut.
   */
  onSubjects: (next: (prev: LeagueSubjects) => LeagueSubjects) => void;
  /**
   * What every figure in the decisions view is, in a window's worth of
   * characters. `Live` here — the page's own headline figure, and the one every
   * total on it is a sum of. See `figured` in `gametime-home.tsx`, which is
   * where the choice is made and where this word belongs beside it.
   */
  figureLabel: string;
}) {
  const open = useStatBoardOpen();
  const [filters, setFilters] = useState<StatBoardFilters>(NO_STAT_FILTERS);
  const [sort, setSort] = useState<{ key: StatSortKey; direction: 1 | -1 }>({
    key: "points",
    direction: -1,
  });
  // Which rows have their tray of narrowing keys open. Per row, and
  // deliberately not persisted: it is a way of reading the list, the call
  // `sort` already makes.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NO_EXPANDED);
  // The player whose decisions are open, and the counterpart that view is
  // narrowed to — both a way of reading this list rather than a preference.
  const [detail, setDetail] = useState<string | null>(null);
  const [combo, setCombo] = useState<string | null>(null);

  /**
   * The fold, indexed two ways.
   *
   * `counts` is what the join reads, and it is deliberately the structural four
   * rather than the whole row: the helper it feeds is pure and must not reach
   * into `features/shared`. `byId` is what the tray and the decisions deck read,
   * where the leagues behind each count are the answer.
   */
  const { counts, byId } = useMemo(() => {
    if (!shares) return { counts: NO_SHARES, byId: NO_PLAYERS };
    const counts: Record<string, StatShareCounts> = {};
    const byId = new Map<string, WeekTwoSidedShare>();
    for (const player of shares.players) {
      counts[player.player_id] = player;
      byId.set(player.player_id, player);
    }
    return { counts, byId };
  }, [shares]);

  // **The whole population**, priced once. The ramp below is anchored on its
  // mean and the bar's readouts count over it, so it is deliberately the list
  // *before* any narrowing.
  const all = useMemo(
    () => statRows(lines, board, basis, counts),
    [lines, board, basis, counts],
  );
  const shown = useMemo(() => narrowStatRows(all, filters), [all, filters]);
  const rows = useMemo(
    () => rankStatRows(shown, sort.key, sort.direction),
    [shown, sort],
  );

  const teams = useMemo(() => statTeams(all), [all]);
  const top = useMemo(() => topStatRow(all), [all]);
  const held = useMemo(() => heldStatRows(all), [all]);
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

  /**
   * The readings picked on each row, by player id.
   *
   * Built once per selection rather than searched per row per render: the row
   * list runs to several hundred and three of the things below ask this
   * question for every one of them.
   */
  const readings = useMemo(() => {
    const map = new Map<string, readonly WeekReading[]>();
    for (const subject of subjects.subjects) {
      if (subject.kind !== "week") continue;
      const picked = canonicalReadings(subject.readings);
      if (picked.length > 0) map.set(subject.id, picked);
    }
    return map;
  }, [subjects]);

  /**
   * A tray key: pick the row if it is not picked, then add or drop the reading
   * — **and drop the row itself when the last reading goes off.**
   *
   * That last clause is this panel's own, and it follows from a row press no
   * longer picking. In the drawer a subject with no readings is a row narrowed
   * to its resting reading, which the reader made deliberately by pressing the
   * row and can undo by pressing it again. Here nothing creates one and
   * nothing would clear one: a reader who turned their last key off would be
   * left with a grid still narrowed to every league that fielded him, no key
   * lit, and no control on screen that undoes it. So on this board a subject
   * lives exactly as long as it has a reading.
   */
  const pressReading = useCallback(
    (id: string, reading: WeekReading) => {
      onSubjects((prev) => {
        const slot = subjectSlot({ kind: "week", id });
        const held = prev.subjects.some((s) => subjectSlot(s) === slot)
          ? prev
          : {
              ...prev,
              subjects: [
                ...prev.subjects,
                { kind: "week" as const, id, readings: [] },
              ],
            };
        const next = toggleSubjectReading(held, "week", id, reading);
        const left = next.subjects.find((s) => subjectSlot(s) === slot);
        return canonicalReadings(left?.readings).length === 0
          ? removeSubject(next, { kind: "week", id })
          : next;
      });
    },
    [onSubjects],
  );

  /** The chip's ✕ — and for the reason above it removes the row, not its keys. */
  const clearRow = useCallback(
    (id: string) => onSubjects((prev) => removeSubject(prev, { kind: "week", id })),
    [onSubjects],
  );

  const discloseRow = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /** A row press opens the decisions view, and narrows nothing. */
  const openDetail = useCallback((id: string) => {
    setCombo(null);
    setDetail((prev) => (prev === id ? null : id));
  }, []);

  /** One chip per row that has readings picked, with what its union leaves. */
  const narrowings = useMemo(
    () =>
      [...readings.entries()].flatMap(([id, picked]) => {
        const player = byId.get(id);
        if (!player) return [];
        return [
          {
            id,
            name: player.name,
            picked,
            left: leaguesLeft(player.leagues, picked),
          },
        ];
      }),
    [readings, byId],
  );

  const narrowed = statFiltersActive(filters);
  const press = (column: SortableStatColumn) =>
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
      aria-label="Player scores"
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
          held={held}
          leagues={shares?.starter_league_count ?? 0}
          top={top}
          narrowings={narrowings}
          onClear={clearRow}
        />
        {/* The chip cannot ride a 390px bar — the legend, the week well and
            `Close` are already most of it — so below `sm` it takes a strip of
            its own in the case's own hole, directly under the bar. */}
        {narrowings.length > 0 && (
          <div className="relative flex shrink-0 items-center gap-1.5 overflow-hidden bg-[color:var(--case-well-bg)] px-2 py-1.5 shadow-[var(--case-well-shadow)] sm:hidden">
            {narrowings.map((chip) => (
              <NarrowingChip
                key={chip.id}
                name={chip.name}
                readings={chip.picked}
                left={chip.left}
                onClear={() => clearRow(chip.id)}
                className="py-[3px] pl-[0.5625rem] pr-1"
                chrome={CHIP_ON_METAL_SM}
              />
            ))}
          </div>
        )}
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
            {/* Two panes above `lg` and one below: the decisions view stands
                *beside* the table where there is room for both and *in front
                of* it where there is not. `display: none` on the hidden arm,
                so exactly one is ever in the accessibility tree. */}
            <div className="flex min-h-0 flex-1 gap-2 sm:gap-2.5">
              <Table
                className={detail ? "hidden lg:flex" : "flex"}
                rows={rows}
                population={population}
                sort={sort}
                onPress={press}
                shares={shares}
                readings={readings}
                expanded={expanded}
                onDisclose={discloseRow}
                onReading={pressReading}
                onDetail={openDetail}
                detail={detail}
              />
              {detail && (
                <Decisions
                  id={detail}
                  player={byId.get(detail) ?? null}
                  entries={entries}
                  combo={combo}
                  onCombo={setCombo}
                  figureLabel={figureLabel}
                  leagues={shares?.starter_league_count ?? 0}
                  onBack={() => {
                    setDetail(null);
                    setCombo(null);
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Module-level identities, so a render before anything lands hands the same. */
const NO_EXPANDED: ReadonlySet<string> = new Set<string>();
const NO_PLAYERS: ReadonlyMap<string, WeekTwoSidedShare> = new Map();

/**
 * A narrowing chip's ink on metal, at the two sizes the two strips take.
 *
 * The drawer's chip is drawn on lit glass and takes the readout's mint; this
 * one is stamped on a billet, so it takes `--billet-accent` over the engraving.
 * A chip in the readout's ink on metal would say the bar was a window.
 */
const CHIP_ON_METAL =
  "text-[length:var(--fs-10)] tracking-[0.14em] text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave)]";
const CHIP_ON_METAL_SM =
  "text-[length:var(--fs-9)] tracking-[0.12em] text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave)]";

/* ------------------------------------------------------------------ */

/**
 * The collapsed bar, which is also the open one's header — a billet strip,
 * and the whole of it is the button.
 *
 * It says the panel exists and reports the week's headline without opening it:
 * how many players have a line, how many of them anybody in the reader's
 * leagues has, and who leads. **The basis and the league count are on it**, so
 * a reader is never left inferring which of three scales the figures are on
 * nor what denominator every share cell drops — `figured()`'s own reason for
 * labelling the panes `Live`, and the merge's own for stating `12 leagues`
 * once rather than four times on every row.
 *
 * **The middle carries the wells at rest and the chips when there are any**,
 * which is the design's own swap and is the right way round: the wells are
 * ambient and a narrowing is news. With a chip up the caption drops its league
 * count too, because the chip's own tail states it.
 *
 * **The toggle is an `absolute inset-0` button rather than the strip itself**,
 * and it had to become one: a chip carries a ✕, and a `<button>` inside a
 * `<button>` is invalid and unreachable. So the strip is a box, the toggle
 * covers it under the content, and the content is `pointer-events-none` with
 * the ✕ alone re-enabled — a press anywhere else on the bar still toggles,
 * which is what "the bar is the whole button" has always meant.
 */
function Bar({
  open,
  week,
  basis,
  total,
  held,
  leagues,
  top,
  narrowings,
  onClear,
}: {
  open: boolean;
  week: number | null;
  basis: StatBasis;
  total: number;
  held: number;
  leagues: number;
  top: RankedStatRow | ReturnType<typeof topStatRow>;
  narrowings: readonly { id: string; name: string; picked: readonly WeekReading[]; left: number }[];
  onClear: (id: string) => void;
}) {
  const label = week === null ? "Week —" : `Week ${week}`;
  const chips = narrowings.length > 0;
  return (
    <div className="relative flex h-[var(--stat-bar-h)] w-full shrink-0 items-center gap-2 overflow-hidden bg-[image:var(--billet-bg)] px-2.5 shadow-[var(--standing-strip-shadow)] sm:gap-3 sm:px-3.5">
      <BilletFinish />
      <button
        type="button"
        onClick={() => storeStatBoardOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Collapse player scores" : "Expand player scores"}
        className="absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60"
      />
      {/* The content sits over the toggle and lets every press through to it;
          only the chip's own ✕ takes one back. */}
      <span className="pointer-events-none relative z-[2] flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {/* The lamp says the panel is live rather than a static table. It is
            the page's own pulsing lamp (`lab-anim animate-pulse`) rather than a
            second spelling of one — the readout beside the week stepper already
            draws it, and two pulses at two rates on one page read as two
            different claims. */}
        <span
          aria-hidden
          className="lab-anim size-[0.4375rem] shrink-0 animate-pulse rounded-full bg-[var(--pip-lit-bg)] shadow-[0_0_8px_var(--accent-glow)]"
        />
        <span className="shrink-0 whitespace-nowrap font-display text-[length:var(--fs-14)] font-semibold uppercase tracking-[0.06em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] sm:text-[length:var(--fs-15)] sm:tracking-[0.08em]">
          Player Scores
        </span>

        {/* Desktop: the week, the basis and the denominator in words, then a
            groove. Phone: one well carrying the week and the count. */}
        <span className="hidden shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:inline">
          {label} · {SCORING_LABEL[basis]}
          {!chips && leagues > 0 ? ` · ${leagues} leagues` : ""}
        </span>
        <span
          aria-hidden
          className="hidden h-6 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)] sm:block"
        />

        <span className="inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-[0.4375rem] py-0.5 shadow-[var(--standing-well-shadow)] sm:hidden">
          <BayLabel>{week === null ? "Wk —" : `Wk ${week}`}</BayLabel>
          <BayFigure>{total}</BayFigure>
        </span>

        <span className="hidden min-w-0 flex-1 items-center gap-2 overflow-hidden sm:flex">
          {chips ? (
            <>
              {narrowings.map((chip) => (
                <NarrowingChip
                  key={chip.id}
                  name={chip.name}
                  readings={chip.picked}
                  left={chip.left}
                  onClear={() => onClear(chip.id)}
                  className="pointer-events-auto py-1 pl-2.5 pr-[0.3125rem]"
                  chrome={CHIP_ON_METAL}
                />
              ))}
              {leagues > 0 && (
                <span className="shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)]">
                  {narrowings[0].left} of {leagues} leagues
                </span>
              )}
            </>
          ) : (
            <>
              <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 py-[0.1875rem] shadow-[var(--standing-well-shadow)]">
                <BayLabel>Players</BayLabel>
                <BayFigure>{total}</BayFigure>
              </span>
              {/* How many of them anybody in the reader's leagues has — the
                  merge's own reading, and the one that says why the four
                  columns on the right are mostly dashes. */}
              <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 py-[0.1875rem] shadow-[var(--standing-well-shadow)]">
                <BayLabel>Yours</BayLabel>
                <BayFigure>{held}</BayFigure>
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
            </>
          )}
        </span>

        <span
          aria-hidden
          className="ml-auto shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] sm:ml-0 sm:text-[length:var(--fs-10)] sm:tracking-[0.16em]"
        >
          <span className="sm:hidden">{open ? "Close" : "Open"}</span>
          <span className="hidden sm:inline">{open ? "Collapse" : "Expand"}</span>
        </span>
        {/* The caret turns rather than swapping glyph — `DrawerBar`'s own, and
            `aria-hidden` because `aria-expanded` on the button already carries
            the state. */}
        <span
          aria-hidden
          className={`lab-anim w-4 shrink-0 text-right text-[length:var(--fs-13)] text-[color:var(--billet-label)] transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:w-5 sm:text-[length:var(--fs-14)] ${
            open ? "-rotate-90" : "rotate-90"
          }`}
        >
          ▸
        </span>
      </span>
    </div>
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
 * The channel the caps travel in.
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

/** One cap in one of those channels, lit or not — the rack's own key. */
function Cap({
  lit,
  onPress,
  children,
  className = "",
}: {
  lit: boolean;
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={lit}
      onClick={onPress}
      className={`rounded-full border px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] lg:tracking-[0.14em] ${className} ${
        lit
          ? "border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] text-[var(--cap-accent-ink)] shadow-[var(--cap-accent-shadow)] [text-shadow:var(--cap-ink-emboss)]"
          : "border-transparent text-[color:var(--billet-label)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The narrowings and the Reset key, in a hole cut into the case.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. Two stacked rows
 * below `lg` and one wrapping row above, because a search field, seven caps, a
 * team menu, a count and a key are ~800px of content.
 *
 * **The Sort menu exists only below `lg`**, where the column heads it stands
 * in for have nowhere to live. It offers a subset of the same columns — the
 * four league readings among them, since the merge put four of the board's
 * columns in the reader's own half — so the two controls cannot come to name
 * different orderings.
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
        <label className="relative inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-3 [background:var(--recess-bg)] shadow-[var(--track-shadow)] sm:gap-2 sm:px-3.5 lg:order-1 lg:min-w-44 lg:flex-[1_1_11rem]">
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
          {POSITIONS.map((position) => (
            <Cap
              key={position}
              lit={filters.position === position}
              onPress={() => onFilters({ ...filters, position })}
              className="flex-auto lg:flex-none"
            >
              {position}
            </Cap>
          ))}
        </span>

        <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-[0.4375rem] bg-[image:var(--billet-well-bg)] px-2 py-1.5 shadow-[var(--standing-well-shadow)] lg:order-5 lg:gap-[0.4375rem] lg:px-2.5">
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

      {/* **A third row below `lg`, where the design's phone artboard draws no
          Team and no Reset.** Dropped, a phone reader cannot narrow by team at
          all and cannot clear four narrowings in one press — two controls
          rather than two labels, and the row they cost is ~36px of a board
          that has ~590 for its table. They do not fit on either row above:
          measured at 390, the position caps and the count leave ~56px of the
          ledge and the Team menu alone wants ~85. The scope caps come down
          here for the same measurement — see the group. */}
      <div className="flex items-center gap-1.5 lg:contents">
        {/* **The merge's own narrowing: whose shelf he is on.** The board is
            account-wide and only a minority of its rows are in the reader's
            leagues at all, so `Mine` needs a control rather than a reading —
            without one it is a question answerable only by scanning a column
            of dashes. Same cap vocabulary as the positions above, because it
            is the same kind of question.

            **It rides the Team row below `lg` rather than the positions'**,
            which is the design's own phone arrangement and is a measurement:
            five position caps are ~234px of a 358px ledge and these two are
            ~132, so on that row the second of them is clipped by the case's
            own `overflow-hidden` — silently, with nothing past the viewport to
            catch it. Rendered at 390, which is what found it. */}
        <span
          role="group"
          aria-label="Held in your leagues"
          className={`${CAP_CHANNEL} flex shrink-0 items-center gap-1 rounded-full p-1 lg:order-3`}
        >
          <Cap
            lit={filters.scope === "all"}
            onPress={() => onFilters({ ...filters, scope: "all" })}
          >
            All NFL
          </Cap>
          <Cap
            lit={filters.scope === "mine"}
            onPress={() => onFilters({ ...filters, scope: "mine" })}
          >
            Mine
          </Cap>
        </span>

        <label className={`${RECESS_PILL} min-w-0 flex-1 lg:order-4 lg:flex-none`}>
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
          className={`${CONSOLE_KEY} shrink-0 bg-[image:var(--key-metal)] py-1.5 lg:order-6 lg:ml-auto lg:py-2 ${
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
 * **Two arms rather than one.** Nineteen columns do not survive 390px, so the
 * phone takes the app's own two-line-below-`lg` row grammar (`SeatRow` and
 * `DrawerRow` both already turn this way) with the figures folded into one
 * stat line and the four readings on a third. They are two components gated by
 * the cascade rather than one with `lg:contents`, because what differs is the
 * *content* and not only its layout — nine columns become one string, and two
 * cells become one. Both are pure display and both gates are `display: none`,
 * which takes one out of the accessibility tree, so exactly one is ever read:
 * `WeekStepper`'s own precedent, and its two conditions.
 */
function Table({
  className,
  rows,
  population,
  sort,
  onPress,
  shares,
  readings,
  expanded,
  onDisclose,
  onReading,
  onDetail,
  detail,
}: {
  className: string;
  rows: readonly RankedStatRow[];
  population: readonly number[];
  sort: { key: StatSortKey; direction: 1 | -1 };
  onPress: (column: SortableStatColumn) => void;
  shares: WeekTwoSidedShares | null;
  readings: ReadonlyMap<string, readonly WeekReading[]>;
  expanded: ReadonlySet<string>;
  onDisclose: (id: string) => void;
  onReading: (id: string, reading: WeekReading) => void;
  onDetail: (id: string) => void;
  detail: string | null;
}) {
  const empty = rows.length === 0;
  const mine = shares?.starter_league_count ?? 0;
  const theirs = shares?.opponent_league_count ?? 0;
  return (
    <div className={`${CONSOLE_GLASS} min-h-0 min-w-0 flex-1 flex-col rounded-xl ${className}`}>
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
          aria-label="Player stats and league shares"
          aria-rowcount={rows.length}
          className="hidden lg:block"
          style={{ minWidth: STAT_GRID_MIN }}
        >
          <Head sort={sort} onPress={onPress} />
          {rows.map((row) => (
            <WideRow
              key={row.player_id}
              row={row}
              population={population}
              mine={mine}
              theirs={theirs}
              picked={readings.get(row.player_id) ?? NO_READINGS}
              open={expanded.has(row.player_id)}
              lit={detail === row.player_id}
              onDisclose={onDisclose}
              onReading={onReading}
              onDetail={onDetail}
            />
          ))}
        </div>
        {/* The phone arm is a list rather than a table: its row is three lines
            of prose-ish readings rather than cells under headers, and there is
            no header for a column to be under. */}
        <ul className="m-0 list-none p-0 lg:hidden">
          {rows.map((row) => (
            <PhoneRow
              key={row.player_id}
              row={row}
              population={population}
              picked={readings.get(row.player_id) ?? NO_READINGS}
              open={expanded.has(row.player_id)}
              lit={detail === row.player_id}
              onDisclose={onDisclose}
              onReading={onReading}
              onDetail={onDetail}
            />
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

const NO_READINGS: readonly WeekReading[] = [];

/**
 * The header, sticky at the top of the scroller: a machined ledge carrying two
 * grid rows.
 *
 * The first is the group labels, and their spans are read off the columns'
 * own runs (`statGroupSpans`) so the header and the grid cannot come to
 * disagree about how many tracks `Passing` covers — which is also how
 * `My leagues` gets its four for free. The second is the sort keys, which are
 * real `<button>`s carrying `aria-sort` on the cell they head.
 */
function Head({
  sort,
  onPress,
}: {
  sort: { key: StatSortKey; direction: 1 | -1 };
  onPress: (column: SortableStatColumn) => void;
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
          className={`row-start-1 flex items-center justify-center pt-1.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.18em] ${
            // **The reader's own half of the row is lit**, where the NFL's is
            // stamped. It is the one group label in `--billet-accent`, which
            // is what says the four columns under it are about you.
            span.group === "My leagues"
              ? "text-[color:var(--billet-accent)]"
              : "text-[color:var(--billet-scope)]"
          } ${
            span.pinned === null
              ? ""
              : `sticky z-[4] bg-[image:var(--window-ledge-bg)] ${
                  span.pinned === "left"
                    ? "left-0 rounded-tl-[7px]"
                    : "justify-end rounded-tr-[7px] px-2"
                }`
          }`}
          style={{
            gridColumn: `span ${span.span}`,
            ...(span.pinned === "left"
              ? { left: span.offset ?? undefined }
              : span.pinned === "right"
                ? { right: span.offset ?? undefined }
                : null),
          }}
        >
          {span.group}
        </span>
      ))}
      {STAT_COLUMNS.map((column) => {
        const on = column.sortable && sort.key === column.key;
        const offset = STAT_PINNED_RIGHT.get(column.key);
        return (
          // The cell carries the sort state and the button carries the press:
          // `aria-sort` is a column header's property, and a `<button>` that
          // took the role would stop being announced as one.
          <span
            key={column.key}
            role="columnheader"
            aria-sort={
              !column.sortable
                ? undefined
                : on
                  ? sort.direction === -1
                    ? "descending"
                    : "ascending"
                  : "none"
            }
            className={`row-start-2 bg-[image:var(--window-ledge-bg)] ${
              column.pinned === "left"
                ? "sticky left-0 z-[4] rounded-bl-[7px] shadow-[var(--stat-pin-left-shadow)]"
                : column.pinned === "right"
                  ? // Only the leading pinned cell casts, and every one of the
                    // six restates the row's lip — see `--stat-pin-lip`.
                    `sticky z-[4] ${
                      column.key === "tray" ? "rounded-br-[7px]" : ""
                    } ${
                      column.key === FIRST_PINNED
                        ? "shadow-[var(--stat-pin-right-shadow)]"
                        : "shadow-[var(--stat-pin-lip)]"
                    }`
                  : ""
            }`}
            style={column.pinned === "right" ? { right: offset } : undefined}
          >
            {column.sortable ? (
              <button
                type="button"
                onClick={() => onPress(column as SortableStatColumn)}
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
            ) : (
              // The tray key's own column: a head with nothing to press, so a
              // blank of the same height rather than a button that does
              // nothing.
              <span className="block h-[1.875rem]" />
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The leading column of the pinned tail — the only one that casts. */
const FIRST_PINNED = STAT_COLUMNS.find((c) => c.pinned === "right")!.key;

const ALIGN: Record<StatColumn["align"], string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
};

/** The row's own height, compact — the design's own, and one number for both arms. */
const WIDE_ROW = "2.125rem";

/**
 * One player, across nineteen columns and a tray key.
 *
 * **Six pinned cells at the right and one at the left, each carrying its own
 * fill.** A row well is a translucent black over the glass, so a sticky cell
 * without an opaque fill smears every figure it slides across — which is why
 * every one of them paints `--readout-bg`. Only the leading cell of the right
 * block casts; the other five restate the row's lit lower lip alone, or six
 * casts would paint a seam onto each other. See `--stat-pin-lip`.
 *
 * **The tray is a second grid row rather than a second element**, placed at
 * `1 / -1`. One node per row, so a shut row costs nothing beyond the cells it
 * draws, and the well the tray sits in is the row's own.
 */
function WideRow({
  row,
  population,
  mine,
  theirs,
  picked,
  open,
  lit,
  onDisclose,
  onReading,
  onDetail,
}: {
  row: RankedStatRow;
  population: readonly number[];
  mine: number;
  theirs: number;
  picked: readonly WeekReading[];
  open: boolean;
  lit: boolean;
  onDisclose: (id: string) => void;
  onReading: (id: string, reading: WeekReading) => void;
  onDetail: (id: string) => void;
}) {
  const percentile = sharePercentile(row.points, population);
  return (
    <div
      role="row"
      className={`${CONSOLE_ROW_WELL} mb-[3px] grid rounded-[7px] ${
        open || lit ? "shadow-[var(--row-well-shadow),0_0_24px_-10px_var(--accent-glow)]" : ""
      }`}
      style={{ gridTemplateColumns: STAT_GRID_TEMPLATE, gridTemplateRows: WIDE_ROW }}
    >
      <span
        role="cell"
        className="sticky left-0 z-[2] flex min-w-0 items-center rounded-l-[7px] bg-[image:var(--readout-bg)] shadow-[var(--stat-pin-left-shadow)]"
      >
        {/* **The name is the press, and the press opens the decisions view.**
            A whole-row overlay is not available here: the pinned cells are
            positioned and paint above it, so only the scrolling middle would
            take a click. The name cell is the one that says whose row this is,
            and at 14rem it is target enough. */}
        <button
          type="button"
          onClick={() => onDetail(row.player_id)}
          aria-pressed={lit}
          className="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent px-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60"
        >
          <span
            aria-hidden
            className={`${CONSOLE_FIGURE_WELL} inline-flex size-[1.375rem] shrink-0 items-center justify-center font-mono text-[length:var(--fs-9)] tracking-[0.04em] text-[color:var(--readout-label)]`}
          >
            {row.rank}
          </span>
          <span
            className={`min-w-0 truncate font-display text-[length:var(--fs-13)] font-medium ${
              open || lit
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-[color:var(--readout-line)]"
            }`}
          >
            {row.name ?? row.player_id}
          </span>
          <HeldPip held={row.held} />
        </button>
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
      {SHARE_COLUMNS.map((column, i) => {
        const key = column.key as ShareColumnKey;
        const reading = SHARE_READING[key];
        return (
          <ShareCell
            key={key}
            value={row[key]}
            of={reading.mine ? mine : theirs}
            quiet={reading.quiet}
            lit={picked.includes(key)}
            // The groove between the pairs, as the gap the design draws it as:
            // a cut here would be a 1px element inside a 3rem cell, where
            // 10px of glass says the same thing.
            first={i === 2}
            offset={STAT_PINNED_RIGHT.get(key)}
            leading={key === FIRST_PINNED}
          />
        );
      })}
      <span
        role="cell"
        className="sticky z-[2] flex items-center justify-end bg-[image:var(--readout-bg)] pl-2 shadow-[var(--stat-pin-lip)]"
        style={{ right: STAT_PINNED_RIGHT.get("points") }}
      >
        <PointsFigure points={row.points} percentile={percentile} />
      </span>
      <span
        role="cell"
        className="sticky right-0 z-[2] flex items-center justify-end rounded-r-[7px] bg-[image:var(--readout-bg)] pr-1.5 shadow-[var(--stat-pin-lip)]"
      >
        <TrayKey open={open} name={row.name ?? row.player_id} onPress={() => onDisclose(row.player_id)} />
      </span>
      {open && (
        <span role="cell" className="col-[1/-1]">
          {/* Left-aligned to the name column, so the keys sit under the row
              they narrow rather than under its rank chip. */}
          <span className="flex items-center pb-[0.5625rem] pl-[3.0625rem] pr-[0.6875rem]">
            <ReadingKeys
              counts={counts(row)}
              picked={picked}
              onPress={(reading) => onReading(row.player_id, reading)}
            />
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * A row's four counts as the tray reads them — zeroes for a player nobody in
 * the reader's leagues has.
 *
 * The tray is only ever opened on a row a reader is narrowing by, and a row
 * with no shares narrows to nothing; the zeroes are what its keys print rather
 * than a claim, and the cells above already say the difference with a dash.
 */
function counts(row: RankedStatRow) {
  return {
    started: row.start ?? 0,
    benched: row.bench ?? 0,
    oppStarted: row["opp-start"] ?? 0,
    oppBenched: row["opp-bench"] ?? 0,
  };
}

const EM_DASH = "—";

/**
 * The pip that says anybody in the reader's leagues has him.
 *
 * **It is what makes the merge legible while the four cells are scrolled out
 * of view**, which on a nineteen-column table is most of the time — and it is
 * the same pip `ShareRow` already grows for a narrowed row, so a reader who
 * knows one knows this.
 *
 * Drawn transparent rather than dropped where nobody has him: the name column
 * is `1fr` and a pip that came and went would move every truncation point down
 * the column with it.
 */
function HeldPip({ held }: { held: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-[0.4375rem] shrink-0 rounded-full ${
        held ? "bg-active shadow-[0_0_9px_var(--accent-glow)]" : "bg-transparent"
      }`}
    />
  );
}

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
 * One of the four league readings, in a channel cut into the pinned block.
 *
 * **A dash and a zero are two different answers here**, which is the one thing
 * about these cells that is silent when it is wrong: `—` says the reader's
 * leagues have never heard of him, and `0/11` says they have and no opponent
 * ever benched him. On the other fourteen columns a zero *is* an absence, and
 * printing them the same way would be exactly backwards.
 *
 * **The trailing percentage the drawer's own cells carry is dropped**, which
 * is what lets four of these fit a table: the bar states the denominator once,
 * and four percentages on every row of a nineteen-column board is the column
 * it cannot spare.
 *
 * **Lit is a rim and a halo, never a fill.** The figure inside is a reading,
 * and tinting the glass would make the number mean something different from
 * the identical number two cells over — `Cell`'s own note one panel over. A
 * lit cell also gives up its `quiet` step-down, so a lit `Bench` reads at the
 * `Start` weight: the reader picked it, so it is not the secondary one any
 * more.
 */
function ShareCell({
  value,
  of,
  quiet,
  lit,
  first,
  offset,
  leading,
}: {
  value: number | null;
  of: number;
  quiet: boolean;
  lit: boolean;
  /** The first of the opposing pair, which carries the groove's own gap. */
  first: boolean;
  offset: string | undefined;
  /** The leading cell of the pinned block — the only one that casts. */
  leading: boolean;
}) {
  const held = value !== null;
  return (
    <span
      role="cell"
      className={`sticky z-[2] flex items-center bg-[image:var(--readout-bg)] ${
        leading ? "shadow-[var(--stat-pin-right-shadow)]" : "shadow-[var(--stat-pin-lip)]"
      } ${first ? "pl-2.5" : "pl-0.5"}`}
      style={{ right: offset }}
    >
      <span
        // The shell rather than the well: a second `shadow-*` appended to
        // one that already carries the resting shadow loses Tailwind's own
        // emit-order flip, and what that looks like is a rim that lights over
        // a halo that never does. See `CONSOLE_FIGURE_WELL_SHELL`.
        className={`${CONSOLE_FIGURE_WELL_SHELL} flex h-[1.375rem] w-full items-center justify-end border px-1.5 font-mono text-[length:var(--fs-11)] tabular-nums ${
          lit
            ? "border-active/55 shadow-[var(--figure-well-shadow),0_0_20px_-8px_var(--accent-glow)]"
            : "border-transparent shadow-[var(--figure-well-shadow)]"
        } ${
          !held
            ? "text-[color:var(--stat-zero-ink)]"
            : quiet && !lit
              ? "text-[color:var(--readout-line)]"
              : "text-readout [text-shadow:var(--readout-text-glow)]"
        }`}
      >
        {held ? `${value}/${of}` : EM_DASH}
      </span>
    </span>
  );
}

/**
 * The row's disclosure: the key its tray of narrowing keys opens behind.
 *
 * A sibling of the name's press rather than a control nested inside it — two
 * `<button>`s in one row, which is the arrangement `ShareRow` already states
 * at length: a row that can be read and a row that can be narrowed are two
 * questions, and a `<summary>` maps to a leaf `button` that a nested control
 * is unreliably reachable inside of.
 */
function TrayKey({
  open,
  name,
  onPress,
}: {
  open: boolean;
  name: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} narrowing keys for ${name}`}
      className={`inline-flex h-7 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[0.4375rem] border bg-[image:var(--key-bg)] font-mono text-[length:var(--fs-9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
        open
          ? "border-active/50 text-active shadow-[var(--key-shadow-pressed)]"
          : "border-foreground/10 text-foreground/55 shadow-[var(--key-shadow)]"
      }`}
    >
      <span aria-hidden>{open ? "▲" : "▼"}</span>
    </button>
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
 * One player on three lines, for a pane nineteen columns cannot survive.
 *
 * Line 1 is the rank chip, the name, the points figure and the tray key; line
 * 2 is the position, the matchup, the stat line and the clock; **line 3 is the
 * four readings in one figure-well strip**. The stat line is built only from
 * the groups he has a figure in (`statLineSummary`), so a receiver's row is
 * never three dashes wide — which is the whole reason the columns are folded
 * rather than shrunk.
 *
 * **The strip is drawn even where nobody has him**, four dashes rather than
 * nothing, so the list still reads down the column: a row that dropped its
 * third line would be shorter than the rows either side of it and the eye
 * would lose the count it was scanning.
 */
function PhoneRow({
  row,
  population,
  picked,
  open,
  lit,
  onDisclose,
  onReading,
  onDetail,
}: {
  row: RankedStatRow;
  population: readonly number[];
  picked: readonly WeekReading[];
  open: boolean;
  lit: boolean;
  onDisclose: (id: string) => void;
  onReading: (id: string, reading: WeekReading) => void;
  onDetail: (id: string) => void;
}) {
  const percentile = sharePercentile(row.points, population);
  return (
    <li
      className={`${CONSOLE_ROW_WELL} relative mb-[3px] flex w-full flex-col justify-center gap-[3px] rounded-[7px] px-1.5 py-[5px] ${
        open || lit ? "shadow-[var(--row-well-shadow),0_0_24px_-10px_var(--accent-glow)]" : ""
      }`}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onDetail(row.player_id)}
          aria-pressed={lit}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        >
          <span
            aria-hidden
            className={`${CONSOLE_FIGURE_WELL} inline-flex w-5 shrink-0 justify-center py-px font-mono text-[length:var(--fs-9)] text-[color:var(--readout-label)]`}
          >
            {row.rank}
          </span>
          <span
            className={`min-w-0 flex-1 truncate font-display text-[length:var(--fs-13)] font-medium ${
              open || lit
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-[color:var(--readout-line)]"
            }`}
          >
            {row.name ?? row.player_id}
          </span>
          <HeldPip held={row.held} />
        </button>
        <PointsFigure points={row.points} percentile={percentile} />
        <TrayKey open={open} name={row.name ?? row.player_id} onPress={() => onDisclose(row.player_id)} />
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
      {/* **Counts alone, no denominators.** Four `n/12` readings plus their
          labels are wider than a 390px row; the bar states the denominator
          once, which is the same argument the desktop cells drop their
          percentage on, one notch further. */}
      <span
        className={`${CONSOLE_FIGURE_WELL} flex w-full items-center gap-[3px] px-[5px] py-0.5`}
      >
        {SHARE_COLUMNS.map((column, i) => {
          const key = column.key as ShareColumnKey;
          const reading = SHARE_READING[key];
          const value = row[key];
          const on = picked.includes(key);
          return (
            <span
              key={key}
              // A lit reading here is a **rim inside the strip** rather than a
              // well of its own: there is no room for four wells on this line.
              className={`inline-flex min-w-0 flex-1 items-baseline justify-center gap-1 overflow-hidden rounded-full border py-px ${
                i === 2 ? "ml-2" : ""
              } ${on ? "border-active/55 shadow-[0_0_16px_-8px_var(--accent-glow)]" : "border-transparent"}`}
            >
              <span className="shrink-0 font-mono text-[length:var(--fs-8)] uppercase tracking-[0.1em] text-[color:var(--readout-label)]">
                {reading.phone}
              </span>
              <span
                className={`shrink-0 font-mono text-[length:var(--fs-10)] tabular-nums ${
                  value === null
                    ? "text-[color:var(--stat-zero-ink)]"
                    : reading.quiet && !on
                      ? "text-[color:var(--readout-line)]"
                      : "text-readout [text-shadow:var(--readout-text-glow)]"
                }`}
              >
                {value === null ? EM_DASH : value}
              </span>
            </span>
          );
        })}
      </span>
      {open && (
        <ReadingKeys
          counts={counts(row)}
          picked={picked}
          onPress={(reading) => onReading(row.player_id, reading)}
          layout="grid"
        />
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The decisions view: which of the reader's lineups started him, and what the
 * seat opposite did.
 *
 * `DecisionsDeck` and `DecisionsList` rather than a second drawing of them —
 * the lineup checker's drawer opens the identical view off the identical walk,
 * and this board and that drawer are the same question asked from two tools.
 *
 * **`Back` closes the view and undoes nothing**, because the view never
 * narrowed anything: on this board a press opens a reading and the tray is
 * what narrows. That is the one thing a reader coming from the drawer has to
 * unlearn, and it is why the row's own lit state is the view's rather than the
 * selection's.
 */
function Decisions({
  id,
  player,
  entries,
  combo,
  onCombo,
  figureLabel,
  leagues,
  onBack,
}: {
  id: string;
  player: WeekTwoSidedShare | null;
  entries: readonly WeekLineupEntry[];
  combo: string | null;
  onCombo: (id: string | null) => void;
  figureLabel: string;
  leagues: number;
  onBack: () => void;
}) {
  const groups = useMemo(() => decisionsFor(id, entries), [id, entries]);
  const picked = groups.find((group) => group.player_id === combo) ?? null;

  return (
    <div
      className={`${CONSOLE_GLASS} flex min-h-0 w-full min-w-0 flex-col rounded-xl lg:w-96 lg:shrink-0`}
    >
      <Scanlines />
      <div className="relative z-[1] shrink-0 border-b border-black/40 p-2.5">
        <DecisionsDeck
          name={player?.name ?? id}
          position={player?.position ?? null}
          team={player?.team ?? null}
          figure={player?.figure ?? null}
          figureLabel={figureLabel}
          line={
            picked
              ? `With ${picked.name} · ${picked.rows.length} of ${leagues} leagues`
              : player
                ? `Started in ${player.started} of ${leagues} leagues · benched in ${player.benched}`
                : "Nobody in your leagues has him this week."
          }
          onBack={onBack}
        />
      </div>
      <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-y-auto p-2.5">
        <DecisionsList
          groups={picked ? [picked] : groups}
          picked={combo}
          figureLabel={figureLabel}
          onPick={(pick) => onCombo(combo === pick ? null : pick)}
        />
      </div>
    </div>
  );
}
