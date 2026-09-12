"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  BilletFinish,
  CONSOLE_FIGURE_WELL,
  CONSOLE_FIGURE_WELL_SHELL,
  CONSOLE_GLASS,
  CONSOLE_MILLED_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
  CONSOLE_WINDOW_LEDGE,
  rankColor,
  Scanlines,
  sharePercentile,
  storeStatBoardOpen,
  useStatBoardOpen,
  type WeekLineupEntry,
  type WeekTwoSidedShares,
} from "@/features/shared";
import type {
  GametimeGame,
  GametimeStatLine,
  StatBoardPosition,
} from "@/shared/contract";

import {
  playerBreakdown,
  type BreakdownGroupKey,
  type BreakdownRow,
} from "../helpers/player-breakdown";
import {
  menuSummary,
  narrowStatRows,
  NO_SHARES,
  NO_STAT_FILTERS,
  rankStatRows,
  SCORING_LABEL,
  STAT_POSITIONS,
  STAT_SORTS,
  statRows,
  statTagLine,
  statTags,
  statTeams,
  toggleFilterValue,
  topStatRow,
} from "../helpers/stat-board";
import type {
  RankedStatRow,
  StatBasis,
  StatBoardFilters,
  StatRow,
  StatShareCounts,
  StatSortKey,
  StatTag,
} from "../helpers/stat-board";

/**
 * **Player Scores**: who is scoring what, and where the reader stands on him.
 *
 * **Two questions, where there used to be many.** This was a twenty-column
 * board — a full box score, four pinned league-share cells as `n/12`
 * fractions, a per-row tray of narrowing keys and a decisions pane — none of
 * which could be read without scrolling sideways past the other three. The
 * redesign keeps the two a reader actually asks on a Sunday: *who is scoring
 * what*, which is a vertical list with one figure on it, and *where do I stand
 * on this guy*, which is a press away and names their twelve leagues in five
 * groups.
 *
 * **The box score came off rather than moving behind a disclosure**, and that
 * is the change everything else follows from: with the splits gone there is no
 * horizontal scroll, so the list is four columns at every width and the row is
 * one press rather than a row plus a tray key.
 *
 * **A press picks, and picking narrows nothing.** The tray keys that used to
 * narrow the page's league grid went with the columns, so this panel no longer
 * edits the grid behind it — see `gametime-home.tsx`, which lost the state they
 * were the only writer of. What replaces that answer is a better one: the
 * breakdown *names* the leagues rather than leaving a reader to read a filtered
 * grid for them.
 *
 * **The whole panel is mounted only while the bar is up.** A closed bar is 52px
 * of billet and nothing else — no rows, no ledge, no scroller — which is
 * `usePanelCap`'s `mounted` one component over and for its reason: a few
 * hundred rows behind a control most readers never press is a document the page
 * pays for on every frame the room pushes.
 *
 * **The order is filter, then sort, then rank**, and the rank is the row's
 * place *in the current view* rather than a stored ranking — so it renumbers
 * from 1 on every narrowing. A stored place would have a list narrowed to tight
 * ends open at rank 41.
 *
 * **Feature-local, on `features/shared`'s own rule: one reader.**
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
}: {
  /** The week the page is on — the stepper's own, echoed by the payload. */
  week: number | null;
  /** Every player with a line, keyed by id — the payload's `players`. */
  lines: Readonly<Record<string, GametimeStatLine>>;
  /** The scoreboard, for each row's opponent and clock — the payload's `board`. */
  board: Readonly<Record<string, GametimeGame>>;
  /**
   * Which of the three scales the list prices on, stated on the bar.
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
   * gate: on a 113-league account that walk is the expensive half and a reader
   * who never opens the board should not pay for it. Null is a list whose
   * `Your leagues` cells all read `Nobody in your leagues`, which is the honest
   * reading of a question nobody has asked yet.
   */
  shares?: WeekTwoSidedShares | null;
  /**
   * The league-filtered entries, for the breakdown.
   *
   * Its own rule rather than the fold's leftovers: `playerBreakdown` walks the
   * lineups again, per player, and the population it walks has to be the one
   * the counts were folded over — or a row's `Started 7` and the list a press
   * opens would be counting different leagues. It is also what carries the two
   * things a count cannot: the *slot* he sat in and the manager across from the
   * reader in that league.
   */
  entries: readonly WeekLineupEntry[];
}) {
  const open = useStatBoardOpen();
  const [filters, setFilters] = useState<StatBoardFilters>(NO_STAT_FILTERS);
  const [sort, setSort] = useState<StatSortKey>("points");
  /**
   * The player whose breakdown is open.
   *
   * A way of reading this list rather than a preference, so it is not
   * persisted — the call `sort` and the filters already make. Null is the
   * resting state, where the pane prompts rather than seeding itself with the
   * week's top scorer: a pane that opened already answering would be claiming
   * a reader had asked about somebody.
   */
  const [picked, setPicked] = useState<string | null>(null);

  /**
   * The fold, indexed by player id — the join `statRows` reads.
   *
   * Deliberately the structural four rather than the whole row: the helper it
   * feeds is pure and must not reach into `features/shared`.
   */
  const counts = useMemo(() => {
    if (!shares) return NO_SHARES;
    const byId: Record<string, StatShareCounts> = {};
    for (const player of shares.players) byId[player.player_id] = player;
    return byId;
  }, [shares]);

  // **The whole population**, priced once. The ramp below is anchored on its
  // mean and the bar's readout counts over it, so it is deliberately the list
  // *before* any narrowing.
  const all = useMemo(
    () => statRows(lines, board, basis, counts),
    [lines, board, basis, counts],
  );
  const shown = useMemo(() => narrowStatRows(all, filters), [all, filters]);
  const rows = useMemo(() => rankStatRows(shown, sort), [shown, sort]);

  const teams = useMemo(() => statTeams(all), [all]);
  const top = useMemo(() => topStatRow(all), [all]);
  /**
   * The ramp's population — every row's points, **unfiltered**.
   *
   * `sharePercentile` is anchored on the mean rather than on a rank, which is
   * that function's own argument: ranking would spend full red and full green
   * on every view however tight the week was. Computed over the *narrowed* set
   * it would be the same fault one grain over — a player's colour moving
   * because the reader picked his position.
   */
  const population = useMemo(() => all.map((row) => row.points), [all]);

  const detail = useMemo(
    () => (picked ? (rows.find((r) => r.player_id === picked) ?? null) : null),
    [picked, rows],
  );
  /**
   * The five groups, walked for the picked player alone.
   *
   * Behind the pick rather than folded for every row: it is a walk over every
   * league's two lineups, and a hundred rows' worth of it would be paid on
   * every frame the room pushes to answer a question about one.
   */
  const groups = useMemo(
    () => (picked ? playerBreakdown(picked, entries) : []),
    [picked, entries],
  );

  const leagues = shares?.starter_league_count ?? 0;

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
          leagues={leagues}
          top={top}
          detail={detail}
          onList={() => setPicked(null)}
        />
        {/* Mounted only while up — see the module note. */}
        {open && (
          <div className="relative flex min-h-0 flex-1 gap-2 p-2 sm:gap-2.5 sm:p-2.5">
            {/* **Below `lg` the breakdown replaces the list**, which is the
                design's own phone arrangement: one pane at a time, and the
                bar's `‹ List` key is the way back. `display: none` on the
                hidden arm, so exactly one is ever in the accessibility tree. */}
            <div
              className={`min-w-0 flex-1 flex-col gap-2 sm:gap-2.5 ${
                detail ? "hidden lg:flex" : "flex"
              }`}
            >
              <Ledge
                filters={filters}
                onFilters={setFilters}
                teams={teams}
                sort={sort}
                onSort={setSort}
              />
              <List
                rows={rows}
                population={population}
                sort={sort}
                picked={picked}
                onPick={setPicked}
                narrowed={rows.length !== all.length}
              />
            </div>
            {/* The right pane stands *beside* the list where there is room and
                *in front of* it where there is not, and at rest above `lg` it
                prompts rather than seeding itself with a player. */}
            <Breakdown
              className={detail ? "flex" : "hidden lg:flex"}
              row={detail}
              groups={groups}
              leagues={leagues}
            />
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
 * It says the panel exists and reports the week's headline without opening it:
 * which week, which of three scales the figures are on, how many leagues the
 * counts are drawn over, and who leads. **The basis and the league count are on
 * it** so a reader is never left inferring either — `figured()`'s own reason
 * for labelling the panes `Live`, and the merge's own for stating `12 leagues`
 * once rather than on every row.
 *
 * **On the phone breakdown it carries `‹ List` and the player instead**, which
 * is the design's 2c: there is no room for both a way back and a headline, and
 * the headline is the thing a reader looking at one player is not reading.
 *
 * **The toggle is an `absolute inset-0` button rather than the strip itself**,
 * and it has to be one: `‹ List` is a `<button>`, and a `<button>` inside a
 * `<button>` is invalid and unreachable. So the strip is a box, the toggle
 * covers it under the content, and the content is `pointer-events-none` with
 * that one key re-enabled — a press anywhere else on the bar still toggles,
 * which is what "the bar is the whole button" has always meant. It is also what
 * keeps the drawer closable from the phone breakdown, where the design draws no
 * `Close` word: the caret is the affordance and the bar is still the control.
 */
function Bar({
  open,
  week,
  basis,
  leagues,
  top,
  detail,
  onList,
}: {
  open: boolean;
  week: number | null;
  basis: StatBasis;
  leagues: number;
  top: StatRow | null;
  /** The picked row, which the phone bar names in place of the headline. */
  detail: RankedStatRow | null;
  onList: () => void;
}) {
  const label = week === null ? "Week —" : `Week ${week}`;
  // Only below `lg`, where the breakdown has replaced the list; above it both
  // panes are on screen and there is nothing to go back to.
  const back = open && detail !== null;
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
          only the `‹ List` key takes one back. */}
      <span className="pointer-events-none relative z-[2] flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {back && (
          <button
            type="button"
            onClick={onList}
            className="pointer-events-auto inline-flex shrink-0 items-center rounded-full border border-foreground/10 bg-[image:var(--key-metal)] px-2.5 py-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-foreground/80 shadow-[var(--key-shadow)] lg:hidden"
          >
            ‹ List
          </button>
        )}

        {/* The lamp says the panel is live rather than a static table. It is
            the page's own pulsing lamp (`lab-anim animate-pulse`) rather than a
            second spelling of one — the readout beside the week stepper already
            draws it, and two pulses at two rates on one page read as two
            different claims. */}
        <span
          aria-hidden
          className={`lab-anim size-[0.4375rem] shrink-0 animate-pulse rounded-full bg-[var(--pip-lit-bg)] shadow-[0_0_8px_var(--accent-glow)] ${
            back ? "hidden lg:block" : ""
          }`}
        />

        {/* Below `lg` with a player picked the bar names him; otherwise it is
            the panel's own legend. Two spans switched by the cascade rather
            than by state, so nothing has to hydrate to learn a breakpoint. */}
        {back && (
          <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-14)] font-semibold text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] lg:hidden">
            {detail.name ?? detail.player_id}
          </span>
        )}
        <span
          className={`shrink-0 whitespace-nowrap font-display text-[length:var(--fs-14)] font-semibold uppercase tracking-[0.06em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] sm:text-[length:var(--fs-15)] sm:tracking-[0.08em] ${
            back ? "hidden lg:inline" : ""
          }`}
        >
          Player Scores
        </span>

        {back && (
          <span className={`${CONSOLE_MILLED_WELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] px-[0.4375rem] py-0.5 lg:hidden`}>
            <BayLabel>Pts</BayLabel>
            <span className="font-display text-[length:var(--fs-16)] font-semibold tabular-nums text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]">
              {detail.points.toFixed(1)}
            </span>
          </span>
        )}

        {/* Desktop: the week, the basis and the denominator in words, then a
            groove and the week's best. Phone: one well carrying the week. */}
        <span className="hidden shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:inline">
          {label} · {SCORING_LABEL[basis]}
          {leagues > 0 ? ` · ${leagues} leagues` : ""}
        </span>
        <span
          aria-hidden
          className="hidden h-6 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)] sm:block"
        />

        {!back && (
          <span className={`${CONSOLE_MILLED_WELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] px-[0.4375rem] py-0.5 sm:hidden`}>
            <BayLabel>{week === null ? "Wk —" : `Wk ${week}`}</BayLabel>
          </span>
        )}

        {top && (
          <span className={`${CONSOLE_MILLED_WELL} hidden min-w-0 items-baseline gap-1.5 rounded-[0.4375rem] px-2 py-[0.1875rem] sm:inline-flex`}>
            <BayLabel>Top</BayLabel>
            <span className="min-w-0 truncate font-display text-[length:var(--fs-13)] font-medium text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]">
              {top.name ?? top.player_id}
            </span>
            <span className="shrink-0 font-display text-[length:var(--fs-14)] font-semibold tabular-nums text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]">
              {top.points.toFixed(1)}
            </span>
          </span>
        )}

        <span
          aria-hidden
          className={`ml-auto shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] sm:ml-0 sm:text-[length:var(--fs-10)] sm:tracking-[0.16em] ${
            back ? "hidden lg:inline" : ""
          }`}
        >
          <span className="sm:hidden">{open ? "Close" : "Open"}</span>
          <span className="hidden sm:inline">{open ? "Collapse" : "Expand"}</span>
        </span>
        {/* The caret turns rather than swapping glyph — `DrawerBar`'s own, and
            `aria-hidden` because `aria-expanded` on the button already carries
            the state. It is the one collapse affordance the phone breakdown
            keeps, which is why it is never hidden. */}
        <span
          aria-hidden
          className={`lab-anim w-4 shrink-0 text-right text-[length:var(--fs-13)] text-[color:var(--billet-label)] transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] sm:w-5 sm:text-[length:var(--fs-14)] ${
            back ? "ml-auto lg:ml-0" : ""
          } ${open ? "-rotate-90" : "rotate-90"}`}
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

/* ------------------------------------------------------------------ */

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
 * The rack's own phone caps sit in exactly this situation and this token is the
 * answer that pass arrived at: the same values in dark, and a shadow on stock
 * with a lit lower lip in light.
 */
const CAP_CHANNEL =
  "bg-[color:var(--rack-channel-bg)] shadow-[var(--rack-channel-shadow)]";

/**
 * One cap in one of those channels, lit or not — the rack's own key.
 *
 * **Every cap sets its background explicitly**, lit or not, so the UA's own
 * button fill never shows through; an unlit cap has *no* fill at all and the
 * recessed channel behind it does the grouping. `aria-pressed` carries the
 * state, which is what makes a set of these a multi-select to anything reading
 * the page rather than a row of unlabelled buttons.
 */
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
      className={`touch:min-h-11 rounded-full border bg-transparent px-2 py-[0.3125rem] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.06em] lg:text-[length:var(--fs-10)] ${className} ${
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
 * A multi-select menu: a pill that says what it is narrowed to, and a popover
 * of caps.
 *
 * One component for both axes, because they are the same control over two
 * vocabularies — a second spelling is one menu that stops agreeing with the
 * other about what a second press means, and about what `All` does.
 *
 * **The dismissal is spelled out because this is not a `<dialog>`**, on
 * `ToolsMenu`'s own terms: a filter menu that trapped focus and dimmed the page
 * to offer five caps would be heavier than the caps are worth. So a
 * capture-phase `pointerdown` — a press that starts outside dismisses before
 * whatever it landed on acts on it — and an Escape that **returns focus to the
 * trigger**, which is the one piece of the `<dialog>` behaviour that is not
 * optional. The prototype has neither and the handoff names both as needed in
 * the real build.
 *
 * **It stays open on a press**, deliberately: the whole point of a multi-select
 * is picking more than one, and a menu that shut on the first would make the
 * second press a second opening.
 */
function FilterMenu({
  legend,
  label,
  noun,
  held,
  options,
  onToggle,
  onClear,
  anchor,
  panel,
  columns,
  className = "",
}: {
  /** The stamped word on the pill — `Pos`, `Team`. */
  legend: string;
  /** What the popover's group is called to anything reading the page. */
  label: string;
  /** `3 positions` / `3 teams` — the one thing that differs in the summary. */
  noun: string;
  held: readonly string[];
  options: readonly string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  /** Which edge the popover hangs from, so neither runs off the ledge. */
  anchor: "left" | "right";
  /** Its width, which is a function of how many caps it has to hold. */
  panel: string;
  columns: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary = menuSummary(held, noun);
  return (
    <span ref={root} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((held) => !held)}
        aria-expanded={open}
        className={`${CONSOLE_PANE_TRACK} touch:min-h-11 flex w-full items-center gap-2 py-2 pl-3.5 pr-3`}
      >
        <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--readout-label)]">
          {legend}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-left font-mono text-[length:var(--fs-11)] tracking-[0.06em] lg:text-[length:var(--fs-12)] ${
            held.length > 0
              ? "text-readout [text-shadow:var(--readout-text-glow)]"
              : "text-[color:var(--billet-name)]"
          }`}
        >
          {summary}
        </span>
        <span
          aria-hidden
          className={`lab-anim shrink-0 text-[length:var(--fs-9)] text-[color:var(--readout-label)] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      {open && (
        <span
          className={`absolute top-[calc(100%+0.375rem)] z-20 flex flex-col gap-1.5 overflow-hidden rounded-[0.625rem] bg-[image:var(--billet-bg)] p-2 shadow-[var(--standing-strip-shadow)] ${panel} ${
            anchor === "left" ? "left-0" : "right-0"
          }`}
        >
          <BilletFinish />
          <span className="relative flex items-center gap-2">
            <span className="min-w-0 flex-1 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)]">
              {held.length > 0 ? `${held.length} selected` : `Every ${noun.replace(/s$/, "")}`}
            </span>
            {/* A metal key rather than a cap, because it is not one of the set
                — it is what empties it. The positions menu keeps `All` in the
                grid instead, where five caps read as one ladder. */}
            {options.length > 5 && (
              <button
                type="button"
                onClick={onClear}
                className="touch:min-h-11 shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-metal)] px-2.5 py-1 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/80 shadow-[var(--key-shadow)]"
              >
                All
              </button>
            )}
          </span>
          <span
            role="group"
            aria-label={label}
            className={`${CAP_CHANNEL} relative grid gap-1 rounded-lg p-[0.3125rem] ${columns}`}
          >
            {options.length <= 5 && (
              <Cap lit={held.length === 0} onPress={onClear}>
                All
              </Cap>
            )}
            {options.map((option) => (
              <Cap
                key={option}
                lit={held.includes(option)}
                onPress={() => onToggle(option)}
              >
                {option}
              </Cap>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * The narrowings and the sort, in a hole cut into the case.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. One wrapping row above
 * `lg` and three stacked below, which is the design's own phone arrangement —
 * a search field, two menus and four sort caps are ~700px of content.
 *
 * **There is no Reset key and no `n / m` count**, which is the redesign rather
 * than an omission: each menu clears itself (`All`), the search field is a
 * field, and the rank column's last number is what a narrowed list has left.
 * The board this replaced carried both because it also carried four other
 * narrowings.
 */
function Ledge({
  filters,
  onFilters,
  teams,
  sort,
  onSort,
}: {
  filters: StatBoardFilters;
  onFilters: (filters: StatBoardFilters) => void;
  teams: readonly string[];
  sort: StatSortKey;
  onSort: (key: StatSortKey) => void;
}) {
  return (
    <div className="relative flex shrink-0 flex-col gap-1.5 rounded-xl bg-[color:var(--case-well-bg)] p-1.5 shadow-[var(--case-well-shadow)] lg:flex-row lg:flex-wrap lg:items-center lg:gap-2 lg:p-2">
      <label
        className={`${CONSOLE_PANE_TRACK} relative flex min-w-0 items-center gap-2 px-3.5 lg:order-1 lg:min-w-44 lg:flex-[1_1_7rem]`}
      >
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
          className="touch:min-h-11 w-full min-w-0 border-0 bg-transparent py-2 font-mono text-[length:var(--fs-12)] tracking-[0.04em] text-[color:var(--billet-name)] outline-none placeholder:text-[color:var(--readout-label)]"
        />
      </label>

      {/* Full width below `lg`, where the popover hangs from both edges; a pill
          in the wrapping row above it. */}
      <FilterMenu
        legend="Pos"
        label="Position"
        noun="positions"
        held={filters.positions}
        options={STAT_POSITIONS}
        onToggle={(value) =>
          onFilters({
            ...filters,
            positions: toggleFilterValue(
              filters.positions,
              value as StatBoardPosition,
            ),
          })
        }
        onClear={() => onFilters({ ...filters, positions: [] })}
        anchor="left"
        panel="w-full lg:w-52"
        columns="grid-cols-5"
        className="lg:order-2 lg:w-auto lg:shrink-0"
      />

      <div className="flex items-center gap-1.5 lg:contents">
        {/* The caps are a single-select rail in a deep channel, and the chosen
            one is the rack's own accent cap — one spelling of a lit cap in
            this app. They stretch below `lg`, where the row is theirs, and
            never ellipsise: a sort key a reader cannot read is a list ordered
            by something nothing on screen names. */}
        <span
          role="group"
          aria-label="Sort by"
          className={`${CAP_CHANNEL} flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-[1.25rem] p-1 lg:order-4 lg:flex-none lg:rounded-full`}
        >
          <span
            aria-hidden
            className="hidden shrink-0 px-1 pl-[0.4375rem] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] lg:inline"
          >
            Sort
          </span>
          {STAT_SORTS.map((option) => (
            <Cap
              key={option.key}
              lit={sort === option.key}
              onPress={() => onSort(option.key)}
              className="flex-auto whitespace-nowrap px-2.5 tracking-[0.08em] lg:flex-none lg:tracking-[0.14em]"
            >
              {option.label}
            </Cap>
          ))}
        </span>

        <FilterMenu
          legend="Team"
          label="Teams"
          noun="teams"
          held={filters.teams}
          options={teams}
          onToggle={(value) =>
            onFilters({ ...filters, teams: toggleFilterValue(filters.teams, value) })
          }
          onClear={() => onFilters({ ...filters, teams: [] })}
          anchor="right"
          panel="w-64 lg:w-68"
          columns="grid-cols-4 lg:grid-cols-5"
          className="shrink-0 lg:order-3"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The list's four tracks — Player, Game, Your leagues, Pts.
 *
 * **Two whole class strings rather than a base plus an override**, and the
 * `xl:` one is what the design draws: its 1120px artboard leaves the left
 * column ~730px, which the wide template's 636px floor fits with room. At `lg`
 * the case is ~992px and that column is ~570, so the wide floor would overflow
 * it — a grid whose tracks do not fit is not a narrower grid, it is a row
 * sticking out of the pane that clips it, silently. The compact template is the
 * same four columns at their own floors.
 *
 * **And the two share their slack differently**, which is a measurement rather
 * than a symmetry. At `lg` the free space is ~230px, and a reader's three tags
 * (`Started 7 · Sat 1 · Against 3`) need 236 of the `Your leagues` track — so
 * on the design's own `0.9fr` that cell came out 223 and clipped all three,
 * silently, inside its own `overflow-hidden`. The compact arm gives the
 * narrower column the larger share (`1.15fr` against `0.85fr`), which lands
 * them at ~260 and ~242; the name has `truncate` and degrades honestly where
 * the tags had no way to. At `xl` there is room for the design's own split.
 *
 * Safe as two utilities because one carries a variant: Tailwind emits the
 * responsive layer after the base one, so the cascade decides rather than the
 * emit order. It is the trap `CONSOLE_CARD_SHELL` records, and the one case
 * that is not it.
 */
const STAT_GRID =
  "grid-cols-[minmax(9rem,0.85fr)_4.25rem_minmax(8rem,1.15fr)_4.5rem] " +
  "xl:grid-cols-[minmax(15rem,1fr)_5.5rem_minmax(14rem,0.9fr)_5.25rem]";

/**
 * The scoring list: lit glass holding milled rows, in two arrangements.
 *
 * **No horizontal scroll**, which is the central change from the board this
 * replaces: four columns fit every width the app is drawn at, so a reader
 * never travels past three answers to read one.
 *
 * **Two arms rather than one.** Below `lg` the columns become the app's own
 * two-line row grammar (`PaneWeekRow` and `DrawerRow` both already turn this
 * way), with the three counts folded into one short line. They are two
 * components gated by the cascade rather than one with `lg:contents`, because
 * what differs is the *content* and not only its layout — three cells become
 * one string. Both gates are `display: none`, which takes one out of the
 * accessibility tree, so exactly one is ever read: `WeekStepper`'s own
 * precedent and its two conditions.
 */
function List({
  rows,
  population,
  sort,
  picked,
  onPick,
  narrowed,
}: {
  rows: readonly RankedStatRow[];
  population: readonly number[];
  sort: StatSortKey;
  picked: string | null;
  onPick: (id: string) => void;
  narrowed: boolean;
}) {
  return (
    <div className={`${CONSOLE_GLASS} flex min-h-0 flex-1 flex-col rounded-xl`}>
      <Scanlines />
      <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-[3px]">
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
            {narrowed ? "No player matches that narrowing." : "No scoring lines this week yet."}
          </p>
        ) : (
          <>
            <div role="table" aria-label="Player scores" className="hidden lg:block">
              <Head sort={sort} />
              {rows.map((row) => (
                <WideRow
                  key={row.player_id}
                  row={row}
                  population={population}
                  sort={sort}
                  lit={picked === row.player_id}
                  onPick={onPick}
                />
              ))}
            </div>
            <ul className="m-0 list-none p-0 lg:hidden">
              {rows.map((row) => (
                <PhoneRow
                  key={row.player_id}
                  row={row}
                  population={population}
                  lit={picked === row.player_id}
                  onPick={onPick}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The head, and the one thing it says beyond naming its columns.
 *
 * **The sorted column is lit, and it is one of two.** `Pts` carries the arrow
 * and the accent while the list is ordered by points; on any of the other
 * three the arrow clears, `Pts` drops to the label ink and `Your leagues`
 * takes the accent instead — because all three of those orderings are readings
 * of that cell, and the lit tag inside each row says which.
 *
 * Not pressable, which is the design's own call: sorting lives in the ledge's
 * four caps, and a head that set the same key would be a second control for one
 * fact with no way to show the direction the caps cannot express.
 */
function Head({ sort }: { sort: StatSortKey }) {
  const points = sort === "points";
  const ink = (lit: boolean) =>
    lit ? "text-[color:var(--billet-accent)]" : "text-[color:var(--billet-label)]";
  return (
    <div
      role="row"
      className={`${CONSOLE_WINDOW_LEDGE} sticky top-0 z-[3] mb-[5px] grid rounded-[7px] ${STAT_GRID}`}
    >
      <span role="columnheader" className={`${HEAD_CELL} px-2.5 ${ink(false)}`}>
        Player
      </span>
      <span role="columnheader" className={`${HEAD_CELL} justify-end pr-2.5 ${ink(false)}`}>
        Game
      </span>
      <span role="columnheader" className={`${HEAD_CELL} px-2.5 ${ink(!points)}`}>
        Your leagues
      </span>
      <span
        role="columnheader"
        aria-sort={points ? "descending" : undefined}
        className={`${HEAD_CELL} justify-end gap-1 pr-3 ${ink(points)}`}
      >
        Pts
        <span aria-hidden className="text-[length:var(--fs-9)]">
          {points ? "▼" : ""}
        </span>
      </span>
    </div>
  );
}

const HEAD_CELL =
  "flex h-8 items-center font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em]";

/**
 * One row of the wide list.
 *
 * The whole row is the button and the cells are its children, which is what
 * makes the press target the row rather than the name — a reader aiming at a
 * four-hundred-row list should not have to hit a word. The well around it is a
 * plain box, because a channel and its own press are two things and a
 * `<button>` cannot carry the row's `margin-bottom` without the gap becoming
 * part of the target.
 */
function WideRow({
  row,
  population,
  sort,
  lit,
  onPick,
}: {
  row: RankedStatRow;
  population: readonly number[];
  sort: StatSortKey;
  lit: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div
      className={`${CONSOLE_ROW_WELL} mb-[3px] rounded-[7px] ${
        lit ? "shadow-[var(--row-well-shadow),0_0_24px_-10px_var(--accent-glow)]" : ""
      }`}
    >
      <button
        type="button"
        role="row"
        /* **`aria-current`, not `aria-pressed`.** A `row` does not support the
           second (the lint rule is right), and the first is the honest one
           anyway: the rows are a single-selection set with no deselect, so the
           picked one is *the current item* rather than a toggle somebody left
           down. The phone arm says it the same way for the same reason. */
        aria-current={lit ? "true" : undefined}
        onClick={() => onPick(row.player_id)}
        className={`grid w-full cursor-pointer grid-rows-[2.375rem] items-center rounded-[7px] border-0 bg-transparent p-0 text-left ${STAT_GRID}`}
      >
        <span role="cell" className="flex min-w-0 items-center gap-2 px-2.5">
          <span
            aria-hidden
            className="inline-flex w-6 shrink-0 justify-end font-mono text-[length:var(--fs-10)] text-[color:var(--readout-label)]"
          >
            {row.rank}
          </span>
          <span
            className={`min-w-0 truncate font-display text-[length:var(--fs-13)] font-medium ${
              lit
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-[color:var(--readout-line)]"
            }`}
          >
            {row.name ?? row.player_id}
          </span>
          <span className={`shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.08em] ${POSITION_INK(row)}`}>
            {row.position}
          </span>
          {/* **The matchup waits for `xl`**, which is a width rather than the
              design's own call: at 1120 — its artboard — the Player cell is
              304px and both fit, and at `lg` it is 242, where the name would be
              left ~99px, about fourteen characters, on the one column whose
              whole job is naming a player. So between 1024 and 1280 the row
              keeps the name whole and gives up the NFL matchup, which the
              breakdown's own meta line still states in full. */}
          <span className="hidden shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.04em] text-[color:var(--readout-muted)] xl:inline">
            {matchup(row)}
          </span>
        </span>
        <span role="cell" className={`flex items-center justify-end pr-2.5 ${CLOCK} ${clockInk(row)}`}>
          {row.clock.text}
        </span>
        <span role="cell" className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2.5">
          {row.held ? (
            statTags(row).map((tag) => <Tag key={tag.key} tag={tag} sort={sort} />)
          ) : (
            <span className="truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
              Nobody in your leagues
            </span>
          )}
        </span>
        <span role="cell" className="flex items-center justify-end pr-2">
          <PointsFigure points={row.points} population={population} />
        </span>
      </button>
    </div>
  );
}

/**
 * One of the three counts, in a figure well.
 *
 * **The well lights when the list is ordered by that reading**, which is the
 * one thing that makes a sort visible in every row rather than only on the cap
 * that set it — a reader scanning a hundred rows sees which column they are
 * travelling down. `--tag-lit-shadow` is `--figure-well-shadow` plus an accent
 * ring and glow, composed in CSS rather than appended here: a shadow list is
 * atomic, so a second `shadow-[…]` would replace the chamfer rather than add to
 * it. Hence the shell, which carries no shadow of its own.
 *
 * The three inks are the three readings' own: the reader's starters are the
 * accent, their bench is the amber this app spends on "neither", and the
 * opposing pair is the quiet line ink — the same vocabulary the breakdown's
 * five group headers use one pane over.
 */
function Tag({ tag, sort }: { tag: StatTag; sort: StatSortKey }) {
  const lit = sort === tag.key;
  const ink = TAG_INK[tag.key];
  return (
    <span
      className={`${CONSOLE_FIGURE_WELL_SHELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] px-[0.4375rem] py-px ${
        lit ? "shadow-[var(--tag-lit-shadow)]" : "shadow-[var(--figure-well-shadow)]"
      }`}
    >
      <span className={`font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] ${ink.label}`}>
        {tag.label}
      </span>
      <span className={`font-mono text-[length:var(--fs-11)] tabular-nums ${ink.figure}`}>
        {tag.count}
      </span>
    </span>
  );
}

/**
 * A record over every sort key, of which `points` is the one no tag can carry
 * — `statTags` never emits one, because the points figure has a column of its
 * own. It is exhaustive rather than partial so a fifth reading breaks the
 * compile here rather than rendering an unstyled tag.
 */
const TAG_INK: Record<StatSortKey, { label: string; figure: string }> = {
  points: { label: "", figure: "" },
  start: {
    label: "text-[color:var(--billet-accent)]",
    figure: "text-readout [text-shadow:var(--readout-text-glow)]",
  },
  bench: {
    label: "text-[color:var(--median-ink)]",
    figure: "text-[color:var(--median-ink)]",
  },
  against: {
    label: "text-[color:var(--readout-muted)]",
    figure: "text-[color:var(--readout-line)]",
  },
};

/**
 * The clock, in the two inks a game has.
 *
 * A finished game takes `--stat-zero-ink`, which is **deliberately below the
 * 4.5:1 text floor** and is this board's own treatment carried over rather than
 * a slip: what a reader is scanning a column of clocks for is the games still
 * running, and a final score that read as loudly as a live one would bury them.
 */
const CLOCK =
  "font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em]";

const clockInk = (row: StatRow) =>
  row.clock.live
    ? "text-readout [text-shadow:var(--readout-text-glow)]"
    : "text-[color:var(--stat-zero-ink)]";

/** The quarterback is the accent, which is what the position column is for. */
const POSITION_INK = (row: { position: string }) =>
  row.position === "QB"
    ? "text-[color:var(--billet-accent)]"
    : "text-[color:var(--readout-label)]";

/** `CIN @BAL`, or the team alone on a bye. */
const matchup = (row: StatRow) =>
  [row.team, row.opponent].filter(Boolean).join(" ");

/**
 * The points figure, coloured by where it stands in the week.
 *
 * The shared ramp rather than a second red and a second green — `rankColor`
 * over `sharePercentile`, which is anchored on the *mean* rather than on a
 * rank, so a tight week lands everybody near the neutral and only a real outlier
 * takes a colour. Both are fed the same percentile, which is the whole reason
 * they live in one module.
 */
function PointsFigure({
  points,
  population,
}: {
  points: number;
  population: readonly number[];
}) {
  const percentile = sharePercentile(points, population);
  return (
    <span
      className={`${CONSOLE_FIGURE_WELL} inline-flex min-w-14 justify-end px-[7px] py-0.5 font-display text-[length:var(--fs-14)] font-semibold tabular-nums lg:text-[length:var(--fs-15)]`}
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
 * One row of the phone list: two lines, the second indented under the name.
 *
 * The three counts are one short string here (`6 st · 2 sat · 4 vs`) rather
 * than three wells, and it is a width: the line they share already carries a
 * position, a matchup and a clock. A reader who wants the three apart presses
 * the row, which is where the breakdown names every league one at a time.
 */
function PhoneRow({
  row,
  population,
  lit,
  onPick,
}: {
  row: RankedStatRow;
  population: readonly number[];
  lit: boolean;
  onPick: (id: string) => void;
}) {
  const tags = statTagLine(row);
  return (
    <li
      className={`${CONSOLE_ROW_WELL} mb-[3px] rounded-[7px] ${
        lit ? "shadow-[var(--row-well-shadow),0_0_24px_-10px_var(--accent-glow)]" : ""
      }`}
    >
      <button
        type="button"
        aria-current={lit ? "true" : undefined}
        onClick={() => onPick(row.player_id)}
        className="flex min-h-11 w-full cursor-pointer flex-col gap-0.5 rounded-[7px] border-0 bg-transparent px-2 py-[0.3125rem] text-left"
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="inline-flex w-5 shrink-0 justify-end font-mono text-[length:var(--fs-9)] text-[color:var(--readout-label)]"
          >
            {row.rank}
          </span>
          <span
            className={`min-w-0 flex-1 truncate font-display text-[length:var(--fs-13)] font-medium ${
              lit
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-[color:var(--readout-line)]"
            }`}
          >
            {row.name ?? row.player_id}
          </span>
          <PointsFigure points={row.points} population={population} />
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-[1.625rem]">
          <span className={`shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.06em] ${POSITION_INK(row)}`}>
            {row.position}
          </span>
          <span className="shrink-0 font-mono text-[length:var(--fs-9)] text-[color:var(--readout-muted)]">
            {matchup(row)}
          </span>
          <span className={`shrink-0 ${CLOCK} ${clockInk(row)}`}>{row.clock.text}</span>
          <span className="ml-auto min-w-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.08em] text-[color:var(--readout-label)]">
            {row.held ? tags : "Not in your leagues"}
          </span>
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */

/**
 * What each of the five groups is called, and how it is drawn.
 *
 * **The swatch is the group's own voice and the ink is its label's**, and the
 * pairs are the app's existing vocabulary rather than five colours invented
 * here: the reader's starters are `--lit-bar-bg`, which is the bar this console
 * already draws for "yours"; their bench is the amber `--median-ink` spends on
 * "neither"; the two opposing groups are the rival's own ghost, loud for a
 * lineup and faint for a bench; and the leagues he is in neither side of have
 * no voice at all, which is what `transparent` says.
 *
 * **Every one is a token, where the design spells four of them as literals**,
 * and that is this file's standing rule rather than a preference: the bundle
 * is dark-only and its `rgba(214,255,250,0.14)` ghost and `rgba(255,212,135,
 * 0.85)` amber are near-white and dark-amber *on a near-black window*. Carried
 * across, the first is invisible on the pale one — rendered in light, that
 * group's swatch simply was not there — and the second is the dark scheme's
 * amber rather than the one the rest of the light page uses. `--readout-line`
 * is the ghost's own ink and inverts (a near-white alpha in dark, `#123c39` in
 * light), so a `color-mix` of it reads as a ghost on both; `--median-ink` and
 * `--accent` invert for the other two. An `rgba()` in a class string cannot.
 */
const GROUP: Record<
  BreakdownGroupKey,
  { title: string; swatch: string; ring: string; ink: string; slot: string }
> = {
  start: {
    title: "You started him",
    swatch: "var(--lit-bar-bg)",
    ring: "color-mix(in srgb, var(--accent) 55%, transparent)",
    ink: "text-[color:var(--billet-accent)]",
    slot: "text-readout",
  },
  bench: {
    title: "You sat him",
    swatch: "var(--median-ink)",
    ring: "color-mix(in srgb, var(--median-ink) 55%, transparent)",
    ink: "text-[color:var(--median-ink)]",
    slot: "text-[color:var(--median-ink)]",
  },
  "opp-start": {
    title: "Against you — they started him",
    swatch: "var(--rival-bar-bg)",
    ring: "color-mix(in srgb, var(--readout-line) 45%, transparent)",
    ink: "text-[color:var(--billet-scope)]",
    slot: "text-[color:var(--readout-line)]",
  },
  "opp-bench": {
    title: "Against you — they sat him",
    swatch: "color-mix(in srgb, var(--readout-line) 22%, transparent)",
    ring: "color-mix(in srgb, var(--readout-line) 34%, transparent)",
    ink: "text-[color:var(--billet-scope)]",
    slot: "text-[color:var(--readout-muted)]",
  },
  none: {
    title: "Not in this league",
    swatch: "transparent",
    ring: "color-mix(in srgb, var(--readout-label) 22%, transparent)",
    ink: "text-[color:var(--readout-label)]",
    slot: "text-[color:var(--stat-zero-ink)]",
  },
};

/** How a league row says who is across from the reader, per group. */
function against(key: BreakdownGroupKey, rival: string | null): string {
  if (!rival) return "";
  // The two opposing groups name what that manager *did*; the reader's own
  // two, and the leagues with nothing to say, name who they are playing.
  if (key === "opp-start") return `${rival} started him`;
  if (key === "opp-bench") return `${rival} sat him`;
  return `vs ${rival}`;
}

/**
 * The breakdown: the reader's leagues, grouped by what each did with him.
 *
 * **This is the half the counts could not give.** A row saying `Started 7`
 * answers how many; this answers *which*, and adds the two things a count
 * cannot carry — the slot he sat in, and the manager across from the reader in
 * that league. It is why the pane is worth 392px of a 1120px drawer.
 *
 * At rest it prompts rather than seeding itself with the week's top scorer: a
 * pane that opened already answering would be claiming a reader had asked about
 * somebody.
 */
function Breakdown({
  className,
  row,
  groups,
  leagues,
}: {
  className: string;
  row: RankedStatRow | null;
  groups: readonly { key: BreakdownGroupKey; rows: BreakdownRow[] }[];
  leagues: number;
}) {
  return (
    <div
      className={`${CONSOLE_GLASS} ${className} min-h-0 w-full shrink-0 flex-col rounded-xl lg:w-80 xl:w-[24.5rem]`}
    >
      <Scanlines />
      {row === null ? (
        <p className="relative z-[1] m-0 px-4 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
          Press a player to see where you stand on him.
        </p>
      ) : (
        <>
          {/* The header billet is hidden on the phone, where the bar above
              already carries the name and the figure — see `Bar`. Its meta line
              comes down here instead so nothing is lost. */}
          <div
            className={`relative z-[1] mx-1.5 mt-1.5 hidden shrink-0 overflow-hidden rounded-[7px] bg-[image:var(--billet-bg)] px-2.5 py-2 shadow-[var(--standing-strip-shadow)] lg:block`}
          >
            <BilletFinish />
            <div className="relative flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-17)] font-semibold text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
                {row.name ?? row.player_id}
              </span>
              <span className={`${CONSOLE_MILLED_WELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] px-[0.4375rem] py-px`}>
                <BayLabel>Pts</BayLabel>
                <span className="font-display text-[length:var(--fs-18)] font-semibold tabular-nums text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]">
                  {row.points.toFixed(1)}
                </span>
              </span>
            </div>
            <p className={`relative m-0 mt-[0.3125rem] ${META} text-[color:var(--billet-label)]`}>
              {meta(row)}
            </p>
            <p className={`relative m-0 mt-[0.1875rem] ${META} text-[color:var(--billet-scope)]`}>
              {standing(row, leagues)}
            </p>
          </div>

          {/* The phone's own header: one line, on the glass under the bar. */}
          <div className="relative z-[1] shrink-0 border-b border-black/45 px-2.5 py-2 lg:hidden">
            <p className={`m-0 ${META} text-[color:var(--readout-label)]`}>
              {meta(row)} · {standing(row, leagues)}
            </p>
          </div>

          <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5">
            {groups.length === 0 ? (
              <p className="m-0 px-2 py-4 text-center font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
                No leagues read yet.
              </p>
            ) : (
              groups.map((group) => <Group key={group.key} group={group} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}

const META = "font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em]";

/** `WR · CIN @BAL · Q3 11:02`, with the clauses it has. */
function meta(row: StatRow): string {
  return [row.position, matchup(row), row.clock.text].filter(Boolean).join(" · ");
}

/**
 * The sub-line: how the reader's week treated him, in one sentence.
 *
 * A player nobody has says so in words rather than printing three noughts,
 * which is the same distinction the row's own cell draws — `held` decides it,
 * never the counts, because a held player nobody seated is a different fact
 * from one their leagues have never heard of.
 */
function standing(row: StatRow, leagues: number): string {
  if (!row.held) {
    return leagues > 0
      ? `Nobody in your ${leagues} leagues has him`
      : "Nobody in your leagues has him";
  }
  return `Started ${row.start ?? 0} · sat ${row.bench ?? 0} · against you ${row.against ?? 0}`;
}

/** One group: a stamped header over its leagues. */
function Group({ group }: { group: { key: BreakdownGroupKey; rows: BreakdownRow[] } }) {
  const style = GROUP[group.key];
  return (
    <div className="mb-2">
      <div
        className={`${CONSOLE_WINDOW_LEDGE} mb-1 flex items-center gap-2 rounded-[5px] px-2 py-1`}
      >
        <span
          aria-hidden
          className="block h-[0.8125rem] w-[0.3125rem] shrink-0 rounded-sm border"
          style={{ background: style.swatch, borderColor: style.ring }}
        />
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] [text-shadow:var(--standing-label-shadow)] ${style.ink}`}
        >
          {style.title}
        </span>
        <span className="shrink-0 font-display text-[length:var(--fs-13)] font-semibold tabular-nums text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]">
          {group.rows.length}
        </span>
      </div>
      {group.rows.map((row) => (
        <div
          key={row.league_id}
          className={`${CONSOLE_ROW_WELL} mb-[3px] flex min-h-11 items-center gap-2 rounded-[5px] px-2 py-[0.3125rem] lg:min-h-0`}
        >
          {/* Two lines below `lg` and one above, which is the app's own row
              grammar at its own breakpoint: a 390px pane cannot hold a league
              name, an opponent clause and a slot chip on one line. */}
          <span className="flex min-w-0 flex-1 flex-col gap-px lg:flex-row lg:items-center lg:gap-2">
            <span className="min-w-0 truncate font-mono text-[length:var(--fs-11)] tracking-[0.02em] text-[color:var(--readout-line)] lg:flex-1">
              {row.league}
            </span>
            <span className="min-w-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-[color:var(--readout-label)] lg:shrink-0">
              {against(group.key, row.rival)}
            </span>
          </span>
          <span
            className={`${CONSOLE_FIGURE_WELL} inline-flex min-w-9 shrink-0 justify-center px-[0.3125rem] py-px font-mono text-[length:var(--fs-10)] tracking-[0.06em] ${style.slot}`}
          >
            {row.slot ?? EM_DASH}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Absent is a dash **here**, where the helper's own answer is null. */
const EM_DASH = "—";
