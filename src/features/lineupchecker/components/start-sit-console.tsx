"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  BilletFinish,
  canonicalReadings,
  CONSOLE_CHANNEL_METAL,
  CONSOLE_CHIP_TRAY,
  CONSOLE_GLASS,
  CONSOLE_KEY_PILL_BARE,
  CONSOLE_MILLED_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_WINDOW,
  CONSOLE_WINDOW_LEDGE,
  CONSOLE_WINDOW_SHELL,
  DecisionsList,
  decisionsFor,
  ReadingKeys,
  Scanlines,
  storeStartSitConsoleOpen,
  subjectCount,
  subjectSlot,
  toggleSubject,
  toggleSubjectReading,
  useStartSitConsoleOpen,
  weekTwoSidedShares,
  type LeagueSubjects,
  type WeekLineupEntry,
  type WeekReading,
  type WeekTwoSidedShare,
} from "@/features/shared";

/**
 * **Start / sit**: every player a week's lineups fielded, either side, and what
 * the seat opposite him did — as one console at the foot of the page.
 *
 * This replaces a side drawer. `WeekSharesDrawer` was a native modal
 * `<dialog>` opened from a `BrowseDock` key pinned bottom-right, and what was
 * wrong with it was not its content but what a modal *is*: the whole point of
 * picking a row here is that it narrows the league grid, and a backdrop over
 * that grid meant the reader pressed a subject and then dismissed the panel to
 * see what it had done. The console is **non-modal by design** — no backdrop,
 * no focus trap, no `showModal()` — so the grid re-filters, `SubjectTokens`
 * grows a chip, the header's projected record and its dial recompute and the
 * attention strip follows, all while the panel is still up. That is the entire
 * argument for the part, and it is the argument `SharesConsole`'s own module
 * note already makes one page over.
 *
 * It is that console with start/sit content in it: the case, the bar's
 * absolute toggle, the ledge, the list/detail split and the phone arrangement
 * are all that component's, so a reader who has used one has used the other.
 *
 * **What differs is the bar, and it differs because the population does.** The
 * manager console's bar carries `Players` / `Leaguemates` caps in a channel;
 * start/sit is one population over one week, so the channel has nothing to
 * switch between and the bar carries the title, the readout, the `Held` count
 * and the caret. A channel holding one cap is a control that cannot be
 * pressed.
 *
 * **The body is mounted only while the console is up** (`open &&`), which is
 * `usePanelCap`'s `mounted` one component over and for its reason: a list that
 * runs to a thousand-odd rows behind a control most readers never press is a
 * document the page pays for on every render, and this page re-renders on
 * every line of the leagues stream.
 *
 * ## The population rule, which survives the move verbatim
 *
 * **Every fold here is taken over the league-filtered, subject-*un*narrowed
 * list.** Folded over the selection instead, every row would collapse to the
 * row just picked the moment it was picked, and could not be widened again
 * without clearing first — the rule `weekTwoSidedShares` states in full and the
 * one `facetsQuery` already enforces for the trades board's own menus. The
 * page hands it `entries` for exactly this.
 */

/**
 * The collapsed bar's own height, as the classes that declare it.
 *
 * **One spelling, because the page's own layout has to clear it.** The console
 * is `fixed` to the foot of the viewport and the league grid's bottom margin is
 * measured against it — see `lineup-checker-home.tsx`, which puts this on the
 * page root so both read the same number. A height written twice is a last card
 * under the bar the first time either moves.
 *
 * Whole class strings rather than a value interpolated into one: Tailwind finds
 * classes by scanning source text, so `[--startsit-bar-h:${n}]` would generate
 * nothing at all. It is `SHARES_BAR_H`'s rule and `STAT_BAR_H`'s before it.
 */
export const START_SIT_BAR_H =
  "[--startsit-bar-h:3rem] sm:[--startsit-bar-h:3.25rem]";

/* ------------------------------------------------------------------ */

/**
 * What the rows are ordered by.
 *
 * The five columns on screen, plus `fielded` — which is no column at all but
 * the sum of the four counts, and therefore **exactly what a press on a row
 * narrows to**: every league that fielded him, either side, which is what an
 * unrefined `week` subject means. So the rail can order the list by the thing
 * the row's own press is about, which no single column can say.
 *
 * That is also why `Start` is the default rather than `Fielded`: the panel's
 * first question is the reader's own lineups, which is the order the drawer
 * this replaces opened on (`defaultSort="start"`) and the order
 * `weekTwoSidedShares` already returns its players in.
 */
type SortId = WeekReading | "figure" | "fielded";

/** The four counts, in the order the cells and the tray's keys are drawn. */
const READING_COLUMNS: readonly WeekReading[] = [
  "start",
  "bench",
  "opp-start",
  "opp-bench",
];

/**
 * What each column is called **over its cells**.
 *
 * `Opp St` and `Opp Bn` are tight because they have to fit the cell's own
 * `3.5rem`; the Sort rail spells both out. A head says what is in the cell and
 * the rail says what a press orders by, and the rail has the room — which is
 * `SharesConsole`'s own split between `COLUMN_LABEL` and `SORT_LABEL`.
 */
const COLUMN_LABEL: Record<WeekReading, string> = {
  start: "Start",
  bench: "Bench",
  "opp-start": "Opp St",
  "opp-bench": "Opp Bn",
};

/**
 * And over a phone bay, where one caption says a whole side.
 *
 * **No letter-spacing, and that is a measurement rather than a preference.** At
 * 360 the caption track is 111px and `Opp start / bench` measures exactly 111px
 * at `--fs-8` with `tracking-normal`; any tracking at all truncates the one
 * word that says which side the two figures under it belong to. Every other
 * mono label on this console is tracked, so this is the exception and the
 * reason it is an exception is the number.
 */
const BAY_CAPTION = {
  mine: "Start / bench",
  opp: "Opp start / bench",
} as const;

/** And on the rail, where there is room for the whole word. */
const SORT_LABEL: Record<WeekReading, string> = {
  start: "Start",
  bench: "Bench",
  "opp-start": "Opp start",
  "opp-bench": "Opp bench",
};

/**
 * The cells' widths, which are the design's and are fixed rather than fluid.
 *
 * A figure column that grew with the pane would set at a different width on
 * every row list, and the two panes' rows are read across each other. The
 * figure's is wider than the four counts' because it carries a decimal.
 */
const COLUMN_WIDTH: Record<WeekReading | "figure", string> = {
  start: "3.5rem",
  bench: "3.5rem",
  "opp-start": "3.5rem",
  "opp-bench": "3.5rem",
  figure: "3.75rem",
};

/**
 * The phone arm's two bays, in the order {@link READING_COLUMNS} declares.
 *
 * **Sliced from that list rather than spelled again**, so the pair a bay holds
 * and the order the cells and the tray's keys are drawn in cannot come apart —
 * a bay captioned `Start / bench` printing the opposing pair is a perfectly
 * ordinary row saying something untrue. Module level, so the two arrays are one
 * identity for the life of the process rather than a pair rebuilt per row.
 */
const READING_BAYS = [
  { caption: BAY_CAPTION.mine, readings: READING_COLUMNS.slice(0, 2) },
  { caption: BAY_CAPTION.opp, readings: READING_COLUMNS.slice(2) },
] as const;

/** Nothing folded yet — one identity, so a memo sees one object. */
const NO_ROWS: ConsoleRow[] = [];
/** Module-level identities, so a shut tray and an unnarrowed row hand the same. */
const NO_READINGS: readonly WeekReading[] = [];
const NO_TRAYS: ReadonlySet<string> = new Set<string>();

/**
 * One row of the list, folded once per row list.
 *
 * **Its identity is what `Row`'s memo compares**, so it is built per list
 * rather than per render: a fresh one per keystroke would re-render a thousand
 * rows to narrow to ten. The two derived strings are here for the same reason —
 * lower-casing a name and spelling a slot are per-row costs the search and the
 * selection would otherwise pay on every render.
 *
 * What is emphatically **not** on it is the row's picked readings: those move
 * with the *selection* rather than with the list, so folding them in would
 * rebuild every row on every press of a tray key. They arrive as a prop, off a
 * map memoised on the selection — `SharesDrawer.litCells`' own argument.
 */
type ConsoleRow = {
  id: string;
  name: string;
  /** `WR · CIN`, or the half of it the feed answered for, or null. */
  note: string | null;
  /** His first listed position — the badge, and `—` where there is none. */
  position: string;
  started: number;
  benched: number;
  oppStarted: number;
  oppBenched: number;
  /** Null where the counted leagues disagree — see `WeekTwoSidedShare.figure`. */
  figure: number | null;
  /** Every league he was fielded in, either side: what a row's press narrows to. */
  fielded: number;
  /** `SF · fielded in 46` — the phone subline. See the fold for why not `note`. */
  sub: string;
  /** The name, lower-cased once, for the search. */
  search: string;
  /** This row's `subjectSlot`, for the selection. */
  slot: string;
};

/* ------------------------------------------------------------------ */

export function StartSitConsole({
  entries,
  week,
  leagueTotal,
  filterSummary,
  figureLabel,
  pending,
  subjects,
  onSubjects,
  onExpand,
  chromeClass = "",
}: {
  /** League-filtered, subject-unnarrowed — see the module note. */
  entries: readonly WeekLineupEntry[];
  /** The week these calls are of, for the population readout. */
  week: number | null;
  /** Every league on the page, for that readout's denominator. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  /**
   * What every figure in this panel is, in a window's worth of characters —
   * `Proj` on the lineup checker, `Live` on gametime.
   *
   * **The prop survives the move even though one page mounts this**, because
   * the panel it is a prop of does not: `DecisionsList` under it is the shared
   * one, and three characters is the only thing on screen that says which of
   * two scales a reader is looking at. It is the head of the figure column and
   * the label in the detail's window, so a second spelling of it would be two
   * words for one number on one screen.
   */
  figureLabel: string;
  /** The check has not landed yet — a different state from having no rows. */
  pending: boolean;
  subjects: LeagueSubjects;
  /**
   * Edit the selection whole.
   *
   * A reducer rather than a callback per press, because every one of those
   * edits is `league-subjects.ts`'s to spell and this component's job is to say
   * *which* of them a press means — the drawer's own arrangement, and the page
   * still owns the state.
   */
  onSubjects: (next: (prev: LeagueSubjects) => LeagueSubjects) => void;
  /**
   * Expanding closes an open card.
   *
   * A parked card *is* the screen — the page is locked and every league but the
   * open one is `display: none` — so there is no grid behind the panel to
   * narrow. It is `openDrawer`'s own argument on this page, and `LeaguesHome`'s
   * before it; a press with no card open is a no-op on that half.
   */
  onExpand: () => void;
  /**
   * The page's own stand-down class.
   *
   * The console is `fixed`, so it takes no part in the parked-card layout — but
   * a parked card is sized to the fold less a few pixels of breath, and a 52px
   * bar over its foot would cover the drawer bars at the bottom of its panes. A
   * parked card is the screen and the page's chrome steps back for it; the rack
   * stays, because the rack is the *app's* chrome rather than this page's.
   */
  chromeClass?: string;
}) {
  const open = useStartSitConsoleOpen();

  /**
   * The console's own reading state, none of it persisted.
   *
   * These are ways of reading a list rather than device preferences — the call
   * `SharesDrawer` already made about `sort` and `SharesConsole` about all of
   * its. What *is* remembered is the open flag, which is a place to be rather
   * than a question asked; see `start-sit-console-open`.
   */
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("start");
  /**
   * The row the decisions pane is reading.
   *
   * **A pick is not a narrowing**, which is the one behaviour that differs from
   * the drawer this replaces: there, pressing a row *was* the subject. Here it
   * opens the pane, and the `Narrow grid` key inside it is what edits the grid
   * — which is what keeps "what am I looking at" and "what is the grid filtered
   * to" two states a reader can hold at once.
   */
  const [picked, setPicked] = useState<string | null>(null);
  /**
   * The counterpart card that is open, or null for none.
   *
   * **Opening one does not take the others off the pane.** It used to — the
   * press narrowed the list to that one pairing — which was worth it while
   * every card carried its league rows and the list was mostly rows. The cards
   * open shut now (see `DecisionsList`), so the list of counterparts *is* the
   * thing a reader scans, and hiding it on a press would send them `Back` to
   * compare two. What the open card still does is narrow the ledge: its line
   * and its figure read that pairing's own leagues, which is what makes the
   * figure answerable at all — see `narrowed` below.
   */
  const [combo, setCombo] = useState<string | null>(null);
  /**
   * Which rows have their tray of narrowing keys open.
   *
   * Per row, and deliberately not persisted: it is a way of reading the list,
   * the call `sort` already makes. It survives a collapse only as far as the
   * component does, which is the page's life — a reader who reopens the console
   * finds the trays they left open.
   */
  const [trays, setTrays] = useState<ReadonlySet<string>>(NO_TRAYS);

  /**
   * The query and the pick are cleared when the console closes, and the
   * selection is not.
   *
   * Every route out of the drawer cleared the query and the detail view too;
   * the *selection* is the narrowing on the grid behind, which outlives the
   * panel by design and is named and undone by `SubjectTokens`. The pick goes
   * with the query because a decisions pane is only ever read while the panel
   * is up.
   *
   * **Adjusted during render rather than in an effect**, which is this page's
   * own idiom and the rule `react-hooks/set-state-in-effect` enforces: a
   * `setState` in an effect body is a second render after paint, so the panel
   * would fold with its old query still in it for a frame. React re-runs this
   * component before committing, so the clear is part of the render that saw
   * the console go down.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setPicked(null);
      setCombo(null);
    }
  }

  /**
   * Esc collapses the console.
   *
   * The one keyboard affordance to add, and the only one: this is not a
   * `<dialog>`, so there is nothing to cancel and nothing gives it back for
   * free. It listens only while up, so it cannot swallow an Escape meant for
   * the league filters dialog or a card.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") storeStartSitConsoleOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleConsole = useCallback(() => {
    if (!open) onExpand();
    storeStartSitConsoleOpen(!open);
  }, [open, onExpand]);

  /* ---------------- the folds, released while shut ---------------- */

  /**
   * **Released while the console is down**, on the drawer's own terms: this
   * component is mounted for the page's life (the grid's subject narrowing
   * needs the maps behind it) and a `useMemo` holds its last value for as long
   * as it is. That is a share per player and a row apiece, every one of them
   * display work for a panel nobody is looking at.
   *
   * **What narrows the grid is untouched**, which is what makes it safe: that
   * reads `weekSubjectRolls` off the same entries, in the page, and never these.
   */
  const shares = useMemo(
    () => (open ? weekTwoSidedShares(entries) : null),
    [open, entries],
  );

  const players = useMemo(() => shares?.players ?? [], [shares]);
  const counted = shares?.starter_league_count ?? 0;
  const opponents = shares?.opponent_league_count ?? 0;

  const all = useMemo<ConsoleRow[]>(() => {
    if (!shares) return NO_ROWS;
    return players.map((player) => {
      const fielded =
        player.started + player.benched + player.oppStarted + player.oppBenched;
      return {
        id: player.player_id,
        name: player.name,
        position: player.position ?? "—",
        // **`filter(Boolean)` rather than a template**, which is what stops a
        // player with no stored team reading as `WR · ` — a dangling separator
        // promising a fact that is not there.
        note: [player.position, player.team].filter(Boolean).join(" · ") || null,
        // The phone arm's subline, and it is a *different sentence* rather than
        // a narrower `note`: the position moved into the bezel there, so
        // repeating it would say it twice, and what the line has room for
        // instead is the count the row's own press narrows to. The same
        // `filter(Boolean)` rule — a player with no stored team reads
        // `fielded in 12` rather than carrying a dangling separator.
        sub: [player.team, `fielded in ${fielded}`].filter(Boolean).join(" · "),
        started: player.started,
        benched: player.benched,
        oppStarted: player.oppStarted,
        oppBenched: player.oppBenched,
        figure: player.figure,
        fielded,
        search: player.name.toLowerCase(),
        slot: subjectSlot({ kind: "week", id: player.player_id }),
      };
    });
  }, [shares, players]);

  // Keyed by slot, on `SharesDrawer.chosen`'s rule: a row is one narrowing
  // however it is refined, so the panel looks it up by the row rather than by
  // the readings inside it.
  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectSlot)),
    [subjects],
  );

  /**
   * The readings picked on each row, by player id.
   *
   * Built once per selection rather than searched per row per render: the row
   * list runs to a thousand on a full account and every row asks this question.
   * The arrays are stable for as long as the selection is, which is what lets a
   * `memo`'d row take one as a prop.
   */
  const readings = useMemo(() => {
    const map = new Map<string, readonly WeekReading[]>();
    for (const subject of subjects.subjects) {
      if (subject.kind !== "week") continue;
      const held = canonicalReadings(subject.readings);
      if (held.length > 0) map.set(subject.id, held);
    }
    return map;
  }, [subjects]);

  /**
   * The search, deferred, so a keystroke does not block on re-sorting a
   * thousand rows — the drawer's own call.
   */
  const needle = useDeferredValue(query).trim().toLowerCase();
  const rows = useMemo(() => {
    const found = needle
      ? all.filter((row) => row.search.includes(needle))
      : all;
    return [...found].sort((a, b) => {
      const left = weightOf(a, sort);
      const right = weightOf(b, sort);
      // **Absent sorts last in either direction.** A player the counted
      // leagues disagree about has no figure rather than the lowest one, and
      // there is no direction a reader could flip to make him the highest.
      // Only `figure` can be null; the four counts are zero at worst.
      if (left === null && right === null) {
        return NAME_ORDER.compare(a.name, b.name);
      }
      if (left === null) return 1;
      if (right === null) return -1;
      // **Descending on all six**, fixed per metric rather than a direction the
      // reader flips: nobody wants the players their lineups started *fewest*
      // of, and a press is one press.
      if (left !== right) return right - left;
      return NAME_ORDER.compare(a.name, b.name);
    });
  }, [all, needle, sort]);

  const detail = useMemo(
    () => (picked ? (all.find((r) => r.id === picked) ?? null) : null),
    [picked, all],
  );

  /**
   * The counterpart cards for the picked row, and the pairing the view is
   * narrowed to.
   *
   * Folded for the picked row and no other: `decisionsFor` is a walk over both
   * sides of every entry, and a memo over the whole list would run it for a
   * thousand players to answer for the one on screen.
   */
  const groups = useMemo(
    () => (detail ? decisionsFor(detail.id, entries) : []),
    [detail, entries],
  );
  const pairing = groups.find((group) => group.player_id === combo) ?? null;

  /**
   * **The subject's figure follows what is on screen**, which is what makes it
   * answerable at all: this tool's figure is scored by the league's own
   * settings, so a player spanning a PPR league and a half-PPR one has no
   * single number — and picking a counterpart narrows to that pairing's own
   * leagues, which is usually one scoring and usually a number. See
   * `WeekTwoSidedShare.figure`.
   */
  const narrowed = useMemo<WeekTwoSidedShare | null>(() => {
    if (!detail) return null;
    if (!pairing) return players.find((p) => p.player_id === detail.id) ?? null;
    const ids = new Set(pairing.rows.map((row) => row.league_id));
    return (
      weekTwoSidedShares(
        entries.filter((e) => ids.has(e.league.league_id)),
      ).players.find((p) => p.player_id === detail.id) ?? null
    );
  }, [detail, pairing, players, entries]);

  const pick = useCallback((id: string) => {
    setPicked((held) => (held === id ? null : id));
    setCombo(null);
  }, []);

  const disclose = useCallback((id: string) => {
    setTrays((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /**
   * A tray key: pick the row's subject if it has none, then add or drop the
   * reading.
   *
   * Two edits in one press because the tray is reachable on a row the grid is
   * not narrowed by — the disclosure key and the row's own press are siblings,
   * deliberately, so a row can be open and unpicked. A key that did nothing
   * there would be a control a reader has to learn the order of. Lifted from
   * `WeekSharesDrawer` as it stood.
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
        return toggleSubjectReading(held, "week", id, reading);
      });
    },
    [onSubjects],
  );

  /**
   * `Narrow grid`: put this row on the grid, or take it off.
   *
   * `toggleSubject` drops the whole subject, its readings with it — which is
   * what the pressed key promises, since the readings are a refinement *of*
   * this narrowing rather than a second one beside it.
   */
  const narrow = useCallback(
    (id: string) => {
      onSubjects((prev) => toggleSubject(prev, { kind: "week", id }));
    },
    [onSubjects],
  );

  const held = subjectCount(subjects);

  return (
    /* Fixed to the bottom edge and centred on the shell's own `max-w-6xl`, so
       the case's shoulders line up with the rack's above. `pointer-events` is
       off on the section and back on inside it: the gutter either side is
       transparent, and a page that could not be clicked through it would be a
       hundred cards behind a pane of glass. */
    <section
      aria-label="Start / sit"
      /**
       * **The open height is a custom property the cascade sets, and the inline
       * style only ever reads it.**
       *
       * It has to be: the animated, positioned box is this section, so the
       * phone arm must reach *it* — and an inline style cannot carry a media
       * query. Written as a height on the case inside instead, the inner box
       * simply overflows a section still sized at 62dvh, which at 390 is a
       * panel whose top half is drawn outside the thing that is supposed to be
       * sliding. Two whole declarations rather than a base and an override, and
       * no value interpolated into a class name: Tailwind finds classes by
       * scanning source text, so a computed one generates nothing at all.
       *
       * **62dvh rather than the fold is load-bearing.** The whole reason this
       * panel is non-modal is that a press narrows the grid behind it, and a
       * case that took the viewport would be a modal with no backdrop. On a
       * phone there is no "beside" — one card fills the row — so it takes the
       * fold, because a 62dvh case over a one-card grid shows a header and half
       * a card, which is neither the page nor the panel.
       *
       * `--rack-clear` is the app rack's own clearance: the console must never
       * reach under it.
       */
      className={`lab-anim pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 transition-[height] duration-[340ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] [--startsit-open-h:calc(100dvh-var(--rack-clear))] sm:[--startsit-open-h:min(62dvh,calc(100dvh-var(--rack-clear)))] ${chromeClass}`}
      style={{
        height: open ? "var(--startsit-open-h)" : "var(--startsit-bar-h)",
      }}
    >
      <div
        className={`${START_SIT_BAR_H} pointer-events-auto relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-t-[1.125rem] bg-[image:var(--panel-case-bg)] shadow-[var(--panel-case-shadow)]`}
      >
        <Bar
          open={open}
          onToggle={toggleConsole}
          counted={counted}
          opponents={opponents}
          total={leagueTotal}
          week={week}
          summary={filterSummary}
          held={held}
          back={open && detail !== null}
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
              className={`min-w-0 flex-1 flex-col gap-2 sm:gap-2.5 lg:flex-[1.6_1_30rem] ${
                detail ? "hidden lg:flex" : "flex"
              }`}
            >
              <Ledge
                query={query}
                onQuery={setQuery}
                shown={rows.length}
                total={all.length}
                sort={sort}
                onSort={setSort}
                figureLabel={figureLabel}
              />
              <List
                rows={rows}
                sort={sort}
                picked={picked}
                chosen={chosen}
                readings={readings}
                trays={trays}
                pending={pending}
                narrowed={rows.length !== all.length}
                figureLabel={figureLabel}
                onPick={pick}
                onDisclose={disclose}
                onReading={pressReading}
              />
            </div>

            {/* The pane stands *beside* the list where there is room and *in
                front of* it where there is not, and at rest above `lg` it
                prompts rather than seeding itself with the top row: a pane that
                opened already answering would claim the reader had asked about
                somebody. */}
            <div
              className={`${CONSOLE_GLASS} min-h-0 flex-col rounded-xl lg:flex-[0_1_26rem] ${
                detail ? "flex flex-1" : "hidden lg:flex"
              }`}
            >
              <Scanlines />
              {detail === null ? (
                <p className="relative z-[1] m-0 flex min-h-0 flex-1 items-center justify-center p-6 text-center font-mono text-[length:var(--fs-11)] uppercase leading-[1.7] tracking-[0.14em] text-[color:var(--readout-label)]">
                  <span className="max-w-72">
                    Press a player to see who he was started over, and who he
                    was sat behind
                  </span>
                </p>
              ) : (
                <>
                  <DetailLedge
                    row={detail}
                    figure={narrowed?.figure ?? null}
                    figureLabel={figureLabel}
                    line={
                      pairing
                        ? `With ${pairing.name} · ${pairing.rows.length} of ${counted} leagues`
                        : `Started in ${detail.started} of ${counted} leagues · benched in ${detail.benched}`
                    }
                    narrowing={chosen.has(detail.slot)}
                    onNarrow={() => narrow(detail.id)}
                  />
                  <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5">
                    <DecisionsList
                      groups={groups}
                      picked={combo}
                      figureLabel={figureLabel}
                      onPick={(id) =>
                        setCombo((prev) => (prev === id ? null : id))
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The metric's own number for a row, or null where it has none. */
function weightOf(row: ConsoleRow, id: SortId): number | null {
  switch (id) {
    case "start":
      return row.started;
    case "bench":
      return row.benched;
    case "opp-start":
      return row.oppStarted;
    case "opp-bench":
      return row.oppBenched;
    case "figure":
      return row.figure;
    case "fielded":
      return row.fielded;
  }
}

// One collator for the name tiebreak rather than `localeCompare` per
// comparison, which re-resolves the locale each call — a sort over a thousand
// rows is thousands of them, on every keystroke.
const NAME_ORDER = new Intl.Collator();

/**
 * What the panel is counting over, on the bar.
 *
 * **Two denominators and a week**, which is the drawer's own `populationNote`
 * moved onto the bar: these calls are one week's and the readout is the only
 * thing on screen that says so, and the second figure is there because two of
 * the four columns are scaled by it. It is legitimately lower — a future week,
 * a week Sleeper filed without a pairing, an opponent whose roster is not
 * stored — and without it a row reading `18` beside one reading `46` looks like
 * the same denominator mistyped.
 *
 * **The first denominator is leagues that contributed a lineup**, not the
 * league count on the page: a league the check answered nothing for
 * contributes nothing and must not be counted, which is the rule
 * `WeekTwoSidedShares.starter_league_count` is written by. So a partly-answered
 * account legitimately reads `109 of 113`.
 */
function populationLine(
  counted: number,
  opponents: number,
  total: number,
  week: number | null,
  summary: string | null,
): string {
  const parts = [
    `${counted} of ${total} league${total === 1 ? "" : "s"}`,
    `${opponents} with an opponent`,
  ];
  if (week !== null) parts.push(`week ${week}`);
  if (summary) parts.push(summary);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */

/**
 * The collapsed bar, which is also the open one's header — a billet strip, and
 * the whole of it is the button.
 *
 * **The toggle is an `absolute inset-0` button rather than the strip itself**,
 * and it has to be one: `‹ List` is a `<button>`, and a `<button>` inside a
 * `<button>` is invalid and unreachable. So the strip is a box, the toggle
 * covers it under the content, and the content is `pointer-events-none` with
 * that key re-enabled — a press anywhere else on the bar still toggles, which
 * is what "the bar is the whole control" means. It is `SharesConsole`'s `Bar`
 * construction, minus the cap channel it has nothing to put in.
 */
function Bar({
  open,
  onToggle,
  counted,
  opponents,
  total,
  week,
  summary,
  held,
  back,
  onList,
}: {
  open: boolean;
  onToggle: () => void;
  counted: number;
  opponents: number;
  total: number;
  week: number | null;
  summary: string | null;
  /** How many subjects are picked — what a shut console still admits to. */
  held: number;
  /** A row is picked and the list is behind the pane — below `lg` only. */
  back: boolean;
  onList: () => void;
}) {
  return (
    <div className="relative flex h-[var(--startsit-bar-h)] w-full shrink-0 items-center gap-2 overflow-hidden bg-[image:var(--billet-bg)] px-2 shadow-[var(--standing-strip-shadow)] sm:gap-3 sm:px-3.5">
      <BilletFinish />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Collapse start / sit" : "Expand start / sit"}
        className="absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60"
      />
      {/* The content sits over the toggle and lets every press through to it;
          only `‹ List` takes one back. */}
      <span className="pointer-events-none relative z-[2] flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {back && (
          <button
            type="button"
            onClick={onList}
            className={`${CONSOLE_KEY_PILL_BARE} pointer-events-auto border-foreground/10 bg-[image:var(--key-metal)] px-2.5 py-1.5 text-[length:var(--fs-10)] tracking-[0.14em] text-foreground/80 shadow-[var(--key-shadow)] lg:hidden`}
          >
            ‹ List
          </button>
        )}

        {/* The lamp says the panel is live rather than a static table.

            **The `image:` hint is not optional here**, and it is the difference
            between a lit pip and an invisible one: `--pip-lit-bg` is a
            *gradient*, and an arbitrary background with a bare `var()` and no
            hint compiles to a background-colour declaration — which is invalid,
            which the browser drops, leaving a transparent disc with a glow
            around nothing.

            (Do not write the hintless form in a comment either. Tailwind finds
            classes by scanning source *text* and does not know a comment from
            markup, so an illustrative class in prose is compiled like any
            other — and one with an ellipsis in it fails the CSS parse and takes
            the whole stylesheet down with it.) */}
        <span
          aria-hidden
          className={`lab-anim size-[0.4375rem] shrink-0 animate-pulse rounded-full bg-[image:var(--pip-lit-bg)] shadow-[0_0_8px_var(--accent-glow)] ${
            back ? "hidden lg:block" : ""
          }`}
        />

        <span className="shrink-0 whitespace-nowrap font-display text-[length:var(--fs-15)] font-semibold uppercase tracking-[0.06em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
          Start / sit
        </span>

        <span
          aria-hidden
          className="hidden h-6 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)] sm:block"
        />

        {/* **Gone below `sm`**: truncated it reads `8 of…`, which states nothing
            and still costs the caret its place. */}
        <span className="hidden min-w-0 flex-1 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:inline">
          {populationLine(counted, opponents, total, week, summary)}
        </span>

        {/* A shut console says nothing otherwise — the same argument
            `SubjectTokens` and the drawer's own readout are written on. */}
        {held > 0 && (
          <span
            className={`${CONSOLE_MILLED_WELL} inline-flex shrink-0 items-baseline gap-[0.3125rem] rounded-[0.4375rem] px-[0.4375rem] py-0.5`}
          >
            <span className="shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] text-[color:var(--billet-label)]">
              Held
            </span>
            <span className="font-display text-[length:var(--fs-14)] font-semibold tabular-nums text-[color:var(--billet-accent)] [text-shadow:var(--standing-engrave),0_0_12px_var(--accent-glow)]">
              {held}
            </span>
          </span>
        )}

        <span
          aria-hidden
          className="ml-auto shrink-0 whitespace-nowrap font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)] sm:text-[length:var(--fs-10)] sm:tracking-[0.16em]"
        >
          <span className="sm:hidden">{open ? "Close" : "Open"}</span>
          <span className="hidden sm:inline">{open ? "Collapse" : "Expand"}</span>
        </span>
        {/* The caret turns rather than swapping glyph, and is `aria-hidden`
            because `aria-expanded` on the button already carries the state. */}
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

/**
 * One cap on the Sort rail, lit or not — the rack's own key.
 *
 * **Every cap sets its background explicitly**, lit or not, so the UA's own
 * button fill never shows through; an unlit cap has *no* fill at all and the
 * recessed channel behind it does the grouping. `bg-transparent` is not
 * optional — without it an unlit cap renders as a white lozenge.
 * `aria-pressed` carries the state.
 */
function Cap({
  lit,
  onPress,
  children,
}: {
  lit: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={lit}
      onClick={onPress}
      className={`touch:min-h-11 flex-auto shrink-0 whitespace-nowrap rounded-full border bg-transparent px-2 py-[0.3125rem] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.06em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 lg:flex-none lg:px-2.5 lg:text-[length:var(--fs-10)] lg:tracking-[0.12em] ${
        lit
          ? "border-[var(--cap-accent-border)] bg-[image:var(--cap-accent-bg)] text-[var(--cap-accent-ink)] shadow-[var(--cap-accent-shadow)] [text-shadow:var(--cap-ink-emboss)]"
          : "border-transparent text-[color:var(--billet-label)] hover:text-readout"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The search, the count and the sort — in a hole cut into the case.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. One wrapping row above
 * `lg` and stacked below, which is `SharesConsole`'s `Ledge` and its
 * arrangement.
 *
 * **No `Pos` rail and no facet tray.** Those are the manager console's player
 * filters, over a season's rosters; this panel's population is one week's
 * lineups and its own four counts are what a reader narrows by, in the tray on
 * each row.
 */
function Ledge({
  query,
  onQuery,
  shown,
  total,
  sort,
  onSort,
  figureLabel,
}: {
  query: string;
  onQuery: (value: string) => void;
  shown: number;
  total: number;
  sort: SortId;
  onSort: (key: SortId) => void;
  figureLabel: string;
}) {
  return (
    <div className="relative flex shrink-0 flex-col gap-1.5 rounded-xl bg-[color:var(--case-well-bg)] p-1.5 shadow-[var(--case-well-shadow)] lg:flex-row lg:flex-wrap lg:items-center lg:gap-2 lg:p-2">
      {/* The field and the count share one row below `lg`; above it the wrapper
          stops generating a box and its children join the wrapping row. */}
      <div className="flex min-w-0 items-center gap-1.5 lg:contents">
        <label
          className={`${CONSOLE_PANE_TRACK} relative flex min-w-0 flex-1 items-center gap-2 px-3.5 lg:order-1 lg:min-w-44 lg:flex-[1_1_11rem]`}
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
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search players"
            className="w-full min-w-0 border-0 bg-transparent py-2 font-mono text-[length:var(--fs-12)] tracking-[0.04em] text-[color:var(--billet-name)] outline-none placeholder:text-[color:var(--readout-label)]"
          />
        </label>

        {/* **The denominator only where it says something.** At rest the design
            draws the bare figure, and a `471 / 471` beside it would be the same
            number twice; narrowed, what a reader wants is what it was narrowed
            *from*. */}
        <span
          className={`${CONSOLE_WINDOW} inline-flex shrink-0 items-baseline gap-1 rounded-xl px-[0.6875rem] py-[0.4375rem] lg:order-2`}
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
      </div>

      {/* **The caps are a single-select rail** and the chosen one is the rack's
          own accent cap — one spelling of a lit cap in this app. They offer the
          five columns on screen plus `Fielded`, which is what a press on a row
          narrows to and the one order no column can say.

          **It stays shrinkable and stays a lozenge at every width**, which is
          where it parts company with `SharesConsole`'s rail and is a render's
          doing rather than a preference. That one offers at most four caps and
          fits its ledge on one line, so it takes `lg:flex-none lg:rounded-full`
          and is a pill. Six caps and a legend are ~540px against the 531 a
          1024-wide list column leaves, and at `flex-none` a rail cannot shrink
          below its own one-line max-content: measured, it ran 9px past the
          ledge and the case's `overflow-hidden` took `Fielded` off the screen
          with nothing saying so. Left shrinkable it wraps inside itself, which
          is what its own `flex-wrap` is for — and a wrapped rail is two lines
          tall, which is why the radius is the 20px lozenge rather than a pill
          drawn round a box that is no longer one line. It is the stat board's
          own finding about its Sort track, one panel over. */}
      <span
        role="group"
        aria-label="Sort by"
        className={`${CONSOLE_CHANNEL_METAL} flex min-w-0 flex-wrap items-center gap-1 rounded-[1.25rem] p-1 lg:order-3`}
      >
        <span
          aria-hidden
          className="shrink-0 pl-[0.4375rem] pr-1 font-mono text-[length:var(--fs-8)] uppercase leading-[1.15] tracking-[0.1em] text-[color:var(--billet-label)] lg:text-[length:var(--fs-9)] lg:tracking-[0.14em]"
        >
          Sort
        </span>
        {READING_COLUMNS.map((id) => (
          <Cap key={id} lit={sort === id} onPress={() => onSort(id)}>
            {SORT_LABEL[id]}
          </Cap>
        ))}
        <Cap lit={sort === "figure"} onPress={() => onSort("figure")}>
          {figureLabel}
        </Cap>
        <Cap lit={sort === "fielded"} onPress={() => onSort("fielded")}>
          Fielded
        </Cap>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** The list: lit glass holding a strip of heads and a scroller of rows. */
function List({
  rows,
  sort,
  picked,
  chosen,
  readings,
  trays,
  pending,
  narrowed,
  figureLabel,
  onPick,
  onDisclose,
  onReading,
}: {
  rows: readonly ConsoleRow[];
  /** Which column the rows are ordered by — the head lights it. */
  sort: SortId;
  picked: string | null;
  chosen: ReadonlySet<string>;
  readings: ReadonlyMap<string, readonly WeekReading[]>;
  trays: ReadonlySet<string>;
  pending: boolean;
  narrowed: boolean;
  figureLabel: string;
  onPick: (id: string) => void;
  onDisclose: (id: string) => void;
  onReading: (id: string, reading: WeekReading) => void;
}) {
  return (
    <div
      className={`${CONSOLE_GLASS} @container flex min-h-0 flex-1 flex-col rounded-xl`}
    >
      <Scanlines />
      {rows.length === 0 ? (
        <p className="relative z-[1] m-0 px-3 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
          {pending
            ? "Reading…"
            : narrowed
              ? "No player matches that search."
              : "No lineups read for this week yet."}
        </p>
      ) : (
        <>
          {/* The column header, above the scroller so it does not travel with
              it. **Gone below `@md`**, where the cells wrap under the name and
              there is no column for a label to be over. Its gutters are the
              row's own, and the trailing spacer is the disclosure key's, so
              a head sits over the cell it names. */}
          <div
            aria-hidden
            className={`${CONSOLE_WINDOW_LEDGE} relative z-[2] mx-[3px] mt-[3px] hidden items-center gap-2 rounded-[7px] py-1 pl-[0.6875rem] pr-[0.4375rem] @md:flex`}
          >
            <span className="min-w-0 flex-1 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-[color:var(--billet-label)]">
              Name
            </span>
            {READING_COLUMNS.map((id) => (
              <Head key={id} lit={sort === id} width={COLUMN_WIDTH[id]}>
                {COLUMN_LABEL[id]}
              </Head>
            ))}
            <Head lit={sort === "figure"} width={COLUMN_WIDTH.figure}>
              {figureLabel}
            </Head>
            <span className="w-6 shrink-0" />
          </div>
          <ul className="lab-scroll-glass relative z-[1] m-0 flex min-h-0 flex-1 list-none flex-col gap-[5px] overflow-y-auto p-[3px]">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                picked={picked === row.id}
                narrowing={chosen.has(row.slot)}
                held={readings.get(row.id) ?? NO_READINGS}
                open={trays.has(row.id)}
                figureLabel={figureLabel}
                onPick={onPick}
                onDisclose={onDisclose}
                onReading={onReading}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * One column head.
 *
 * **The sorted column's head is lit**, which is the one thing the header says
 * that the Sort rail below does not: which of these columns the rows under it
 * are in the order of. `Fielded` lights none of them, correctly — it is the sum
 * of four rather than any one.
 */
function Head({
  lit,
  width,
  children,
}: {
  lit: boolean;
  width: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{ width }}
      className={`shrink-0 truncate whitespace-nowrap px-2 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] ${
        lit
          ? "text-[color:var(--billet-accent)]"
          : "text-[color:var(--billet-label)]"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * One row, as a key that can be held down.
 *
 * **`memo`'d, and every prop is a value or a stable callback.** This component
 * is mounted for as long as the console is up and the page above it re-renders
 * on every stream chunk, filter press and card toggle; without the memo that is
 * a thousand rows of ~40 nodes each reconciled to draw exactly what they drew.
 * `held` is the one array among them and it is stable per selection — see the
 * console's `readings`.
 *
 * **Three states, and two of them are different claims.** Resting is the key at
 * rest; *picked* is the row the decisions pane is reading and reads as pressed;
 * *narrowing* is a row the grid is actually filtered by, which is a lamp on the
 * key — the accent border and the halo say something here is narrowing and the
 * resting `key-shadow` says this row is not the thing being read.
 *
 * **Keep it flat.** No `preserve-3d`, no per-row `translateZ`, no `drop-shadow`
 * filters: this list is ~1,500 rows on a big account, and that budget is why
 * the drawer's own note forbade it. The lift is a `translateY` under
 * `motion-safe:` rather than only under `.lab-anim` — that rule clears
 * `transition` and `animation`, so a lift written without the variant would
 * still jump instantly under reduced motion, which is the thing the preference
 * is about.
 *
 * **Below `@md` the row is two lines and the readouts are two bays.** Five
 * cells beside a badge is wider than a phone-width row, and wrapped they cost
 * three lines with the figure orphaned on the last of them — 116px a row at
 * 390, of which the name got 213px at `--fs-13`. So the phone arm gives the
 * name the row's own headline at `--fs-15` and lets it *wrap* rather than
 * truncate, pairs it with the figure the way the decisions ledge already does,
 * and groups the four counts into two captioned {@link ReadingBay}s — which is
 * what replaces the head strip that arm has never had room for. Two lines,
 * 105px, and a name that is never cut.
 *
 * **One DOM, two layouts, and two arms of content inside it.** The two line
 * wrappers go `@md:contents`, so above the query their children are items of
 * the press again and the single line the head aligns to is byte-identical —
 * the `lg:contents` trick `DrawerRow` and the app rack's brand row already
 * turn. What `contents` cannot do is change *what* is drawn, and the two arms
 * genuinely differ there — two bays against five cells, a captioned figure
 * window against a bare one, a subline naming the team and the fielded count
 * against one naming the position and the team — so those are gated by
 * `display: none`, which takes the arm that is not on screen out of the
 * accessibility tree as well. It is `WeekStepper`'s own precedent and its two
 * conditions: nothing in either arm holds state, and exactly one is ever read.
 * What it costs is the nodes of the arm that is hidden, on a list with no
 * virtualizer — which is the price of a breakpoint a client component must not
 * have to hydrate to learn.
 */
const Row = memo(function Row({
  row,
  picked,
  narrowing,
  held,
  open,
  figureLabel,
  onPick,
  onDisclose,
  onReading,
}: {
  row: ConsoleRow;
  picked: boolean;
  narrowing: boolean;
  /** The readings picked on this row, canonical and stable per selection. */
  held: readonly WeekReading[];
  /** Its tray of narrowing keys is open. */
  open: boolean;
  /** What the figure is — the phone arm captions its own window with it. */
  figureLabel: string;
  onPick: (id: string) => void;
  onDisclose: (id: string) => void;
  onReading: (id: string, reading: WeekReading) => void;
}) {
  const on = picked || narrowing;
  return (
    <li
      className={
        "lab-anim rounded-xl border bg-[image:var(--key-bg)] transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
        "motion-safe:hover:-translate-y-0.5 hover:border-active/40 hover:shadow-[var(--key-shadow),0_16px_26px_-14px_rgba(0,0,0,0.9),0_0_26px_-10px_var(--accent-glow)] " +
        (picked
          ? "border-active/50 shadow-[var(--key-shadow-pressed),inset_0_0_22px_color-mix(in_srgb,var(--accent)_14%,transparent),0_0_24px_-10px_var(--accent-glow)]"
          : narrowing
            ? "border-active/50 shadow-[var(--key-shadow),0_0_24px_-10px_var(--accent-glow)]"
            : "border-foreground/9 shadow-[var(--key-shadow)]")
      }
    >
      <div className="relative flex items-center py-2 pl-[0.6875rem] pr-[0.4375rem] @md:gap-2">
        <button
          type="button"
          onClick={() => onPick(row.id)}
          aria-pressed={picked}
          className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:flex-row @md:flex-nowrap @md:items-center @md:gap-x-2"
        >
          {/* **Line one below `@md`, and nothing at all above it.** The wrapper
              goes `contents` at the query, so the badge, the name and the
              figure window are items of the press again and the row the head
              strip aligns to is the one it always was. A variant beside a base
              `flex` is safe; two base display utilities would be settled by
              Tailwind's emit order rather than by this string. */}
          <span className="flex min-w-0 items-start gap-2 @md:contents">
            {/* The position, in a lit bezel. Start/sit rows are players seen
                through a week's seats and the drawer never drew a face — what
                tells two of them apart at a glance is which seat they compete
                for. `—` where the feed named no position. **Smaller on the
                phone**, where it is a mark beside a headline rather than the
                row's own left column, and `mt-0.5` because that line is
                `items-start`: a bezel centred against two lines of name sits
                beside neither. */}
            <span
              aria-hidden
              className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-foreground/12 bg-[image:var(--bezel-bg)] font-mono text-[length:var(--fs-8)] uppercase shadow-[var(--bezel-shadow)] @md:mt-0 @md:size-[1.875rem] @md:rounded-[0.4375rem] @md:text-[length:var(--fs-9)] ${
                on ? "text-readout" : "text-foreground/68"
              }`}
            >
              {row.position}
            </span>

            <span className="min-w-0 flex-1">
              {/* **The phone name wraps and is never cut.** `truncate` is the
                  `@md` arm's, where the row is one line against a head strip
                  and a second line would put every row at two heights; here
                  there is no head, the line is the row's own headline, and a
                  clipped surname is the fault this arm exists to fix.
                  `leading-[inherit]` at the query rather than a figure of its
                  own, so the single-line row's box is the one it was. */}
              <span
                className={`block font-display text-[length:var(--fs-15)] leading-[1.25] tracking-[-0.01em] [overflow-wrap:break-word] [text-wrap:pretty] @md:truncate @md:text-[length:var(--fs-13)] @md:leading-[inherit] @md:tracking-[-0.005em] ${
                  on
                    ? "font-semibold text-readout [text-shadow:var(--readout-text-glow)] @md:[text-shadow:none]"
                    : "text-foreground/92 @md:text-foreground/85"
                }`}
              >
                {row.name}
              </span>
              {/* Two sublines, one drawn at a time. The phone's says the team
                  and what a press narrows to — the position is in the bezel
                  beside it and would otherwise be said twice — and the `@md`
                  arm's is the `position · team` note it has always carried,
                  where the bezel is a column of its own. */}
              <span className="mt-0.5 block font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46 @md:hidden">
                {row.sub}
              </span>
              {row.note && (
                <span className="hidden truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46 @md:block">
                  {row.note}
                </span>
              )}
              {/* **A closed tray says nothing**, and the readings are picked
                  inside one: a row scrolled past is still narrowing the grid
                  behind the panel, and without this the only thing saying so is
                  a lit cell a reader has to count along the row to find. It is
                  `NarrowingChip`'s argument, on the row itself. */}
              {held.length > 0 && (
                <span className="block truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-active">
                  {held.map((r) => READING_WORD[r]).join(" + ")} held
                </span>
              )}
            </span>

            {/* The figure, paired with the name rather than filed at the end of
                a rank of counts — the pairing the decisions pane's own ledge
                already makes, and what leaves line two to the two bays. It
                captions itself because there is no head over it here; above
                `@md` there is one, and it is the last `Cell` instead. */}
            <span
              className={`${CONSOLE_WINDOW} inline-flex shrink-0 items-baseline gap-[5px] rounded-lg px-[7px] py-[3px] @md:hidden`}
            >
              <Scanlines />
              <span className="relative font-mono text-[length:var(--fs-8)] uppercase tracking-[0.1em] text-readout-label">
                {figureLabel}
              </span>
              <span className="relative font-mono text-[length:var(--fs-13)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
                {row.figure === null ? "—" : row.figure.toFixed(1)}
              </span>
            </span>
          </span>

          {/* **Line two below `@md`: the four counts as two bays.** `min-h-11`
              is the disclosure key's own square, so the bays stretch to it and
              the key beside them lands on the same two edges — the key is a
              sibling of this press rather than a child (a control nested in a
              control is not reliably reachable), so the two are aligned by
              their heights agreeing rather than by sharing a flex line. */}
          <span className="flex min-h-11 items-stretch gap-1 pr-12 @md:contents">
            {READING_BAYS.map((bay) => (
              <ReadingBay
                key={bay.caption}
                caption={bay.caption}
                readings={bay.readings}
                row={row}
                held={held}
              />
            ))}
            {/* The `@md` arm's five cells, unchanged and off the phone. The
                wrapper is `contents` at the query rather than a box, so each
                cell is an item of the press and sits under its own head. */}
            <span className="hidden @md:contents">
              {READING_COLUMNS.map((id) => (
                <Cell
                  key={id}
                  width={COLUMN_WIDTH[id]}
                  lit={held.includes(id)}
                  figure={false}
                >
                  {String(COUNT_OF[id](row))}
                </Cell>
              ))}
              {/* The figure lights for nobody: it is not a reading, so there is
                  no key in the tray that could pick it. */}
              <Cell width={COLUMN_WIDTH.figure} lit={false} figure>
                {row.figure === null ? "—" : row.figure.toFixed(1)}
              </Cell>
            </span>
          </span>
        </button>

        {/* **A sibling of the row's own press, deliberately**, so a row can be
            open and unpicked — which is what makes the tray reachable without
            first opening a decisions pane nobody asked for. It is 44px below
            `@md`, where a thumb is the input and the row has already wrapped to
            two lines, and 24px wide above it, where the head row is on screen
            and the spacer beside it has to match. `SharesDrawer`'s own
            geometry.

            **Taken out of flow below the query, and that is a width rather
            than a position.** In flow it is a sibling of the press, so its 44px
            and the gap beside it come off *both* of the press's lines — and
            line one has no key on it: the name would pay 48px for a square
            drawn under line two. Absolute, line one is the row's whole content
            box (164px of name at 360 rather than 116, which is the difference
            between a subline that fits and one that wraps), and line two buys
            the square back with `pr-12` — 44 and the 4px gap, the same two
            numbers, spent where they are actually drawn. The `pr` is inert
            above the query without an override, because a `contents` box
            generates none. Above it the key is `static` again and the row is
            the single line it always was. */}
        <button
          type="button"
          onClick={() => onDisclose(row.id)}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} narrowing keys for ${row.name}`}
          className={`lab-anim absolute bottom-2 right-[0.4375rem] inline-flex size-11 shrink-0 items-center justify-center rounded-full border bg-[image:var(--key-metal)] font-mono text-[length:var(--fs-11)] shadow-[var(--key-shadow)] transition-[transform,color,border-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 @md:static @md:h-7 @md:w-6 @md:self-center @md:text-[length:var(--fs-10)] ${
            open ? "rotate-180" : ""
          } ${
            held.length > 0
              ? "border-active/40 text-readout"
              : "border-foreground/12 text-foreground/72 hover:text-readout"
          }`}
        >
          <span aria-hidden>▾</span>
        </button>
      </div>

      {/* Left-aligned to the name column, so the keys sit under the row they
          narrow rather than under its badge. `ReadingKeys` is the shared tray,
          unchanged — its `line` arm is the one the drawer draws and the one the
          design names. */}
      {open && (
        <div className="relative flex items-center pb-[0.5625rem] pl-[2.6875rem] pr-[0.6875rem] @md:pl-[3.0625rem]">
          <ReadingKeys
            counts={row}
            picked={held}
            onPress={(reading) => onReading(row.id, reading)}
          />
        </div>
      )}
    </li>
  );
});

/** Which count each reading's cell prints. */
const COUNT_OF: Record<WeekReading, (row: ConsoleRow) => number> = {
  start: (row) => row.started,
  bench: (row) => row.benched,
  "opp-start": (row) => row.oppStarted,
  "opp-bench": (row) => row.oppBenched,
};

/**
 * How a picked reading reads on the row's own subline.
 *
 * The chip's vocabulary rather than the column's: `start + opp bench` is the
 * pair, where `Start + Opp Bn` is two head labels a reader has to map back.
 */
const READING_WORD: Record<WeekReading, string> = {
  start: "start",
  bench: "bench",
  "opp-start": "opp start",
  "opp-bench": "opp bench",
};

/**
 * One readout cell — one shape, five figures.
 *
 * **A zero prints `0` and an absent figure prints an em dash**, never a zero:
 * the four counts are real counts and a nought is a real answer, where a
 * `figure` of null is the counted leagues disagreeing about what he is worth
 * (see `WeekTwoSidedShare.figure`) and a zero there would claim they agreed on
 * nothing.
 *
 * **None of them is coloured.** `rankColor` says how *good* a position is, and
 * none of these five has a good — a player started in nine lineups is a
 * different fact from one started in one, not a better result.
 *
 * **The lit state is a border and a halo, never a fill.** The figure inside is
 * a reading, and tinting the glass would make the number mean something
 * different from the identical number two cells over. It is what makes four
 * keys in a shut tray legible: the row's subline says *something* is picked and
 * the lit window says which.
 */
function Cell({
  width,
  lit,
  figure,
  children,
}: {
  width: string;
  lit: boolean;
  /** The figure column carries the decimal and a size of its own. */
  figure: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{ width }}
      // The border colour is composed onto the *shell*, never appended to
      // `CONSOLE_WINDOW` — see that constant's split: two base border-colour
      // utilities of the same specificity are settled by Tailwind's emit order,
      // and what that costs is a cell that silently never lights.
      className={`${CONSOLE_WINDOW_SHELL} flex shrink-0 flex-col justify-center self-stretch rounded-[0.4375rem] px-[0.375rem] py-1 ${
        lit
          ? "border-active/55 shadow-[var(--window-shadow),0_0_20px_-8px_var(--accent-glow)]"
          : "border-black/85"
      }`}
    >
      <Scanlines />
      <span
        className={`relative whitespace-nowrap font-mono leading-[1.2] tabular-nums text-readout [text-shadow:var(--readout-text-glow)] ${
          figure
            ? "text-[length:var(--fs-13)]"
            : "text-[length:var(--fs-11)]"
        }`}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * One side's pair of counts, in a milled hole with a caption over it.
 *
 * **This is what replaces the column head on the phone**, and the reason it is
 * a bay rather than four heads is 360px: a head strip has to be as wide as its
 * cells, and five cells plus a 44px key run past the row's right edge there.
 * A caption over a *pair* says the side once instead of naming each column, and
 * two of them fit the row's own width with the key beside them. It is only ever
 * drawn below `@md`; above it the head strip is on screen and the cells sit
 * under it.
 *
 * **The windows are `flex-1` rather than {@link COLUMN_WIDTH}.** That constant
 * is right above the query, where a head has to line up with a cell, and is
 * exactly what breaks below it — a fixed width cannot give back what a 360px
 * row does not have. Here the two figures share whatever the bay is.
 *
 * **The lit state is on the window and never on the bay**, which is the same
 * rule {@link Cell} keeps and for the same reason: a reader picks a *reading*,
 * so lighting the hole would say both of the figures in it were picked. It is
 * a border and a halo rather than a fill — a tinted glass would make the number
 * inside mean something different from the identical number beside it — and it
 * is composed onto {@link CONSOLE_WINDOW_SHELL} rather than appended to
 * {@link CONSOLE_WINDOW}, since two base border-colour utilities of the same
 * specificity are settled by Tailwind's emit order and what that costs is a
 * window that silently never lights.
 */
function ReadingBay({
  caption,
  readings,
  row,
  held,
}: {
  /** Which side these two are — the one thing the pair cannot say itself. */
  caption: string;
  readings: readonly WeekReading[];
  row: ConsoleRow;
  held: readonly WeekReading[];
}) {
  return (
    <span
      className={`${CONSOLE_CHIP_TRAY} flex min-w-0 flex-1 flex-col gap-[2px] rounded-lg p-[3px] @md:hidden`}
    >
      {/* **No tracking, and that is the measurement in `BAY_CAPTION`'s note**:
          at 360 `Opp start / bench` is exactly as wide as the track it sits in
          and any letter-spacing at all truncates it. */}
      <span className="truncate pl-0.5 font-mono text-[length:var(--fs-8)] uppercase tracking-normal text-[color:var(--billet-label)]">
        {caption}
      </span>
      <span className="flex items-stretch gap-[3px]">
        {readings.map((id) => (
          <span
            key={id}
            className={`${CONSOLE_WINDOW_SHELL} flex min-w-0 flex-1 flex-col justify-center rounded-md px-[5px] py-[3px] ${
              held.includes(id)
                ? "border-active/55 shadow-[var(--window-shadow),0_0_20px_-8px_var(--accent-glow)]"
                : "border-black/85"
            }`}
          >
            <Scanlines />
            <span className="relative whitespace-nowrap font-mono text-[length:var(--fs-11)] leading-[1.2] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
              {COUNT_OF[id](row)}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The decisions pane's own header: the subject, its figure, what the view is
 * showing, and the key that puts it on the grid.
 *
 * **One key, not a press on every counterpart.** Every league in this pane
 * narrows to the same set, so a card here is a reading and this is the control;
 * pressed, it says the grid behind is already on it.
 */
function DetailLedge({
  row,
  figure,
  figureLabel,
  line,
  narrowing,
  onNarrow,
}: {
  row: ConsoleRow;
  /** Null where the leagues on screen disagree — see `WeekTwoSidedShare.figure`. */
  figure: number | null;
  figureLabel: string;
  /** What this view is currently showing, in words. */
  line: string;
  narrowing: boolean;
  onNarrow: () => void;
}) {
  return (
    <div
      className={`${CONSOLE_WINDOW_LEDGE} relative z-[2] mx-1.5 mt-1.5 flex shrink-0 flex-col gap-1.5 rounded-[7px] px-2.5 py-2`}
    >
      {/* **The name takes the line**, at every width rather than below a
          query: this pane is `26rem` even at `lg`, so a headline sharing one
          line with the note and the figure window had about 160px whatever the
          viewport was and cut `Christian McCaffrey` on a laptop as readily as
          on a phone. Wrapping rather than truncating, for the row's reason —
          a name is the subject, and a subject is the one thing on a readout
          that must not be guessed at. */}
      <span className="block font-display text-[length:var(--fs-16)] font-semibold leading-[1.25] tracking-[-0.015em] text-[color:var(--billet-name)] [overflow-wrap:break-word] [text-wrap:pretty] [text-shadow:var(--billet-name-shadow)]">
        {row.name}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        {row.note && (
          <span className="min-w-0 truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-[color:var(--billet-label)]">
            {row.note}
          </span>
        )}
        <span
          className={`${CONSOLE_WINDOW} ml-auto inline-flex shrink-0 items-baseline gap-1.5 rounded-lg px-2 py-[0.1875rem]`}
        >
          <Scanlines />
          <span className="relative font-mono text-[length:var(--fs-9)] uppercase tracking-[0.14em] text-readout-label">
            {figureLabel}
          </span>
          <span className="relative font-mono text-[length:var(--fs-13)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {figure === null ? "—" : figure.toFixed(1)}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {/* Wrapping rather than truncating too, and for a sharper version of
            the same reason: this sentence ends in the count it is about, so
            what a truncation cuts is the number rather than the preamble. */}
        <p className="m-0 min-w-0 flex-1 font-mono text-[length:var(--fs-9)] uppercase leading-[1.6] tracking-[0.14em] text-readout-label">
          {line}
        </p>
        <button
          type="button"
          onClick={onNarrow}
          aria-pressed={narrowing}
          aria-label={
            narrowing
              ? `Stop narrowing to ${row.name}`
              : `Narrow the league grid to the leagues that fielded ${row.name}`
          }
          className={`${CONSOLE_KEY_PILL_BARE} ml-auto px-3 py-[0.3125rem] text-[length:var(--fs-10)] tracking-[0.14em] ${
            narrowing
              ? "border-active/55 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow-pressed),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)] [text-shadow:var(--readout-text-glow)]"
              : "border-foreground/10 bg-[image:var(--key-metal)] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout"
          }`}
        >
          {narrowing ? "Narrowing" : "Narrow grid"}
        </button>
      </div>
    </div>
  );
}
