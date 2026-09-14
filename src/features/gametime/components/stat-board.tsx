"use client";

import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";

import {
  BilletFinish,
  CollapseTray,
  CONSOLE_CHANNEL_METAL,
  CONSOLE_FIGURE_WELL,
  CONSOLE_FIGURE_WELL_SHELL,
  CONSOLE_GLASS,
  CONSOLE_KEY_PILL,
  CONSOLE_MILLED_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_ROW_WELL,
  CONSOLE_WELL,
  CONSOLE_WINDOW,
  CONSOLE_WINDOW_LEDGE,
  DetailLedge,
  FacetChip,
  FacetFoot,
  FacetGroove,
  FacetRow,
  FiltersKey,
  ModeTrack,
  RangeRow,
  rankColor,
  Scanlines,
  sharePercentile,
  storeStatBoardOpen,
  useStatBoardOpen,
  type WeekTwoSidedShares,
} from "@/features/shared";
import type { GametimeGame, GametimeStatLine } from "@/shared/contract";

import {
  DEFAULT_STAT_SORT_STATE,
  defaultStatAscending,
  narrowStatRows,
  nextStatSort,
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
  STAT_STAGE_BOUNDS,
  STAT_STAGES,
  ALL_SPLITS,
  STAT_SPLITS,
  statColumns,
  statFacetCount,
  statFacetCounts,
  statFamilies,
  statFilterSummary,
  statGroupSpans,
  statHeads,
  statRows,
  statScoring,
  statSortFor,
  statTagLine,
  statTrackWidth,
  toggleFacet,
  toggleSplit,
  topStatRow,
  USAGE_COUNT,
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
  StatHead,
  StatLineRow,
  StatRow,
  StatShareCounts,
  StatSort,
  StatSortKey,
  StatSplitKey,
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
  gridNarrowed,
  onGridNarrowed,
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
  /**
   * …and, beside it, what the pane's `Narrow grid` key is narrowing to in
   * words (`Ja'Marr Chase · Every league he is in, either side`), or null when
   * the key is off — the page states it in its header, since a grid filtered
   * with nothing on screen saying so is the one thing a narrowing must not be.
   */
  onScope: (leagues: ReadonlySet<string> | null, paneLabel: string | null) => void;
  /**
   * Whether the pane's `Narrow grid` key is on — **the page's state, not the
   * board's**, and the reason is the bug it fixes.
   *
   * The open board covers nearly the whole viewport, so a reader who narrows
   * collapses it to see the grid — and the page builds the fold this narrowing
   * is answered from only while something needs it. Held down here, the page
   * could not know the key was on: collapsing dropped the fold and the
   * narrowing with it, and the key looked like it did nothing. Up there it
   * keeps the fold alive, and the header can state it and clear it.
   */
  gridNarrowed: boolean;
  onGridNarrowed: (narrowed: boolean) => void;
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
  /**
   * Which head the list is ordered by, and which way.
   *
   * **The heads are the sort control and the `Sort` cap rail is gone**, which
   * is what made a direction expressible at all: a rail of six caps can say
   * which key is in force and has nowhere to put the arrow, so every ordering
   * on the old board was descending and `Name` was not offered. A head can
   * carry both, so a press on a fresh one takes its natural direction and a
   * press on the lit one reverses — see `nextStatSort`.
   */
  const [sort, setSort] = useState<StatSort>(DEFAULT_STAT_SORT_STATE);
  /**
   * Drop or add a split family — **and keep the sort answerable**.
   *
   * The two are one press because the rail can take the lit head off the
   * board: see `statSortFor`, which returns the held sort by identity where
   * the columns still carry it, so the ordinary press re-renders nothing.
   */
  const pickSplits = useCallback((next: readonly StatSplitKey[]) => {
    setSplits(next);
    setSort((held) => statSortFor(held, statColumns(next)));
  }, []);
  /** Whether the ledge's Filters tray is down. A view, so it is not stored. */
  const [trayOpen, setTrayOpen] = useState(false);
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
   * Which of his readings the pane is on — and, in `gridNarrowed` (the
   * page's; see the prop), whether the grid is narrowed to it. **Two states,
   * the manager console's own split**: the track says what a reader is looking
   * at and the `Narrow grid` key says whether the page behind is filtered to
   * it, so a reader can move between readings without the grid jumping and put
   * one on the grid with one deliberate press.
   *
   * Both reset with `picked`, and that is a correctness rule rather than
   * tidiness: a reading is a fact about *that* player, so carrying a narrowing
   * onto the next one would filter the grid by a question nobody asked about
   * him. The reset happens where the pick is set, so there is no effect to run
   * late.
   */
  const [reading, setReading] = useState<PlayerReading>("all");

  /**
   * Pick a row from its player cell: the pane reads him, and **nothing is
   * narrowed**.
   *
   * Both states that ride a pick reset with it, and that is a correctness rule
   * rather than tidiness: a reading is a fact about *that* player, so carrying
   * one onto the next would leave a well lit on his row and the grid filtered
   * by a question nobody asked about him. The reset happens where the pick is
   * set, so there is no effect to run late.
   */
  /**
   * Back to the list, from the phone bar's own `‹ List` key.
   *
   * It clears the reading and the narrowing with the pick, on `pick`'s rule:
   * the pane is the only thing that could state either, and a reader who has
   * gone back to the list is not looking at it.
   */
  const clearPick = useCallback(() => {
    setPicked(null);
    setReading("all");
    onGridNarrowed(false);
  }, [onGridNarrowed]);
  const pick = useCallback(
    (id: string) => {
      setPicked((held) => (held === id ? held : id));
      setReading("all");
      onGridNarrowed(false);
    },
    [onGridNarrowed],
  );
  /**
   * Press one of a row's four usage wells — **the board's one narrowing
   * gesture**.
   *
   * On, it does three things at once, which is the design's whole claim for
   * the columns: a reader looking at `Started 7` on a row presses it and has
   * that player's seven leagues on the grid behind, with the pane reading him.
   * Pressing the lit one clears the reading and the narrowing and leaves the
   * row picked — the pane goes on answering about him, which is the state a
   * reader who has just un-narrowed is in.
   *
   * **There is no `cellPick` state and a lit well is derived**, which is what
   * keeps the well and the pane's own track one fact rather than two that
   * agree until somebody presses the track. A well is lit when the pane is
   * reading this row on this reading, so a press on the pane's `Sat` key moves
   * the lit well down the row with it — where a stored pair would have left
   * `Started` lit under a pane, and a grid, on something else.
   *
   * A row nobody in the reader's leagues holds prints an em dash and does not
   * toggle: there is no league of theirs for it to narrow to.
   */
  const pressCount = useCallback(
    (id: string, key: UsageKey) => {
      const lit = picked === id && reading === key;
      setPicked(id);
      setReading(lit ? "all" : key);
      onGridNarrowed(!lit);
    },
    [picked, reading, onGridNarrowed],
  );
  /**
   * Esc collapses the panel.
   *
   * The one keyboard affordance to add, and the only one: this is not a
   * `<dialog>`, so there is nothing to cancel and nothing gives it back for
   * free. It listens only while up, so it cannot swallow an Escape meant for
   * the league filters dialog or a card — `SharesConsole`'s own spelling one
   * page over.
   *
   * **It collapses rather than cancelling**, which is the design's own wording
   * and the honest one: the narrowing a reader made survives the bar coming
   * down (the page holds it, and the fold behind it with it), so an Escape
   * that undid the press would be undoing something the reader can see the
   * result of on the grid it just uncovered.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") storeStatBoardOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleGridNarrowed = useCallback(
    () => onGridNarrowed(!gridNarrowed),
    [gridNarrowed, onGridNarrowed],
  );

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
  /**
   * The tray edits one object and the two halves of it land in two places.
   *
   * `usage` is the page's — the league grid is what it narrows, and the header
   * states it beside the league filters' own summary — where the other four
   * are a way of reading *this list* and live here. The tray has no business
   * knowing that, so it is handed one `StatBoardFilters` and this splits the
   * write. The page bails out of an equal set, so a keystroke in the search
   * field costs nothing up there.
   */
  const onNarrowing = useCallback(
    (next: StatBoardFilters) => {
      const { usage: nextUsage, ...rest } = next;
      setFilters(rest);
      onUsage(nextUsage);
    },
    [onUsage],
  );
  const shown = useMemo(() => narrowStatRows(all, narrowing), [all, narrowing]);
  const columns = useMemo(() => statColumns(splits), [splits]);
  const rows = useMemo(() => rankStatRows(shown, sort), [shown, sort]);

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
  /**
   * The pane's narrowing in words, for the page's header — null whenever it is
   * not actually narrowing, including a pick the week no longer has leagues
   * for, so the header can never name a narrowing the grid is not under.
   */
  const paneLabel = useMemo(() => {
    if (!gridNarrowed || !picked || !leaguesById[picked]) return null;
    return `${lines[picked]?.name ?? picked} · ${READING_NOTE[reading]}`;
  }, [gridNarrowed, picked, leaguesById, lines, reading]);

  useEffect(() => {
    onScope(leagueScope, paneLabel);
  }, [leagueScope, paneLabel, onScope]);
  /** And it lets go when the board unmounts — a board that is gone narrows nothing. */
  useEffect(() => () => onScope(null, null), [onScope]);

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
          onList={clearPick}
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
                filters={narrowing}
                onFilters={onNarrowing}
                rows={all}
                shown={rows.length}
                total={all.length}
                splits={splits}
                onSplits={pickSplits}
                columns={columns}
                sort={sort}
                onSort={setSort}
                trayOpen={trayOpen}
                onTrayOpen={setTrayOpen}
              />
              <List
                rows={rows}
                columns={columns}
                population={population}
                sort={sort}
                onSort={setSort}
                picked={picked}
                onPick={pick}
                reading={reading}
                onPressCount={pressCount}
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
 * The narrowings and the splits, in a hole cut into the case.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. One wrapping row above
 * `lg` and stacked below, which is the design's own phone arrangement.
 *
 * **Four facets are behind one key**, which is the manager players drawer's
 * own bargain and the reason this ledge stopped being a row of pills: Pos,
 * Team, Clock and the four usage readings on the ledge itself is a control
 * deck taller than the list it narrows — the thing the panel exists to show.
 * So the key carries a count of the *facets answered* and the tray carries the
 * controls, and a reader who never opens it pays one key's height for all
 * four. The parts are `features/shared/ui/filter-tray.tsx`'s, so a chip here
 * counts the way a chip there does.
 *
 * **The `Sort` rail is gone** — the column heads are the sort control, which
 * is where a direction can be shown. **The `Leagues where` rail is gone too**,
 * and that narrowing is the tray's fourth row rather than the ledge's fifth
 * control: it is a question about which rows the board leaves, which is what
 * every other row of the tray is.
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
  rows,
  shown,
  total,
  splits,
  onSplits,
  columns,
  sort,
  onSort,
  trayOpen,
  onTrayOpen,
}: {
  filters: StatBoardFilters;
  onFilters: (filters: StatBoardFilters) => void;
  /** The **unfiltered** population — every count in the tray is folded over it. */
  rows: readonly StatRow[];
  shown: number;
  total: number;
  splits: readonly StatSplitKey[];
  onSplits: (splits: readonly StatSplitKey[]) => void;
  /** What the board carries — the phone's sort menu offers exactly these. */
  columns: readonly StatColumn[];
  sort: StatSort;
  onSort: (sort: StatSort) => void;
  trayOpen: boolean;
  onTrayOpen: (open: boolean) => void;
}) {
  const trayId = useId();
  const facets = statFacetCount(filters);
  const set = (patch: Partial<StatBoardFilters>) =>
    onFilters({ ...filters, ...patch });

  const positions = useMemo(
    () => statFacetCounts(rows, (row) => row.position),
    [rows],
  );
  // Teams are ranked by how many rows they would leave, not alphabetically:
  // the menu is 32 three-letter codes, and the ones worth reaching for are the
  // ones with players on the board.
  const teamCounts = useMemo(
    () => statFacetCounts(rows, (row) => row.team),
    [rows],
  );
  const teams = useMemo(
    () =>
      [...teamCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      ),
    [teamCounts],
  );
  /**
   * How many rows each reading would leave — four walks of the population, and
   * they are memoised because the ledge re-renders on **every keystroke** in
   * the search field beside them. Over four hundred rows that is sixteen
   * hundred reads per character typed, to print four numbers none of which can
   * move while a reader types: the counts are folded over the *unfiltered*
   * list, which is the rule that makes a chip say what it would leave.
   */
  const usageCounts = useMemo(() => {
    const counts = {} as Record<UsageKey, number>;
    for (const key of USAGE_KEYS) {
      let n = 0;
      for (const row of rows) if ((USAGE_COUNT[key](row) ?? 0) > 0) n++;
      counts[key] = n;
    }
    return counts;
  }, [rows]);

  return (
    <div className="relative flex shrink-0 flex-col gap-[5px] rounded-xl bg-[color:var(--case-well-bg)] p-[5px] shadow-[var(--case-well-shadow)] lg:gap-2 lg:p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-[5px] lg:gap-2">
        <label
          className={`${CONSOLE_PANE_TRACK} relative flex min-w-0 flex-[1_1_11rem] items-center gap-2 px-3.5`}
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
          <span className="sr-only">Search players</span>
          <input
            type="text"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="Search players"
            className="touch:min-h-11 w-full min-w-0 border-0 bg-transparent py-2 font-mono text-[length:var(--fs-12)] tracking-[0.04em] text-[color:var(--billet-name)] outline-none placeholder:text-[color:var(--readout-label)]"
          />
        </label>

        {/* **The denominator appears only while narrowed.** At rest `471 /
            471` is the same number printed twice, and the figure a reader
            wants off this window is how many rows are in front of them. */}
        <span
          className={`${CONSOLE_WINDOW} inline-flex shrink-0 items-baseline gap-1 rounded-xl px-[0.6875rem] py-[0.4375rem]`}
        >
          <Scanlines />
          <span className="relative font-mono text-[length:var(--fs-13)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {shown}
          </span>
          {shown !== total && (
            <span className="relative font-mono text-[length:var(--fs-9)] tabular-nums text-[color:var(--readout-label)]">
              / {total}
            </span>
          )}
        </span>

        {/* Which split families the table carries. Desktop only — see the note. */}
        <CapRail
          legend="Splits"
          label="Splits shown"
          className="hidden shrink-0 rounded-full lg:flex"
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

        {/* **Below `lg` there are no column heads, and the heads *are* the
            sort** — so a phone would have had a list it could not reorder.
            The old `Sort` cap rail is gone by the design's own change 2 and
            this is not its survival: it is a native menu over exactly the
            readings the heads name, in their **long** forms, because three
            of the columns are headed `Yd` and three `TD` and a flat list of
            those names nothing. It is the rule the shares panels' own Sort
            track already lives by — offer exactly the columns on screen —
            with the direction on a key beside it, which is where a head
            carries its arrow.

            A `<select>` rather than caps for the reason the `Team` menu two
            rows down is one: twenty keys is a rail no phone row can hold,
            and a native menu brings the platform's own list with it. */}
        <span
          className={`${CONSOLE_PANE_TRACK} inline-flex shrink-0 items-center gap-1 px-1 lg:hidden`}
        >
          <select
            aria-label="Sort players by"
            value={sort.key}
            onChange={(e) => {
              const key = e.target.value as StatSortKey;
              onSort({ key, asc: defaultStatAscending(key) });
            }}
            className="touch:min-h-11 max-w-[8.5rem] appearance-none truncate border-0 bg-transparent py-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-[color:var(--billet-accent)] outline-none"
          >
            {statHeads(columns).map((head) => (
              <option key={head.key} value={head.key}>
                {head.hint}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Sorted ${
              sort.asc ? "ascending" : "descending"
            } — press to reverse`}
            onClick={() => onSort(nextStatSort(sort, sort.key))}
            className="touch:min-h-11 shrink-0 rounded-full px-1.5 py-1 text-[length:var(--fs-9)] leading-none text-[color:var(--billet-accent)]"
          >
            {sort.asc ? "▲" : "▼"}
          </button>
        </span>

        <FiltersKey
          open={trayOpen}
          count={facets}
          onPress={() => onTrayOpen(!trayOpen)}
          controls={trayId}
          className="shrink-0"
        />
      </div>

      <CollapseTray
        id={trayId}
        open={trayOpen}
        className="w-full"
        closedClassName="-mt-[5px] lg:-mt-2"
      >
        <div className={`${CONSOLE_WELL} flex flex-col gap-[0.4375rem] p-2`}>
          <FacetRow label="Pos">
            <FacetChip
              label="All"
              count={rows.length}
              on={filters.positions.length === 0}
              onPick={() => set({ positions: [] })}
            />
            {STAT_POSITIONS.map((value) => (
              <FacetChip
                key={value}
                label={value}
                count={positions.get(value) ?? 0}
                on={filters.positions.includes(value)}
                onPick={() =>
                  set({ positions: toggleFacet(filters.positions, value) })
                }
              />
            ))}
          </FacetRow>

          <FacetGroove />

          <FacetRow label="Team">
            {/* A `<select>` rather than 32 chips, and it *adds* rather than
                selects: a native multiple-select is a scrolling list box on
                every platform and a chip row of 32 is the tray's whole height.
                Chosen teams come back out as removable chips, so what is
                narrowed is readable without opening the menu. */}
            <select
              aria-label="Add an NFL team"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  set({ teams: toggleFacet(filters.teams, e.target.value) });
              }}
              className={`${CONSOLE_KEY_PILL} appearance-none border-foreground/10 bg-[image:var(--key-bg)] px-[0.5625rem] py-[0.3125rem] text-[length:var(--fs-10)] tracking-[0.1em] text-foreground/75 shadow-[var(--key-shadow)]`}
            >
              <option value="">+ Add team</option>
              {teams.map(([value, count]) => (
                <option
                  key={value}
                  value={value}
                  disabled={filters.teams.includes(value)}
                >
                  {value} · {count}
                </option>
              ))}
            </select>

            {filters.teams.map((value) => (
              <button
                key={value}
                type="button"
                title={`Remove ${value}`}
                onClick={() =>
                  set({ teams: toggleFacet(filters.teams, value) })
                }
                className={`${CONSOLE_KEY_PILL} inline-flex items-center gap-1.5 border-active/45 bg-[image:var(--key-bg)] px-[0.5625rem] py-1 text-[length:var(--fs-10)] tracking-[0.14em] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]`}
              >
                {value}
                <span className="tabular-nums text-foreground/45">
                  {teamCounts.get(value) ?? 0}
                </span>
                <span
                  aria-hidden
                  className="text-[length:var(--fs-9)] text-foreground/55"
                >
                  ✕
                </span>
              </button>
            ))}

            {filters.teams.length === 0 && (
              // Read off the options rather than written down: a literal here
              // is a claim, and it drifts the first time the population does.
              <span className="font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-foreground/36">
                All {teams.length} teams
              </span>
            )}
          </FacetRow>

          {/* How far through his game is, on the six-stop scale
              `STAT_STAGES` names. The window prints the stops rather than
              their indices — a readout reading `1–5` would be a control whose
              two ends name nothing on the board it narrows. */}
          <RangeRow
            label="Clock"
            noun="game clock"
            bounds={STAT_STAGE_BOUNDS}
            span={filters.clock ?? STAT_STAGE_BOUNDS}
            onChange={(clock) => set({ clock })}
            format={(value) => STAT_STAGES[value] ?? ""}
          />

          <FacetGroove />

          {/* The page-scope narrowing, and the tray's one facet that is a
              question about the reader's own week rather than about the NFL's.
              See `StatBoardFilters.usage` for why these AND where one player's
              own four keys cannot. */}
          <FacetRow label="Used">
            {USAGE_KEYS.map((key) => (
              <FacetChip
                key={key}
                label={USAGE_LABEL[key]}
                count={usageCounts[key]}
                on={filters.usage.includes(key)}
                onPick={() => set({ usage: toggleFacet(filters.usage, key) })}
              />
            ))}
          </FacetRow>

          <FacetFoot
            summary={statFilterSummary(filters)}
            active={facets > 0}
            onClear={() =>
              set({ positions: [], teams: [], clock: null, usage: [] })
            }
          />
        </div>
      </CollapseTray>
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
  onSort,
  picked,
  onPick,
  reading,
  onPressCount,
  narrowed,
}: {
  rows: readonly RankedStatRow[];
  columns: readonly StatColumn[];
  population: readonly number[];
  sort: StatSort;
  onSort: (sort: StatSort) => void;
  picked: string | null;
  onPick: (id: string) => void;
  /** Which reading the pane is on — what lights one of the picked row's wells. */
  reading: PlayerReading;
  onPressCount: (id: string, key: UsageKey) => void;
  narrowed: boolean;
}) {
  const track = statTrackWidth(columns);
  const empty = rows.length === 0;
  return (
    <div className={`${CONSOLE_GLASS} flex min-h-0 flex-1 flex-col rounded-xl`}>
      <Scanlines />
      {empty ? (
        <p className="relative z-[1] px-3 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
          {narrowed
            ? "No player matches that narrowing."
            : "No scoring lines this week yet."}
        </p>
      ) : (
        <>
          {/* The wide arm scrolls in both axes; its head and its two edge
              columns are `sticky` against this one scroller. */}
          <div className="lab-scroll-glass relative z-[1] hidden min-h-0 flex-1 overflow-auto p-[3px] lg:block">
            <div
              role="table"
              aria-label="Player scores"
              style={{ width: track }}
            >
              <Head
                columns={columns}
                sort={sort}
                onSort={onSort}
                track={track}
              />
              {rows.map((row) => (
                <WideRow
                  key={row.player_id}
                  row={row}
                  columns={columns}
                  track={track}
                  population={population}
                  picked={picked === row.player_id}
                  litCount={
                    picked === row.player_id && reading !== "all"
                      ? reading
                      : null
                  }
                  onPick={onPick}
                  onPressCount={onPressCount}
                />
              ))}
            </div>
          </div>
          <ul className="lab-scroll-glass relative z-[1] m-0 min-h-0 flex-1 list-none overflow-y-auto p-[3px] lg:hidden">
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
  );
}

/**
 * The head: two tiers in one sticky block, and **the second is the sort**.
 *
 * **No `overflow-hidden` on the block**, which is this board's own recorded
 * finding rather than a style: an `overflow` other than `visible` makes an
 * element a scroll container, so the two cells pinned inside it would stick to
 * *the head* — which is exactly as wide as the grid — and therefore not move
 * at all. The radius goes on the corner cells instead, which is what the clip
 * was doing the rest of its work for.
 *
 * **Every head is a `<button>` and the `Sort` cap rail is gone.** This note
 * used to say the opposite — that sorting lived in the ledge and a pressable
 * head would be a second control for one fact "with no way to show the
 * direction the caps cannot express". The direction is the reason it reversed:
 * a rail can light one of six caps and has nowhere to put an arrow, so every
 * ordering on the old board was descending and the name was not offered at
 * all. A head can carry both, and it carries them over the column it is the
 * head *of*, so the vocabulary cannot name an ordering the row could not show.
 *
 * The lit head takes the accent and an arrow; every other is the quiet label
 * ink. The upper tier is untouched by any of it — a family span is not an
 * ordering, and lighting three heads under one word would claim three.
 */
function Head({
  columns,
  sort,
  onSort,
  track,
}: {
  columns: readonly StatColumn[];
  sort: StatSort;
  onSort: (sort: StatSort) => void;
  track: number;
}) {
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
      {/* Tier two: the columns themselves, each of them the sort control. */}
      <div className="flex h-[30px] items-center border-t border-[color:var(--milled-hairline)]">
        {statHeads(columns).map((head) => (
          <HeadCell key={head.key} head={head} sort={sort} onSort={onSort} />
        ))}
      </div>
    </div>
  );
}

/**
 * One head, pressed.
 *
 * **`aria-sort` carries the state and the label carries the invitation**, which
 * is the pair a sortable column head owes: the role says which way the list is
 * ordered by this column, and the accessible name says what a press would do
 * — `Sort by Passing yards` unlit, and `…, sorted descending — press to
 * reverse` lit, so nobody has to press one to find out it is already in force.
 *
 * The arrow is drawn **only on the lit head**, which is the whole of why the
 * two pinned edges can carry it at all: an arrow on every head is thirteen
 * claims about one ordering.
 */
function HeadCell({
  head,
  sort,
  onSort,
}: {
  head: StatHead;
  sort: StatSort;
  onSort: (sort: StatSort) => void;
}) {
  const lit = sort.key === head.key;
  return (
    /* **The `columnheader` is the cell and the press is inside it.** Putting
       the role on the `<button>` would override the button role, so a screen
       reader would announce a column header and never say it could be pressed
       — and `aria-sort` belongs on the header either way. */
    <span
      role="columnheader"
      aria-sort={lit ? (sort.asc ? "ascending" : "descending") : undefined}
      style={{ flex: `0 0 ${head.width}px` }}
      /* **`min-w-0`, or a head stretches its own column.** A flex item's
         `min-width` is `auto`, which is its content — so a head whose word is
         wider than its track grows past it and takes every column after it out
         from under its own head, with every figure on the board correct and
         every one of them under the wrong word. It is the same mismatch
         `statGroupSpans` is derived to prevent, one tier down, and a render is
         what caught it. */
      className={`${PIN_HEAD[head.pin ?? "none"]} h-full min-w-0 ${
        head.pin === "left" ? "rounded-bl-[7px]" : ""
      } ${head.pin === "right" ? "rounded-br-[7px]" : ""}`}
    >
      <button
        type="button"
        aria-label={
          lit
            ? `${head.hint}, sorted ${sort.asc ? "ascending" : "descending"} — press to reverse`
            : `Sort by ${head.hint}`
        }
        onClick={() => onSort(nextStatSort(sort, head.key))}
        className={`${HEAD_CELL} w-full cursor-pointer gap-1 border-0 bg-transparent ${
          head.align === "left"
            ? "justify-start px-2.5"
            : "justify-end pl-1 pr-2"
        } ${head.pin === "right" ? "pr-3" : ""} ${
          lit
            ? "text-[color:var(--billet-accent)]"
            : "text-[color:var(--billet-label)]"
        }`}
      >
        <span className="min-w-0 truncate">{head.label}</span>
        {lit && (
          <span
            aria-hidden
            className="shrink-0 text-[length:var(--fs-8)] tracking-normal"
          >
            {sort.asc ? "▲" : "▼"}
          </span>
        )}
      </button>
    </span>
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
 * **The player cell is the press and the four count wells are four more**,
 * which is what the row could not be while the whole of it was one button: a
 * `<button>` inside a `<button>` is invalid and unreachable, so the row's own
 * press had to give up its outer target the moment a well became pressable.
 * The player cell is where a reader aims anyway — it is the column that names
 * the row, it is pinned, and it is 258px of the track.
 *
 * The well around it stays a plain box, because a channel and its own press
 * are two things and a `<button>` cannot carry the row's `margin-bottom`
 * without the gap becoming part of the target.
 *
 * **Memoised on what it prints**, which the live half of this page makes worth
 * doing: a frame lands every twenty seconds and the table is nineteen cells a
 * row, so a hundred rows re-rendering to move the two whose figures changed is
 * the cost `GametimeCard`'s own memo discipline exists to avoid. Every prop is
 * a value or a stable callback by construction — `litCount` is the row's own
 * reading of the board's one `cellPick` rather than the pair itself, so a
 * press on one row leaves every other row's props identical.
 */
const WideRow = memo(function WideRow({
  row,
  columns,
  track,
  population,
  picked,
  litCount,
  onPick,
  onPressCount,
}: {
  row: RankedStatRow;
  columns: readonly StatColumn[];
  track: number;
  population: readonly number[];
  picked: boolean;
  /** Which of this row's four wells is lit, or null for none of them. */
  litCount: UsageKey | null;
  onPick: (id: string) => void;
  onPressCount: (id: string, key: UsageKey) => void;
}) {
  // A row is lit by either gesture: the pane is reading him, or the grid is
  // narrowed by one of his readings. The two are one halo.
  const lit = picked || litCount !== null;
  return (
    <div
      role="row"
      className={`${CONSOLE_ROW_WELL} mb-[3px] flex h-[38px] items-stretch rounded-[7px] ${
        lit
          ? "shadow-[var(--row-well-shadow),0_0_24px_-10px_var(--accent-glow)]"
          : ""
      }`}
      style={{ width: track }}
    >
      {/* The press is inside the cell rather than being it, on `HeadCell`'s
          rule one tier up: `role="cell"` on the `<button>` would take the
          button role off it. */}
      <span
        role="cell"
        style={{ flex: `0 0 ${STAT_FIXED.player}px` }}
        className={`flex min-w-0 rounded-l-[7px] ${PIN_ROW.left}`}
      >
        <button
          type="button"
          /* **`aria-current`, not `aria-pressed`.** The rows are a
           single-selection set with no deselect, so the picked one is *the
           current item* rather than a toggle somebody left down. The phone arm
           says it the same way for the same reason. */
          aria-current={picked ? "true" : undefined}
          onClick={() => onPick(row.player_id)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-l-[7px] border-0 bg-transparent px-2.5 text-left outline-offset-[-2px]"
        >
          <span
            aria-hidden
            className="inline-flex w-[18px] shrink-0 justify-end font-mono text-[length:var(--fs-10)] tabular-nums text-[color:var(--readout-label)]"
          >
            {row.rank}
          </span>
          <PlayerBadge row={row} lit={lit} />
          <span
            className={`min-w-0 flex-1 truncate font-display text-[length:var(--fs-13)] tracking-[-0.005em] ${
              picked
                ? "font-semibold text-readout [text-shadow:var(--readout-text-glow)]"
                : "text-foreground/85"
            }`}
          >
            {row.name ?? row.player_id}
          </span>
          <span
            className={`shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.08em] ${POSITION_INK(row)}`}
          >
            {row.position}
          </span>
          {row.team && (
            <span className="shrink-0 font-mono text-[length:var(--fs-9)] tracking-[0.08em] text-[color:var(--readout-muted)]">
              {row.team}
            </span>
          )}
        </button>
      </span>
      {/* `CIN @BAL` over the clock: the matchup is what a reader needs to place
          a figure, and the two read as one cell rather than a column each. */}
      <span
        role="cell"
        style={{ flex: `0 0 ${STAT_FIXED.game}px` }}
        className="flex min-w-0 flex-col items-end justify-center gap-px overflow-hidden pl-0.5 pr-2.5"
      >
        <span className="max-w-full truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.06em] text-[color:var(--readout-muted)]">
          {matchup(row)}
        </span>
        <span className={`whitespace-nowrap ${CLOCK} ${clockInk(row)}`}>
          {row.clock.text}
        </span>
      </span>
      {columns.map((column) => (
        <Figure key={column.key} width={column.width} value={row[column.key]} />
      ))}
      {USAGE_KEYS.map((key) => (
        <CountWell
          key={key}
          row={row}
          usage={key}
          lit={litCount === key}
          onPress={onPressCount}
        />
      ))}
      <span
        role="cell"
        style={{ flex: `0 0 ${STAT_FIXED.points}px` }}
        className={`flex items-center justify-end rounded-r-[7px] px-2 ${PIN_ROW.right}`}
      >
        <PointsFigure points={row.points} population={population} />
      </span>
    </div>
  );
});

/**
 * The 22px mount at the head of a row — a headshot with the initial behind it.
 *
 * **Not `Avatar`, and not an `<img>`.** That component draws *either* a face
 * *or* a letter, where this wants the letter **behind** the face; and a broken
 * `<img>` paints the platform's own placeholder glyph over the fallback even
 * at `alt=""`, where a background image that 404s paints nothing and the
 * letter underneath is exactly the fallback it was put there to be. It is
 * `PaneRowFaceMount`'s rule, drawn on this board's own surface: a bezel on
 * lit glass rather than a well milled into metal.
 *
 * `bg-top`, never `bg-center` — a Sleeper headshot is framed head and
 * shoulders and a centred crop of one in a 22px disc is a chin.
 */
function PlayerBadge({ row, lit }: { row: StatRow; lit: boolean }) {
  const initial = (row.name ?? row.player_id).trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden
      className={`relative inline-flex size-[22px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-foreground/12 bg-[image:var(--bezel-bg)] font-display text-[length:var(--fs-10)] font-semibold shadow-[var(--bezel-shadow)] ${
        lit ? "text-readout" : "text-foreground/68"
      }`}
    >
      {initial}
      <span
        className="absolute inset-0 bg-cover bg-top"
        style={{
          backgroundImage: `url(https://sleepercdn.com/content/nfl/players/thumb/${row.player_id}.jpg)`,
        }}
      />
    </span>
  );
}

/**
 * One of the four counts, in a figure well that is also a button.
 *
 * **This is the board's one narrowing gesture**, and it is what the four
 * readings became: they were chips a row printed and nothing could act on,
 * then caps on the ledge asked of the whole population, and they are now a
 * column each — pressed on the row a reader is actually looking at. A press
 * lights the well, picks the row, puts the pane's track on that reading and
 * narrows the grid behind to the leagues it names.
 *
 * `--tag-lit-shadow` is `--figure-well-shadow` plus an accent ring and glow,
 * composed in CSS rather than appended here: a shadow list is atomic, so a
 * second `shadow-[…]` would replace the chamfer rather than add to it. Hence
 * the shell, which carries no shadow of its own.
 *
 * The inks are the four readings' own: the reader's starters are the accent,
 * their bench is the amber this app spends on "neither", and the opposing pair
 * is the quiet line ink — the same vocabulary the pane's group headers use.
 *
 * **A player nobody holds prints an em dash and does not toggle.** `held`
 * decides it rather than the count, because a held player nobody started is a
 * real nought where one their leagues have never heard of is an absence — and
 * there is no league of the reader's for his well to narrow to.
 */
function CountWell({
  row,
  usage,
  lit,
  onPress,
}: {
  row: StatRow;
  usage: UsageKey;
  lit: boolean;
  onPress: (id: string, key: UsageKey) => void;
}) {
  const count = USAGE_COUNT[usage](row);
  const name = row.name ?? row.player_id;
  return (
    <span
      role="cell"
      style={{ flex: `0 0 ${STAT_FIXED.count}px` }}
      className="flex items-center justify-end px-[3px]"
    >
      <button
        type="button"
        aria-pressed={lit}
        aria-disabled={row.held ? undefined : true}
        aria-label={
          row.held
            ? `${USAGE_LABEL[usage]} — ${name}`
            : `${name} is in none of your leagues`
        }
        onClick={() => {
          if (row.held) onPress(row.player_id, usage);
        }}
        className={`${CONSOLE_FIGURE_WELL_SHELL} relative flex flex-1 items-center justify-end border-0 px-[7px] py-0.5 ${
          row.held ? "cursor-pointer" : "cursor-default"
        } ${lit ? "shadow-[var(--tag-lit-shadow)]" : "shadow-[var(--figure-well-shadow)]"}`}
      >
        <span
          className={`relative font-mono text-[length:var(--fs-12)] tabular-nums ${
            !row.held
              ? "text-[color:var(--stat-zero-ink)]"
              : lit
                ? "text-readout [text-shadow:var(--readout-text-glow)]"
                : COUNT_INK[usage]
          }`}
        >
          {row.held ? (count ?? 0) : EM_DASH}
        </span>
      </button>
    </span>
  );
}

/**
 * A record over the four readings — exhaustive, so a fifth breaks the compile
 * here rather than rendering an unstyled figure.
 */
const COUNT_INK: Record<UsageKey, string> = {
  start: "text-readout",
  bench: "text-[color:var(--median-ink)]",
  "opp-start": "text-[color:var(--readout-line)]",
  "opp-bench": "text-[color:var(--readout-line)]",
};

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
        zero
          ? "text-[color:var(--stat-zero-ink)]"
          : "text-[color:var(--readout-line)]"
      }`}
    >
      {zero ? EM_DASH : value}
    </span>
  );
}

/**
 * The clock, in the two inks a game has.
 *
 * A finished game takes `--stat-zero-ink`, which is **deliberately below the
 * 4.5:1 text floor** and is this board's own treatment carried over rather than
 * a slip: what a reader is scanning a column of clocks for is the games still
 * running, and a final score that read as loudly as a live one would bury them.
 */
/**
 * The clock, on both arms.
 *
 * **Untracked, where the design spells `0.04em`**, and it is spent rather than
 * dropped: `Sun 12:00 PM` — what this app prints for an afternoon kickoff in
 * an en-US locale — is 89px with it and 83.5 without, against the 90 a
 * `STAT_FIXED.game` cell leaves. Tracking is the first thing to spend on a
 * column that would otherwise clip, which is this repo's own rule for the
 * lineup checker's `Kick` column and for this card's window labels one plane
 * up; the rest of the 11px went to the track. At `--fs-10` in mono it is half
 * a pixel a glyph, and what it buys is the day of the week.
 */
const CLOCK = "font-mono text-[length:var(--fs-10)] uppercase";

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
  const families = statFamilies(row);
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
            {/* **A family wraps inside itself rather than clipping.** The
                well is `flex-wrap`, so a group that does not fit takes a line
                of its own — and a dual-threat quarterback's passing group is
                wider than the whole well at 390 now that the volume figures
                are in it (`24 cmp · 35 att · 288 yd · 3 td · 1 int`), so a
                line of its own is not enough. Left `shrink-0` it overflowed
                the well's own `overflow-hidden` by ~23px and the interception
                simply was not there, with nothing on screen saying so. Wrapped
                it costs the row a line on the handful of lines long enough to
                need one, and the separators make the break read as a break.
                It is the rule this file keeps at three other grains: a
                truncation loses the clause, a wrap loses only the space. */}
            {families.map((family) => (
              <span
                key={family.key}
                className="inline-flex min-w-0 items-baseline gap-[0.3125rem]"
              >
                <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
                  {PHONE_FAMILY[family.key]}
                </span>
                <span className="min-w-0 font-mono text-[length:var(--fs-10)] tabular-nums text-[color:var(--readout-line)]">
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
            {statFamilies(row).map((family) => (
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
