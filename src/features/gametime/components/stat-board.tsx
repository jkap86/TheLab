"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BilletFinish,
  CONSOLE_CHANNEL_METAL,
  CONSOLE_FIGURE_WELL,
  CONSOLE_FIGURE_WELL_SHELL,
  CONSOLE_GLASS,
  CONSOLE_MILLED_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
  CONSOLE_WINDOW_LEDGE,
  DetailLedge,
  ModeTrack,
  rankColor,
  Scanlines,
  sharePercentile,
  storeStatBoardOpen,
  useStatBoardOpen,
  type WeekTwoSidedShares,
} from "@/features/shared";
import type {
  GametimeGame,
  GametimeStatLine,
  StatBoardPosition,
} from "@/shared/contract";

import {
  menuSummary,
  narrowStatRows,
  NO_SHARES,
  NO_STAT_FILTERS,
  playerLeagueScope,
  PLAYER_READINGS,
  rankStatRows,
  READING_LABEL,
  readingCount,
  SCORING_LABEL,
  STAT_FIXED,
  STAT_POSITIONS,
  STAT_SORTS,
  ALL_SPLITS,
  STAT_SPLITS,
  statColumns,
  statFamilies,
  statGroupSpans,
  statRows,
  statScoring,
  statTagLine,
  statTags,
  statTeams,
  statTrackWidth,
  toggleFilterValue,
  toggleSplit,
  topStatRow,
  USAGE_KEYS,
  USAGE_LABEL,
  usageLeagueScope,
} from "../helpers/stat-board";
import type {
  PlayerReading,
  RankedStatRow,
  StatBasis,
  StatBoardFilters,
  StatColumn,
  StatFamily,
  StatLineRow,
  StatRow,
  StatShareCounts,
  StatSortKey,
  StatSplitKey,
  StatTag,
  UsageKey,
} from "../helpers/stat-board";

/**
 * **Player Scores**: who is scoring what, where the reader stands on him, and
 * which of their leagues to look at because of it.
 *
 * **The box score is back and it is pinned.** This note used to say the
 * opposite — that the splits came off because nineteen columns could not be
 * read without travelling past four answers to reach one. That was true of
 * nineteen and of a table with nothing held still: what returns is thirteen,
 * with **Player pinned to the left edge and Pts to the right**, so the column
 * that names a row and the figure a reader is scanning for are both on screen
 * for the whole of the journey between them. The middle is the only thing that
 * moves, and the `Splits` rail decides how much of it there is.
 *
 * **A press picks, and picking narrows.** This note also used to say that the
 * panel no longer edited the league grid behind it, which was the honest
 * reading of the board that had no controls for it. It has two now, and they
 * are two scopes rather than one control in two places:
 *
 * - **The ledge's four caps are the page's**, ANDed, and they narrow the grid
 *   to the leagues where the players *on this board* got those readings —
 *   which is why they sit beside the search field and the two menus rather
 *   than up in the page header with the league filters. Narrowing the board is
 *   what gives them something to say; see `usageLeagueScope`.
 * - **The pane's four keys are one player's**, single-select, because his four
 *   readings partition his leagues and an intersection of two of them is empty
 *   by construction. `Subject.readings` unions for that same reason; this
 *   refuses to offer the choice at all.
 *
 * The state for the first lives in `gametime-home.tsx` — the grid reads it, so
 * it cannot live here — and this publishes the league set the two scopes leave.
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

/** Nothing folded yet — one identity, so a memo and an effect see one object. */
const NO_LEAGUES: Readonly<
  Record<string, Readonly<Record<UsageKey, readonly string[]>>>
> = {};

export function StatBoard({
  week,
  lines,
  board,
  basis = "ppr",
  chromeClass = "",
  shares = null,
  usage,
  onUsage,
  onScope,
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
   *
   * **It is folded over the league-filtered entries and never the
   * usage-narrowed ones**, which is what keeps this loop-free: the board
   * describes one fixed population and the caps say which leagues it leaves,
   * so a cap pressed here cannot come back as a different count on the row
   * that set it.
   */
  shares?: WeekTwoSidedShares | null;
  /**
   * The page-scope readings, and the page's own setter.
   *
   * **State up there rather than here**, on the one thing that decides it: the
   * league grid reads this narrowing, and the header states it beside the
   * league filters' own summary. The board owns the *derivation* — see
   * `onScope` — because the population it is asked over is the board's own
   * narrowed rows.
   */
  usage: readonly UsageKey[];
  onUsage: (usage: readonly UsageKey[]) => void;
  /**
   * The leagues the two narrowings leave, or null for "not narrowing".
   *
   * Null is a third state and not an empty set: nothing is pressed, so every
   * league stands. An empty set is a narrowing that left nothing, and the grid
   * is right to be empty under it.
   *
   * **Published rather than computed up there** because both halves of it are
   * the board's: the page scope is asked over the rows this component narrowed
   * and the player scope is the row a reader picked in it.
   */
  onScope: (leagues: ReadonlySet<string> | null) => void;
}) {
  const open = useStatBoardOpen();
  /**
   * The board's own three narrowings.
   *
   * `usage` is deliberately **not** in here even though the pure helper reads
   * it off one object: these three are a way of reading this list and that one
   * is a question about the reader's leagues, which is why it lives a
   * component up. The two are composed into one `StatBoardFilters` below, so
   * `narrowStatRows` still sees the single AND it is written as.
   */
  const [filters, setFilters] = useState<Omit<StatBoardFilters, "usage">>(
    NO_STAT_FILTERS,
  );
  /**
   * Which split families the table carries — **the ones it shows, and it
   * starts full**.
   *
   * The one multi-select on this ledge that is not "empty means not asked",
   * and `toggleSplit` carries why: read that way, a press on one of three lit
   * caps holds only that one, which is the reverse of the gesture a reader
   * made. It never empties, so the board always has splits in it.
   *
   * Board-local, because it decides how wide the row's own track is and
   * nothing outside this panel can see one.
   */
  const [splits, setSplits] = useState<readonly StatSplitKey[]>(ALL_SPLITS);
  const [sort, setSort] = useState<StatSortKey>("points");
  /**
   * The player whose line is open.
   *
   * A way of reading this list rather than a preference, so it is not
   * persisted — the call `sort` and the filters already make. Null is the
   * resting state, where the pane prompts rather than seeding itself with the
   * week's top scorer: a pane that opened already answering would be claiming
   * a reader had asked about somebody.
   */
  const [picked, setPicked] = useState<string | null>(null);
  /**
   * Which of his readings the pane is on, and whether the grid is narrowed to
   * it — **two states, the manager console's own split**: the track says what
   * a reader is looking at and the `Narrow grid` key says whether the page
   * behind is filtered to it, so a reader can move between readings without
   * the grid jumping and put one on the grid with one deliberate press.
   *
   * Both reset with `picked`, and that is a correctness rule rather than
   * tidiness: a reading is a fact about *that* player, so carrying a narrowing
   * onto the next one would filter the grid by a question nobody asked about
   * him. The reset happens where the pick is set, so there is no effect to run
   * late.
   */
  const [reading, setReading] = useState<PlayerReading>("all");
  const [gridNarrowed, setGridNarrowed] = useState(false);

  const pick = useCallback((id: string) => {
    setPicked((held) => (held === id ? held : id));
    setReading("all");
    setGridNarrowed(false);
  }, []);
  const toggleGridNarrowed = useCallback(() => setGridNarrowed((v) => !v), []);

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

  /**
   * The leagues behind each of a player's four counts, as ids.
   *
   * Ids rather than the fold's own `ManagerLeague`s, for the reason the counts
   * are a structural four: what the narrowing needs is a set to intersect, and
   * carrying the rows would put `features/shared`'s types into a pure helper's
   * signature.
   */
  const leaguesById = useMemo(() => {
    if (!shares) return NO_LEAGUES;
    const byId: Record<string, Record<UsageKey, readonly string[]>> = {};
    for (const player of shares.players) {
      byId[player.player_id] = {
        start: player.leagues.start.map((l) => l.league_id),
        bench: player.leagues.bench.map((l) => l.league_id),
        "opp-start": player.leagues["opp-start"].map((l) => l.league_id),
        "opp-bench": player.leagues["opp-bench"].map((l) => l.league_id),
      };
    }
    return byId;
  }, [shares]);

  // **The whole population**, priced once. The ramp below is anchored on its
  // mean and the bar's readout counts over it, so it is deliberately the list
  // *before* any narrowing.
  const all = useMemo(
    () => statRows(lines, board, basis, counts),
    [lines, board, basis, counts],
  );
  const narrowing = useMemo<StatBoardFilters>(
    () => ({ ...filters, usage }),
    [filters, usage],
  );
  const shown = useMemo(() => narrowStatRows(all, narrowing), [all, narrowing]);
  const columns = useMemo(() => statColumns(splits), [splits]);
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
   * The two scopes, intersected — what the page narrows its grid by.
   *
   * **An intersection rather than a union**, because they are two independent
   * questions a reader may be asking at once: the caps say which leagues this
   * board's players were used in, and the pane says which of one player's. A
   * reader holding both means both, which is the composition the league
   * filters beside them already use.
   */
  const leagueScope = useMemo(() => {
    /**
     * **A fold that has not arrived narrows nothing**, which is
     * `matchesSubjects`' own third state and not an empty one: with no maps
     * every reading answers for no league, so an intersection of them would
     * empty the reader's grid for a question whose evidence is still in
     * flight. The page keeps the fold alive for as long as a cap is held —
     * see `browsed` — so this is the beat before the first one lands rather
     * than a state a narrowing can rest in.
     */
    if (!shares) return null;
    const page = usageLeagueScope(shown, usage, leaguesById);
    const player = gridNarrowed
      ? playerLeagueScope(reading, picked ? (leaguesById[picked] ?? null) : null)
      : null;
    if (page === null) return player;
    if (player === null) return page;
    return new Set([...page].filter((id) => player.has(id)));
  }, [shares, shown, usage, leaguesById, gridNarrowed, reading, picked]);

  /**
   * Published in an effect rather than during render, which is the one thing
   * about this seam that has to be right: it sets an ancestor's state, and a
   * write during render is the loop `usePublishRackControls` documents at
   * length. The page bails out of an equal set, so a filter keystroke that
   * leaves the same leagues costs no render up there.
   */
  useEffect(() => {
    onScope(leagueScope);
  }, [leagueScope, onScope]);
  /** And it lets go when the panel does — a shut board narrows nothing. */
  useEffect(() => () => onScope(null), [onScope]);

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
            {/* **Below `lg` the pane replaces the list**, which is the design's
                own phone arrangement: one pane at a time, and the bar's
                `‹ List` key is the way back. `display: none` on the hidden
                arm, so exactly one is ever in the accessibility tree. */}
            <div
              className={`min-w-0 flex-1 flex-col gap-2 sm:gap-2.5 ${
                detail ? "hidden lg:flex" : "flex"
              }`}
            >
              <Ledge
                filters={filters}
                onFilters={setFilters}
                teams={teams}
                splits={splits}
                onSplits={setSplits}
                usage={usage}
                onUsage={onUsage}
                sort={sort}
                onSort={setSort}
              />
              <List
                rows={rows}
                columns={columns}
                population={population}
                sort={sort}
                basis={basis}
                picked={picked}
                onPick={pick}
                narrowed={rows.length !== all.length}
              />
            </div>
            {/* The right pane stands *beside* the list where there is room and
                *in front of* it where there is not, and at rest above `lg` it
                prompts rather than seeding itself with a player. */}
            <Detail
              className={detail ? "flex" : "hidden lg:flex"}
              row={detail}
              basis={basis}
              leagues={leagues}
              reading={reading}
              onReading={setReading}
              narrowing={gridNarrowed}
              onNarrow={toggleGridNarrowed}
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
            different claims.

            **The `image:` hint is not optional here.** `--pip-lit-bg` is a
            *gradient*, and an arbitrary background with a bare `var()` and no
            hint compiles to `background-color` — an invalid declaration,
            dropped, leaving a transparent disc with a glow around nothing. This
            was written without the hint and was exactly that;
            `league-config-window.tsx` has always carried it, and the shares
            console reads it the same way now. */}
        <span
          aria-hidden
          className={`lab-anim size-[0.4375rem] shrink-0 animate-pulse rounded-full bg-[image:var(--pip-lit-bg)] shadow-[0_0_8px_var(--accent-glow)] ${
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
  disabled = false,
  onPress,
  children,
  className = "",
}: {
  lit: boolean;
  /**
   * A bound the reader cannot press past — **`aria-disabled`, not the
   * attribute**.
   *
   * A `disabled` button is removed from the tab order, and this one toggles
   * under a reader's own focus: the cap that is *last lit* changes as they
   * press its neighbours, so the real attribute would drop a keyboard reader
   * to `<body>` mid-rail. It is `LeagueSyncKey`'s own finding, on a control
   * that moves for the same kind of reason.
   */
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={lit}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onPress();
      }}
      className={`touch:min-h-11 rounded-full border bg-transparent px-2 py-[0.3125rem] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.06em] lg:text-[length:var(--fs-10)] ${
        disabled ? "cursor-default" : ""
      } ${className} ${
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
            className={`${CONSOLE_CHANNEL_METAL} relative grid gap-1 rounded-lg p-[0.3125rem] ${columns}`}
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
 * A rail of caps under a stamped legend, in a channel cut into the case.
 *
 * One component for all three rails, because they are one control over three
 * vocabularies — `Splits` is a set of column groups, `Leagues where` a set of
 * readings and `Sort` a single key, and every one of them is a row of caps
 * that says what it is for. Three spellings would be three chances for one of
 * them to stop travelling, which is what `SwitchTrack` is one panel over.
 *
 * **`CONSOLE_CHANNEL_METAL`, never `CONSOLE_CHANNEL`** — the constant's own
 * note carries the argument: the channel is cut into the board's case, which
 * is near-white in light mode, and 52% black on it is a hole punched through
 * the part rather than a groove milled into it.
 */
function CapRail({
  legend,
  label,
  children,
  className = "",
  legendClassName = "",
}: {
  legend: string;
  label: string;
  children: React.ReactNode;
  className?: string;
  legendClassName?: string;
}) {
  return (
    <span
      role="group"
      aria-label={label}
      className={`${CONSOLE_CHANNEL_METAL} flex min-w-0 items-center gap-1 p-1 ${className}`}
    >
      <span
        aria-hidden
        className={`shrink-0 pl-[0.4375rem] pr-1 font-mono text-[length:var(--fs-8)] uppercase leading-[1.15] tracking-[0.1em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-9)] lg:tracking-[0.14em] ${legendClassName}`}
      >
        {legend}
      </span>
      {children}
    </span>
  );
}

/**
 * The narrowings, the splits and the sort, in a hole cut into the case.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. One wrapping row above
 * `lg` and three stacked below, which is the design's own phone arrangement.
 *
 * **The phone carries no `Splits` rail**, and that is not an omission: the
 * phone has no columns to hide. Its rows fold the whole line onto one wrapping
 * strip (`statFamilies`), so a control over which column groups the *table*
 * carries would be a control over something not on screen.
 *
 * **Every cap keeps `touch:min-h-11`**, which is the one deliberate deviation
 * from the design and the handoff names it as a decision: its compacted phone
 * caps are 36px, under this app's own 44px floor. The floor wins. It is the
 * rule every other cap, key and menu on this page already keeps, and spending
 * it here would make this ledge the only place in the app where a touch target
 * is short — to buy one list row, on a panel that scrolls.
 */
function Ledge({
  filters,
  onFilters,
  teams,
  splits,
  onSplits,
  usage,
  onUsage,
  sort,
  onSort,
}: {
  filters: Omit<StatBoardFilters, "usage">;
  onFilters: (filters: Omit<StatBoardFilters, "usage">) => void;
  teams: readonly string[];
  splits: readonly StatSplitKey[];
  onSplits: (splits: readonly StatSplitKey[]) => void;
  usage: readonly UsageKey[];
  onUsage: (usage: readonly UsageKey[]) => void;
  sort: StatSortKey;
  onSort: (key: StatSortKey) => void;
}) {
  return (
    <div className="relative flex shrink-0 flex-col gap-[5px] rounded-xl bg-[color:var(--case-well-bg)] p-[5px] shadow-[var(--case-well-shadow)] lg:flex-row lg:flex-wrap lg:items-center lg:gap-2 lg:p-2">
      {/* The field and the two menus share one row on the phone; above `lg`
          the wrapper stops generating a box and its three children join the
          wrapping row under their own order. */}
      <div className="flex min-w-0 items-center gap-[5px] lg:contents">
        <label
          className={`${CONSOLE_PANE_TRACK} relative flex min-w-0 flex-1 items-center gap-2 px-3.5 lg:order-1 lg:min-w-44 lg:flex-[1_1_7rem]`}
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
          panel="w-52"
          columns="grid-cols-5"
          className="shrink-0 lg:order-2"
        />

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
          className="shrink-0 lg:order-6"
        />
      </div>

      {/* Which split families the table carries. Desktop only — see the note. */}
      <CapRail
        legend="Splits"
        label="Splits shown"
        className="hidden shrink-0 rounded-full lg:flex lg:order-3"
      >
        {STAT_SPLITS.map((split) => {
          const lit = splits.includes(split.key);
          return (
            <Cap
              key={split.key}
              lit={lit}
              /* The floor is a disabled key rather than a corrected press —
                 see `toggleSplit`. A board with no splits at all is the
                 four-column list this replaced, not a narrower one. */
              disabled={lit && splits.length === 1}
              onPress={() => onSplits(toggleSplit(splits, split.key))}
              className="shrink-0 whitespace-nowrap px-2.5 tracking-[0.08em]"
            >
              {split.label}
            </Cap>
          );
        })}
      </CapRail>

      {/* The page's own narrowing — see the module note for the two scopes. */}
      <CapRail
        legend="Leagues where"
        /* **Not the pane's own name**, which is the same phrase: two groups
           called `Narrow my leagues to` are two controls a screen reader
           cannot tell apart, and these two narrow by different questions —
           this one over the players on the board, that one over one of them.
           The visible legends already differ; the accessible names now say
           the same thing in full. */
        label="Narrow my leagues by how the board's players were used"
        className="shrink-0 rounded-[1.25rem] lg:order-4 lg:rounded-full"
        legendClassName="w-11 whitespace-normal lg:w-auto lg:whitespace-nowrap"
      >
        <span className="grid min-w-0 flex-1 grid-cols-2 gap-1 lg:flex lg:flex-none lg:gap-1">
          {USAGE_KEYS.map((key) => (
            <Cap
              key={key}
              lit={usage.includes(key)}
              onPress={() => onUsage(toggleFilterValue(usage, key))}
              className="min-w-0 whitespace-nowrap px-2 tracking-[0.06em] lg:px-2.5 lg:tracking-[0.08em]"
            >
              {USAGE_LABEL[key]}
            </Cap>
          ))}
        </span>
      </CapRail>

      {/* The caps are a single-select rail, and the chosen one is the rack's
          own accent cap — one spelling of a lit cap in this app. They stretch
          below `lg`, where the row is theirs, and never ellipsise: a sort key
          a reader cannot read is a list ordered by something nothing on
          screen names. */}
      <CapRail
        legend="Sort"
        label="Sort by"
        className="min-w-0 flex-wrap rounded-[1.25rem] lg:order-5 lg:flex-none lg:rounded-full"
      >
        {STAT_SORTS.map((option) => (
          <Cap
            key={option.key}
            lit={sort === option.key}
            onPress={() => onSort(option.key)}
            className="flex-auto whitespace-nowrap px-2 tracking-[0.04em] lg:flex-none lg:px-2.5 lg:tracking-[0.14em]"
          >
            {option.label}
          </Cap>
        ))}
      </CapRail>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The scoring list: lit glass holding milled rows, in two arrangements.
 *
 * **Above `lg` it is a box score that scrolls sideways between two pinned
 * edges.** The row's own track is wider than the pane at every width the app
 * is drawn at — 1112px with every split carried — and what makes that
 * readable rather than a maze is that the two columns a reader navigates by
 * never move: `Player` holds the left edge and `Pts` the right, and the nine
 * split figures travel between them. Turning the pins off would not make it a
 * narrower table, it would make it one where a reader scrolled to the
 * receiving yards and no longer knew whose they were.
 *
 * **Below `lg` there is no sideways travel at all.** The same nine figures
 * fold onto a third line per row (`statFamilies`), one group per family the
 * player actually has, which is what a 390px screen can hold and a 1112px
 * track cannot.
 *
 * They are two components gated by the cascade rather than one with
 * `lg:contents`, because what differs is the *content* and not only its
 * layout — nine cells become one wrapping strip. Both gates are
 * `display: none`, which takes one out of the accessibility tree, so exactly
 * one is ever read: `WeekStepper`'s own precedent and its two conditions.
 */
function List({
  rows,
  columns,
  population,
  sort,
  basis,
  picked,
  onPick,
  narrowed,
}: {
  rows: readonly RankedStatRow[];
  columns: readonly StatColumn[];
  population: readonly number[];
  sort: StatSortKey;
  basis: StatBasis;
  picked: string | null;
  onPick: (id: string) => void;
  narrowed: boolean;
}) {
  const track = statTrackWidth(columns);
  const empty = rows.length === 0;
  return (
    <div className={`${CONSOLE_GLASS} flex min-h-0 flex-1 flex-col rounded-xl`}>
      <Scanlines />
      {empty ? (
        <p className="relative z-[1] px-3 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
          {narrowed ? "No player matches that narrowing." : "No scoring lines this week yet."}
        </p>
      ) : (
        <>
          {/* The wide arm scrolls in both axes; its head and its two edge
              columns are `sticky` against this one scroller. */}
          <div className="lab-scroll-glass relative z-[1] hidden min-h-0 flex-1 overflow-auto p-[3px] lg:block">
            <div role="table" aria-label="Player scores" style={{ width: track }}>
              <Head columns={columns} sort={sort} track={track} />
              {rows.map((row) => (
                <WideRow
                  key={row.player_id}
                  row={row}
                  columns={columns}
                  track={track}
                  population={population}
                  lit={picked === row.player_id}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
          <ul className="lab-scroll-glass relative z-[1] m-0 min-h-0 flex-1 list-none overflow-y-auto p-[3px] lg:hidden">
            {rows.map((row) => (
              <PhoneRow
                key={row.player_id}
                row={row}
                basis={basis}
                population={population}
                lit={picked === row.player_id}
                onPick={onPick}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The head: two tiers in one sticky block, and the second names the columns.
 *
 * **No `overflow-hidden` on the block**, which is this board's own recorded
 * finding rather than a style: an `overflow` other than `visible` makes an
 * element a scroll container, so the two cells pinned inside it would stick to
 * *the head* — which is exactly as wide as the grid — and therefore not move
 * at all. The radius goes on the corner cells instead, which is what the clip
 * was doing the rest of its work for.
 *
 * **The sorted column is lit, and which column that is depends on the key.**
 * `Pts` carries the arrow and the accent while the list is ordered by points;
 * on the three usage keys the arrow clears and `Your leagues` takes the accent,
 * because all three are readings of that cell. On `Yds` and `TD` the *split*
 * columns that contribute light instead — three of them each, and **no arrow**,
 * because those two orderings are a sum across families rather than any one
 * column's own figure, and an arrow on three heads would claim three orderings.
 *
 * Not pressable, which is the design's own call: sorting lives in the ledge's
 * rail, and a head that set the same key would be a second control for one
 * fact with no way to show the direction the caps cannot express.
 */
function Head({
  columns,
  sort,
  track,
}: {
  columns: readonly StatColumn[];
  sort: StatSortKey;
  track: number;
}) {
  const points = sort === "points";
  const usage = sort === "start" || sort === "bench" || sort === "against";
  const summed = (column: StatColumn) =>
    (sort === "yds" && column.label === "Yd") ||
    (sort === "td" && column.label === "TD");
  const ink = (lit: boolean) =>
    lit ? "text-[color:var(--billet-accent)]" : "text-[color:var(--billet-label)]";
  return (
    <div
      role="row"
      className={`${CONSOLE_WINDOW_LEDGE} sticky top-0 z-[3] mb-[5px] rounded-[7px]`}
      style={{ width: track }}
    >
      {/* Tier one: the family each run of columns belongs to. */}
      <div aria-hidden className="flex h-6 items-center">
        {statGroupSpans(columns).map((span) => (
          <span
            key={span.key}
            style={{ flex: `0 0 ${span.width}px` }}
            className={`flex h-full items-center justify-center font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] ${
              span.cut
                ? "border-l border-[color:var(--milled-hairline)] shadow-[var(--milled-hairline-highlight)]"
                : ""
            } ${PIN_HEAD[span.pin ?? "none"]} ${
              span.pin === "left" ? "rounded-tl-[7px]" : ""
            } ${span.pin === "right" ? "rounded-tr-[7px]" : ""}`}
          >
            {span.label}
          </span>
        ))}
      </div>
      {/* Tier two: the columns themselves. */}
      <div className="flex h-[30px] items-center border-t border-[color:var(--milled-hairline)]">
        <span
          role="columnheader"
          style={{ flex: `0 0 ${STAT_FIXED.player}px` }}
          className={`${HEAD_CELL} rounded-bl-[7px] px-2.5 ${PIN_HEAD.left} ${ink(false)}`}
        >
          Player
        </span>
        <span
          role="columnheader"
          style={{ flex: `0 0 ${STAT_FIXED.game}px` }}
          className={`${HEAD_CELL} justify-end whitespace-nowrap pr-2.5 ${ink(false)}`}
        >
          Game
        </span>
        {columns.map((column) => (
          <span
            key={column.key}
            role="columnheader"
            style={{ flex: `0 0 ${column.width}px` }}
            className={`${HEAD_CELL} justify-end pr-2 tracking-[0.1em] ${ink(summed(column))}`}
          >
            {column.label}
          </span>
        ))}
        <span
          role="columnheader"
          style={{ flex: `0 0 ${STAT_FIXED.leagues}px` }}
          className={`${HEAD_CELL} px-2.5 ${ink(usage)}`}
        >
          Your leagues
        </span>
        <span
          role="columnheader"
          aria-sort={points ? "descending" : undefined}
          style={{ flex: `0 0 ${STAT_FIXED.points}px` }}
          className={`${HEAD_CELL} justify-end gap-1 rounded-br-[7px] pr-3 ${PIN_HEAD.right} ${ink(points)}`}
        >
          Pts
          <span aria-hidden className="text-[length:var(--fs-9)]">
            {points ? "▼" : ""}
          </span>
        </span>
      </div>
    </div>
  );
}

const HEAD_CELL =
  "flex h-full items-center font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em]";

/**
 * The two pinned edges, in the head's own stock and in the rows'.
 *
 * **Both paint an opaque background**, which is the whole of what makes a pin
 * work: a transparent cell holds its place and lets every figure it is
 * supposed to be covering slide through it. The cast is the app's own
 * `--stat-pin-*` pair, which has been in `globals.css` since it was written
 * for exactly this and had no reader until now — `--stat-pin-lip` composed
 * into both, so the two edges keep the row's own lit lower lip.
 */
const PIN_HEAD: Record<"left" | "right" | "none", string> = {
  left: "sticky left-0 z-[2] bg-[image:var(--window-ledge-bg)] shadow-[var(--stat-pin-left-shadow)]",
  right:
    "sticky right-0 z-[2] bg-[image:var(--window-ledge-bg)] shadow-[var(--stat-pin-right-shadow)]",
  none: "",
};

const PIN_ROW = {
  left: "sticky left-0 z-[2] bg-[image:var(--readout-bg)] shadow-[var(--stat-pin-left-shadow)]",
  right:
    "sticky right-0 z-[2] bg-[image:var(--readout-bg)] shadow-[var(--stat-pin-right-shadow)]",
} as const;

/**
 * One row of the wide list.
 *
 * The whole row is the button and the cells are its children, which is what
 * makes the press target the row rather than the name — a reader aiming at a
 * four-hundred-row list should not have to hit a word. The well around it is a
 * plain box, because a channel and its own press are two things and a
 * `<button>` cannot carry the row's `margin-bottom` without the gap becoming
 * part of the target.
 *
 * **Memoised on what it prints**, which the live half of this page makes worth
 * doing: a frame lands every twenty seconds and the table is thirteen cells a
 * row, so a hundred rows re-rendering to move the two whose figures changed is
 * the cost `GametimeCard`'s own memo discipline exists to avoid. Every prop is
 * a value or a stable callback by construction.
 */
const WideRow = memo(function WideRow({
  row,
  columns,
  track,
  population,
  lit,
  onPick,
}: {
  row: RankedStatRow;
  columns: readonly StatColumn[];
  track: number;
  population: readonly number[];
  lit: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div
      className={`${CONSOLE_ROW_WELL} mb-[3px] rounded-[7px] ${
        lit ? "shadow-[var(--row-well-shadow),0_0_24px_-10px_var(--accent-glow)]" : ""
      }`}
      style={{ width: track }}
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
        className="flex h-[38px] w-full cursor-pointer items-center rounded-[7px] border-0 bg-transparent p-0 text-left"
      >
        <span
          role="cell"
          style={{ flex: `0 0 ${STAT_FIXED.player}px` }}
          className={`flex h-[38px] min-w-0 items-center gap-2 rounded-l-[7px] px-2.5 ${PIN_ROW.left}`}
        >
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
          <span
            className={`shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.08em] ${POSITION_INK(row)}`}
          >
            {row.position}
          </span>
        </span>
        <span
          role="cell"
          style={{ flex: `0 0 ${STAT_FIXED.game}px` }}
          className={`flex items-center justify-end whitespace-nowrap pr-2.5 ${CLOCK} ${clockInk(row)}`}
        >
          {row.clock.text}
        </span>
        {columns.map((column) => (
          <Figure key={column.key} width={column.width} value={row[column.key]} />
        ))}
        <span
          role="cell"
          style={{ flex: `0 0 ${STAT_FIXED.leagues}px` }}
          className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2.5"
        >
          {row.held ? (
            statTags(row).map((tag) => <Tag key={tag.key} tag={tag} />)
          ) : (
            <span className="truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
              Nobody in your leagues
            </span>
          )}
        </span>
        <span
          role="cell"
          style={{ flex: `0 0 ${STAT_FIXED.points}px` }}
          className={`flex h-[38px] items-center justify-end rounded-r-[7px] pr-2 ${PIN_ROW.right}`}
        >
          <PointsFigure points={row.points} population={population} />
        </span>
      </button>
    </div>
  );
});

/**
 * One split figure — **a zero is an em dash**, and that is this column's own
 * grammar rather than the app's usual one.
 *
 * Everywhere else on this console a dash is an *absence* and a nought is a
 * real answer; here `GametimeStatLine`'s own note says the two are the same
 * reading, because a player who caught nothing caught nothing and there is no
 * third state for a column to be missing rather than empty. So nine columns of
 * noughts would be nine columns of noise, and the dash is what lets a reader
 * see the three figures on a row at a glance. The ink says the same thing
 * again: `--stat-zero-ink` is quieter than a figure's.
 */
function Figure({ width, value }: { width: number; value: number }) {
  const zero = value === 0;
  return (
    <span
      role="cell"
      style={{ flex: `0 0 ${width}px` }}
      className={`flex items-center justify-end pr-2 font-mono text-[length:var(--fs-12)] tabular-nums ${
        zero ? "text-[color:var(--stat-zero-ink)]" : "text-[color:var(--readout-line)]"
      }`}
    >
      {zero ? EM_DASH : value}
    </span>
  );
}

/**
 * One of the four counts, in a figure well.
 *
 * **The well lights when that reading is narrowing the reader's grid**, which
 * is where this parts company with what it used to say: it lit on the *sort*
 * key before, and one well cannot mean two things. The sort is named on its
 * own cap and in the head's accent; what a lit chip now says is "this is the
 * reading your leagues are narrowed by", which is a fact about the page and
 * worth a hundred rows' worth of repetition.
 *
 * `--tag-lit-shadow` is `--figure-well-shadow` plus an accent ring and glow,
 * composed in CSS rather than appended here: a shadow list is atomic, so a
 * second `shadow-[…]` would replace the chamfer rather than add to it. Hence
 * the shell, which carries no shadow of its own.
 *
 * The inks are the four readings' own: the reader's starters are the accent,
 * their bench is the amber this app spends on "neither", and the opposing pair
 * is the quiet line ink — the same vocabulary the pane's group headers use.
 */
function Tag({ tag, lit = false }: { tag: StatTag; lit?: boolean }) {
  const ink = TAG_INK[tag.key];
  return (
    <span
      className={`${CONSOLE_FIGURE_WELL_SHELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] px-[0.4375rem] py-px ${
        lit ? "shadow-[var(--tag-lit-shadow)]" : "shadow-[var(--figure-well-shadow)]"
      }`}
    >
      <span
        className={`font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] ${ink.label}`}
      >
        {tag.label}
      </span>
      <span className={`font-mono text-[length:var(--fs-11)] tabular-nums ${ink.figure}`}>
        {tag.count}
      </span>
    </span>
  );
}

/**
 * A record over the four readings — exhaustive, so a fifth breaks the compile
 * here rather than rendering an unstyled chip.
 */
const TAG_INK: Record<UsageKey, { label: string; figure: string }> = {
  start: {
    label: "text-[color:var(--billet-accent)]",
    figure: "text-readout [text-shadow:var(--readout-text-glow)]",
  },
  bench: {
    label: "text-[color:var(--median-ink)]",
    figure: "text-[color:var(--median-ink)]",
  },
  "opp-start": {
    label: "text-[color:var(--readout-muted)]",
    figure: "text-[color:var(--readout-line)]",
  },
  "opp-bench": {
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
const CLOCK = "font-mono text-[length:var(--fs-10)] uppercase tracking-[0.04em]";

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
const matchup = (row: StatRow) => [row.team, row.opponent].filter(Boolean).join(" ");

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
  className = "min-w-14 text-[length:var(--fs-14)] lg:text-[length:var(--fs-15)]",
}: {
  points: number;
  population: readonly number[];
  className?: string;
}) {
  const percentile = sharePercentile(points, population);
  return (
    <span
      className={`${CONSOLE_FIGURE_WELL} inline-flex justify-end px-[7px] py-0.5 font-display font-semibold tabular-nums ${className}`}
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
 * One row of the phone list: three lines, the last two indented under the name.
 *
 * **The third line is the box score**, folded onto one wrapping strip by
 * `statFamilies` — one group per family the player actually has, so a receiver
 * reads `REC 8 rec · 112 yd · 1 td` and not that under two rows of dashes. It
 * is what lets the phone carry everything the 1112px table does with no
 * sideways travel at all, which is the one thing the design asks of this arm.
 *
 * The four counts are one short string here (`6 st · 2 sat · 4 vs · 1 vs sat`)
 * rather than four wells, and it is a width: the line they share already
 * carries a position, a matchup and a clock.
 *
 * **It truncates on the longest case, and that is measured rather than
 * missed.** A player with three or four readings *and* a running clock needs
 * about 160px of the ~155 the line has left at 390 — five pixels — and what
 * goes is the tail of the fourth reading. It is the design's own arrangement
 * and its own example line is longer still; the degradation is an ellipsis
 * rather than a wrong number, and the pane one press away states all four with
 * their counts. The two ways to close it both cost more than five pixels:
 * summing the opposing pair here would make the phone say something different
 * from the chips above it, and letting the matchup shrink first would truncate
 * `CIN @BAL`, which is the one clause on the line with no second home.
 */
const PhoneRow = memo(function PhoneRow({
  row,
  basis,
  population,
  lit,
  onPick,
}: {
  row: RankedStatRow;
  basis: StatBasis;
  population: readonly number[];
  lit: boolean;
  onPick: (id: string) => void;
}) {
  const tags = statTagLine(row);
  const families = statFamilies(row, basis);
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
        className="flex min-h-11 w-full cursor-pointer flex-col gap-[3px] rounded-[7px] border-0 bg-transparent px-2 py-[0.3125rem] text-left"
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
          <PointsFigure
            points={row.points}
            population={population}
            className="min-w-[3.25rem] text-[length:var(--fs-14)]"
          />
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-[1.625rem]">
          <span
            className={`shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.06em] ${POSITION_INK(row)}`}
          >
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
        {families.length > 0 && (
          <span
            className={`${CONSOLE_FIGURE_WELL} ml-[1.625rem] flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-[3px] px-2 py-[3px]`}
          >
            {families.map((family) => (
              <span key={family.key} className="inline-flex shrink-0 items-baseline gap-[0.3125rem]">
                <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
                  {PHONE_FAMILY[family.key]}
                </span>
                <span className="font-mono text-[length:var(--fs-10)] tabular-nums text-[color:var(--readout-line)]">
                  {family.text}
                </span>
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
});

/** The phone strip's own short words, where the pane says them in full. */
const PHONE_FAMILY: Record<StatFamily["key"], string> = {
  pass: "Pass",
  rush: "Rush",
  rec: "Rec",
  fum: "Fum",
};

/* ------------------------------------------------------------------ */

/**
 * The pane: one player's own line, and the four keys that narrow the grid.
 *
 * **This is what replaced the five-group league list**, and the two answer
 * different halves of one question. That list named *which* of the reader's
 * leagues he was in and what seat he sat in — which the board's own `Your
 * leagues` chips now count and the keys below now *act on*, so naming them was
 * a third statement of a fact already twice on screen. What no surface
 * answered, and what a reader looking at `25.2` actually wants, is where the
 * number came from: this states his line family by family, and then adds it
 * up.
 *
 * **The sum is the column's own arithmetic itemised, never a second one.**
 * `statScoring` walks the same term table `statPoints` sums, so the rows in
 * `How 25.2 adds up` are the summands of the figure at the top of the pane
 * rather than an opinion about it. An explanation that recomputed its subject
 * would be the one kind of wrong nobody could see.
 *
 * At rest it prompts rather than seeding itself with the week's top scorer: a
 * pane that opened already answering would be claiming a reader had asked
 * about somebody.
 */
function Detail({
  className,
  row,
  basis,
  leagues,
  reading,
  onReading,
  narrowing,
  onNarrow,
}: {
  className: string;
  row: RankedStatRow | null;
  basis: StatBasis;
  leagues: number;
  reading: PlayerReading;
  onReading: (reading: PlayerReading) => void;
  narrowing: boolean;
  onNarrow: () => void;
}) {
  return (
    <div
      className={`${CONSOLE_GLASS} ${className} min-h-0 w-full shrink-0 flex-col rounded-xl lg:w-80 xl:w-[24.5rem]`}
    >
      <Scanlines />
      {row === null ? (
        <p className="relative z-[1] m-0 px-4 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
          Press a player to see how his week adds up.
        </p>
      ) : (
        <>
          {/* **The manager console's header, shared** — `DetailLedge`, with the
              points well beside the name and the meta lines under it. It is
              drawn at every width, where the billet it replaced was hidden
              below `lg` because the bar already carries the name: the
              `Narrow grid` key lives here, and a phone that lost the header
              would lose the key. A player nobody holds gets no key — there is
              no league of the reader's to narrow to. */}
          <DetailLedge
            name={row.name ?? row.player_id}
            aside={
              <span
                className={`${CONSOLE_MILLED_WELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] px-[0.4375rem] py-px`}
              >
                <BayLabel>Pts</BayLabel>
                <span className="font-display text-[length:var(--fs-15)] font-semibold tabular-nums text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]">
                  {row.points.toFixed(1)}
                </span>
              </span>
            }
            sub={
              <div>
                <p className={`m-0 ${META} text-[color:var(--billet-label)]`}>{meta(row)}</p>
                <p className={`m-0 mt-[0.1875rem] ${META} text-[color:var(--billet-scope)]`}>
                  {standing(row, leagues)}
                </p>
              </div>
            }
            narrowing={narrowing}
            onNarrow={row.held ? onNarrow : undefined}
            narrowLabel={`${row.name ?? "this player"}: ${READING_NOTE[reading].toLowerCase()}`}
          />

          <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5">
            {/* The manager pane's own mode track, over his readings: what the
                `Narrow grid` key above puts on the grid. `All` is the resting
                reading — every league he is in, either side. */}
            {row.held && (
              <ModeTrack
                legend="Leagues"
                label={`Which of your leagues ${row.name ?? "this player"} narrows to`}
                options={PLAYER_READINGS.map((id) => ({
                  id,
                  label: READING_LABEL[id],
                  count: readingCount(row, id),
                }))}
                value={reading}
                onPick={onReading}
                note={READING_NOTE[reading]}
                wrap
                className="px-1 pb-2.5 pt-0.5"
              />
            )}
            {statFamilies(row, basis).map((family) => (
              <LineGroup
                key={family.key}
                swatch={FAMILY_SWATCH[family.key]}
                ink="text-[color:var(--billet-accent)]"
                title={family.title}
                total={familyTotal(family)}
                rows={family.rows}
              />
            ))}
            <LineGroup
              swatch="var(--median-ink)"
              ink="text-[color:var(--median-ink)]"
              title={`How ${row.points.toFixed(1)} adds up`}
              total={row.points.toFixed(1)}
              rows={statScoring(row, basis)}
              /* **The app's third voice — neither side.** The families above
                 are the reader's own accent because they are this player's
                 week; the sum is a different kind of statement about it, and
                 the amber is what this console already spends on a reading
                 that belongs to nobody. */
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What each of his readings means, in the track's lit sentence and in the
 * `Narrow grid` key's accessible name.
 *
 * **The track is single-select because the four are a partition.** He sits on
 * one roster per league, so `Started` ∧ `They sat` is empty by construction for
 * one player — a reader who could press two would watch their grid go blank
 * for a press that looked exactly like the one before it. `All` is the one
 * union worth offering, for the same reason: every league he is in, either
 * side. (The ledge's caps AND, and they can: they are asked over a
 * *population*.)
 */
const READING_NOTE: Record<PlayerReading, string> = {
  all: "Every league he is in, either side",
  start: "The leagues you started him in",
  bench: "The leagues you sat him in",
  "opp-start": "The leagues he was started against you",
  "opp-bench": "The leagues he sat on your opponent's bench",
};

/** One family of his line, or the sum: a stamped header over milled rows. */
function LineGroup({
  swatch,
  ink,
  title,
  total,
  rows,
}: {
  swatch: string;
  ink: string;
  title: string;
  total: string;
  rows: readonly StatLineRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-2">
      <div className={`${CONSOLE_WINDOW_LEDGE} mb-1 flex items-center gap-2 rounded-[5px] px-2 py-1`}>
        <span
          aria-hidden
          className="block h-[0.8125rem] w-[0.3125rem] shrink-0 rounded-sm"
          style={{ background: swatch }}
        />
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] [text-shadow:var(--standing-label-shadow)] ${ink}`}
        >
          {title}
        </span>
        <span className="shrink-0 font-display text-[length:var(--fs-13)] font-semibold tabular-nums text-[color:var(--billet-figure)] [text-shadow:var(--standing-engrave)]">
          {total}
        </span>
      </div>
      {rows.map((line) => (
        <div
          key={line.label}
          className={`${CONSOLE_ROW_WELL} mb-[3px] flex min-h-9 items-center gap-2 rounded-[5px] px-2 py-[0.3125rem] lg:min-h-0`}
        >
          <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-11)] tracking-[0.02em] text-[color:var(--readout-line)]">
            {line.label}
          </span>
          <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-[color:var(--readout-label)]">
            {line.rate}
          </span>
          <span
            className={`${CONSOLE_FIGURE_WELL} inline-flex min-w-11 shrink-0 justify-end px-[0.4375rem] py-px font-mono text-[length:var(--fs-11)] tabular-nums ${
              line.zero
                ? "text-[color:var(--stat-zero-ink)]"
                : "text-[color:var(--readout-line)]"
            }`}
          >
            {line.zero ? EM_DASH : line.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The headline figure a family is read by — yards where it has them, and the
 * count where it does not.
 *
 * A family's own total is not a sum of its rows (they are three different
 * units — receptions, yards and touchdowns do not add), so what the header
 * carries is the one figure a reader names the line by: `112 yd` for a
 * receiver, `2 lost` for a fumble. It is the same choice the phone strip makes
 * by leading with yardage.
 */
function familyTotal(family: StatFamily): string {
  const yards = family.rows.find((r) => r.label === "Yards");
  if (yards && !yards.zero) return `${yards.value} yd`;
  const first = family.rows.find((r) => !r.zero);
  return first ? `${first.value} ${first.label.toLowerCase()}` : EM_DASH;
}

/**
 * A family's swatch — **one voice for the three that add, a ghost for the one
 * that takes away**.
 *
 * The three stat families are one kind of statement (this is his line) and are
 * drawn alike; a fumble is the only figure on the pane that *subtracts*, and
 * the ghost is what says so without a second colour. The sum below them takes
 * the amber, which is this console's third voice — see `LineGroup`'s caller.
 *
 * Every one is a token rather than a literal, which is this file's standing
 * rule and load-bearing here: the design bundle is dark-only, and a
 * `rgba(214,255,250,0.14)` ghost is a near-white alpha *on a near-black
 * window*. Carried across it is simply not there on the pale one. The
 * `color-mix` reads `--readout-line`, which inverts, so a ghost is a ghost on
 * both.
 */
const FAMILY_SWATCH: Record<StatFamily["key"], string> = {
  pass: "var(--lit-bar-bg)",
  rush: "var(--lit-bar-bg)",
  rec: "var(--lit-bar-bg)",
  fum: "color-mix(in srgb, var(--readout-line) 22%, transparent)",
};

const META = "font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em]";

/** `WR · CIN @BAL · Q3 11:02`, with the clauses it has. */
function meta(row: StatRow): string {
  return [row.position, matchup(row), row.clock.text].filter(Boolean).join(" · ");
}

/**
 * The sub-line: how the reader's week treated him, in one sentence.
 *
 * A player nobody has says so in words rather than printing four noughts,
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

/** Absent is a dash **here**, where the helper's own answer is a nought. */
const EM_DASH = "—";
