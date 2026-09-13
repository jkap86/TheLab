"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ManagerLeague,
  ManagerLeaguematesPayload,
  ManagerLeaguemateRostersPayload,
  ManagerPlayersPayload,
} from "@/shared/contract";

import {
  BilletFinish,
  CONSOLE_CHANNEL_METAL,
  CONSOLE_GLASS,
  CONSOLE_KEY_PILL_BARE,
  CONSOLE_MILLED_WELL,
  CONSOLE_PANE_TRACK,
  CONSOLE_TILE_DRAWER,
  CONSOLE_TRACK,
  CONSOLE_WINDOW,
  CONSOLE_WINDOW_LEDGE,
  CONSOLE_WINDOW_SHELL,
  leaguematePlayerId,
  pickedSubject,
  Scanlines,
  storeSharesConsoleOpen,
  storeSharesTab,
  subjectSlot,
  useSharesConsoleOpen,
  useSharesTab,
  type LeagueSubjects,
  type SharesTab,
  type Subject,
  type SubjectMode,
} from "@/features/shared";

import {
  leaguematePlayers,
  playerModeCounts,
  playerModeLeagues,
  rosterIndex,
  type RosterScope,
} from "../helpers/leaguemate-rosters";
import { leaguemateShares } from "../helpers/leaguemates";
import {
  activeFilterCount,
  keepsPlayer,
  NO_PLAYER_FILTERS,
  playerFilterBounds,
  UNKNOWN_VALUE,
  type PlayerFilterState,
} from "../helpers/player-filters";
import { rowRecord } from "../helpers/season-summary";
import { playerShares } from "../helpers/shares";
import type { SharesRead } from "../hooks/use-manager-shares";
import { LeaguemateRosterRail } from "./leaguemate-roster-rail";
import { PlayerFilters } from "./player-filters";
import { PlayerModeTrack } from "./player-mode-track";

/**
 * **Shares**: which of this manager's leagues hold a player, and which they
 * share with a person — as one console at the foot of the page.
 *
 * This replaces two side drawers. `PlayerSharesDrawer` and
 * `LeaguemateSharesDrawer` were native modal `<dialog>`s opened from the two
 * `BrowseDock` keys, and what was wrong with them was not their content but
 * what a modal *is*: the whole point of picking a row here is that it narrows
 * the league grid, and a backdrop over that grid meant the reader pressed a
 * subject and then dismissed the panel to see what it had done. The console is
 * **non-modal by design** — no backdrop, no focus trap, no `showModal()` — so
 * the grid re-filters, `SubjectTokens` grows a chip, the header's
 * `Leagues 9 / 113` and its win-rate dial recompute, and a `Taken` narrowing
 * puts `OwnerBillet` back on each card, all while the panel is still up. That
 * is the entire argument for the part.
 *
 * It is the part gametime's `StatBoard` is, and deliberately so: a billet bar
 * fixed to the foot of the page's own `max-w-6xl` shell, expanding upward into
 * a two-pane body. The case, the bar's absolute toggle, the `Cap`, the
 * list/detail split and the phone arrangement are all that component's, so a
 * reader who has used one has used the other. What differs is one thing and
 * the design names it as a decision: **one bar with two tabs** rather than two
 * bars, because Players and Leaguemates are two vocabularies over one
 * population and two bars would be two heights of fixed chrome over one grid.
 *
 * **The panel is mounted only while it is up** (`open &&` on the body), which
 * is `usePanelCap`'s `mounted` one component over and for its reason: a
 * thousand-odd rows behind a control most readers never press is a document
 * the page pays for on every render, and this page re-renders on every line of
 * the leagues stream.
 *
 * ## The population rule, which survives the move verbatim
 *
 * **Every fold here is taken over the league-filtered, subject-*un*narrowed
 * list.** Folded over the selection instead, every row would collapse to the
 * row just picked the moment it was picked, and could not be widened again
 * without clearing first — the rule `facetsQuery` already enforces for the
 * trades board's own menus, and the one both drawers' file comments were
 * written on. The page hands it `leagueFiltered` for exactly this.
 *
 * ## What was dropped
 *
 * The **Columns strip** (drag-to-reorder, `useSharesColumns`,
 * `SHARES_COLUMNS_BY_KIND`): this console's columns are fixed, like the stat
 * board's. That module is untouched and still serves the week panels.
 * The **Esc pill** goes with the modal — the bar is the control, and Esc
 * collapses rather than cancels. And **`BrowseDock` on this page**, which is
 * what the bar replaces; the dock itself stays for the lineup checker.
 */

/**
 * The collapsed bar's own height, as the classes that declare it.
 *
 * **One spelling, because the page's own layout has to clear it.** The console
 * is `fixed` to the foot of the viewport and the league grid's bottom margin is
 * measured against it — see `leagues-home.tsx`, which puts this on the page
 * root so both read the same number. A height written twice is a last card
 * under the bar the first time either moves.
 *
 * Whole class strings rather than a value interpolated into one: Tailwind finds
 * classes by scanning source text, so `[--shares-bar-h:${n}]` would generate
 * nothing at all. It is `STAT_BAR_H`'s rule, one page over.
 */
export const SHARES_BAR_H = "[--shares-bar-h:3rem] sm:[--shares-bar-h:3.25rem]";

/* ------------------------------------------------------------------ */

/** One readout cell on a row — the four metrics a console row can carry. */
type ColumnId = "share" | "record" | "value" | "age";

/**
 * Which cells each tab's rows carry, and the sort keys they offer.
 *
 * **Two vocabularies, not one list narrowed twice.** A leaguemate has no age
 * and no market price — those are facts about a player — so their rows carry
 * the two columns that mean something, and their heads are the only sort keys.
 */
const COLUMNS: Record<SharesTab, readonly ColumnId[]> = {
  player: ["share", "record", "value", "age"],
  leaguemate: ["share", "record"],
};

/**
 * What each column is called **over its cells**.
 *
 * `Rec·Win` is tight rather than spaced because it has to fit the cell's own
 * `4.75rem`: a render at 1280 cut `Rec · Win` to `Rec · W…`, which names the
 * first of the two readings under it and drops the second. It is the design's
 * own spelling for the head.
 */
const COLUMN_LABEL: Record<ColumnId, string> = {
  share: "Share",
  record: "Rec·Win",
  value: "Value",
  age: "Age",
};

/**
 * What the rows can be ordered by: any column on screen, and the name.
 *
 * **The column heads are the sort keys**, which is what retired the Sort rail
 * that used to sit in the ledge. A head *is* the column it orders, so the order
 * and the number a reader is comparing come off one list by construction — the
 * rail had to be kept in step with the columns to promise that, and it spent a
 * whole row of the ledge doing it.
 */
type SortKey = ColumnId | "name";

/** The sort in force: a key, and which way it reads. */
type SortState = { key: SortKey; ascending: boolean };

/**
 * What a head's key is called **to a screen reader**. The visible head says
 * `Rec·Win` because that is what is in the cell — a record *and* a win rate —
 * where a press orders by one of them, which is the record.
 */
const SORT_LABEL: Record<SortKey, string> = {
  ...COLUMN_LABEL,
  record: "Record",
  name: "Name",
};

/**
 * The cells' widths, which are the design's and are fixed rather than fluid.
 *
 * A figure column that grew with the pane would set at a different width on
 * every row list, and the two panes' rows are read across each other.
 */
const COLUMN_WIDTH: Record<ColumnId, string> = {
  share: "4.75rem",
  record: "4.75rem",
  value: "3.75rem",
  age: "2.875rem",
};

/**
 * Which way each key reads on its **first** press — and a second press on the
 * same head reverses it.
 *
 * The first press is the direction a reader means by sorting on a column:
 * nobody opens this list for the leagues they hold a player in *fewest* of, so
 * the counts and the price descend, and age ascends because younger first is
 * what a dynasty reader is asking. But the reverse is a real question too — the
 * one-league stashes, the oldest roster — and with the head as the key it costs
 * one more press on the same place rather than a control of its own.
 */
const SORT_ASCENDING: Record<SortKey, boolean> = {
  share: false,
  record: false,
  value: false,
  age: true,
  name: true,
};

const DEFAULT_SORT: SortState = { key: "share", ascending: false };

/** A press on a head: its own first direction, or the held sort reversed. */
function nextSort(held: SortState, key: SortKey): SortState {
  return held.key === key
    ? { key, ascending: !held.ascending }
    : { key, ascending: SORT_ASCENDING[key] };
}

/** The main figure's size, per metric — a record and a share carry two lines. */
const CELL_TEXT: Record<ColumnId, string> = {
  share: "text-[length:var(--fs-11)]",
  record: "text-[length:var(--fs-11)]",
  value: "text-[length:var(--fs-13)]",
  age: "text-[length:var(--fs-13)]",
};

/** Nothing folded yet — one identity, so a memo sees one object. */
const NO_ROWS: ConsoleRow[] = [];

/** How many of a leaguemate's board the pane shows before `Show all`. */
const RAIL_PREVIEW = 12;

/**
 * One row of either list, folded once per row list.
 *
 * **Its identity is what `Row`'s memo compares**, so it is built per list
 * rather than per render: a fresh one per keystroke would re-render a thousand
 * rows to narrow to ten. The two derived strings are here for the same reason —
 * lower-casing a name and spelling a slot are per-row costs the search and the
 * selection would otherwise pay on every render.
 */
type ConsoleRow = {
  id: string;
  name: string;
  /** A short trailing fact — `WR · CIN` for a player, absent on a person. */
  note: string | null;
  badge: {
    round: boolean;
    /** A stored avatar. It *replaces* the label. */
    imageUrl?: string | null;
    /**
     * A headshot drawn *over* the label rather than instead of it.
     *
     * A separate arm from `imageUrl` because the two fail differently: an
     * avatar is a picture somebody uploaded and is there when the row says it
     * is, where a great many Sleeper ids have no thumbnail and a broken `<img>`
     * paints the platform's own placeholder glyph over the fallback even at
     * `alt=""`. A background image that 404s paints nothing and the initial
     * underneath is exactly the fallback it is there to be — `PlayerFace`'s
     * reasoning, which the drawer's own `Badge` already copied.
     */
    faceUrl?: string | null;
    label: string;
  };
  /** How many of the counted leagues hold this row. */
  held: number;
  /** Null where the set has played nothing — never `0–0`. */
  record: { label: string; pct: number; pctLabel: string } | null;
  /** Player only, and **null where absent, never zero**. */
  value: number | null;
  age: number | null;
  /**
   * Something picked *inside* this row, without the row itself being picked.
   *
   * Two states rather than one, because they are two things a reader undoes
   * separately: a leaguemate row can be the subject, or hold a combo subject,
   * or both, or neither.
   */
  lit: boolean;
  /** What it holds, named — the only thing a collapsed row says about a combo. */
  subline: string | null;
  /** {@link held} as a share of the counted leagues, folded once. */
  pct: number;
  /** The name, lower-cased once, for the search. */
  search: string;
  /** This row's `subjectSlot`, for the selection. */
  slot: string;
};

/* ------------------------------------------------------------------ */

export function SharesConsole({
  leagues,
  leagueTotal,
  filterSummary,
  players,
  leaguemates,
  rosters,
  selfId,
  subjects,
  onToggle,
  onMode,
  chromeClass = "",
}: {
  /** League-filtered, subject-unnarrowed — see the module note. */
  leagues: readonly ManagerLeague[];
  /** Every league on the page, for the bar's population readout. */
  leagueTotal: number;
  /** What the league filters left, or null for nothing active. */
  filterSummary: string | null;
  players: SharesRead<ManagerPlayersPayload>;
  leaguemates: SharesRead<ManagerLeaguematesPayload>;
  /**
   * Every roster in those leagues — the three mode counts, the mode's own
   * league list, and a leaguemate's board.
   *
   * Its absence costs exactly those and nothing else: both lists, the four
   * facets and the resting `owned` narrowing all read the payloads above, so a
   * slow or failed read here is a pair of em dashes and a sentence rather than
   * a console that cannot open.
   */
  rosters: SharesRead<ManagerLeaguemateRostersPayload>;
  /**
   * The page's manager, so a roster of theirs is told from a leaguemate's.
   * Null before the leagues stream answers, which reads as "nothing is owned" —
   * the honest arm, where treating it as "everything is taken" would be a
   * narrowing built out of a payload that has not landed.
   */
  selfId: string | null;
  subjects: LeagueSubjects;
  onToggle: (subject: Subject) => void;
  onMode: (playerId: string, mode: SubjectMode) => void;
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
  const open = useSharesConsoleOpen();
  const tab = useSharesTab();

  /**
   * The console's own reading state, none of it persisted.
   *
   * These are ways of reading a list rather than device preferences — the call
   * `SharesDrawer` already made about `sort`, and the one `StatBoard` makes
   * about all of its. What *is* remembered is the open flag and the tab, which
   * are a place to be rather than a question asked; see `shares-console-open`.
   */
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  /**
   * The row the detail pane is reading.
   *
   * **A pick is not a narrowing**, which is the one thing about this console
   * that differs from the drawers it replaces: there, pressing a row *was* the
   * subject. Here it opens the pane, and the `Narrow grid` key inside it is
   * what edits the grid — which is what keeps "what am I looking at" and "what
   * is the grid filtered to" two states a reader can hold at once.
   */
  const [picked, setPicked] = useState<string | null>(null);
  const [filters, setFilters] = useState<PlayerFilterState>(NO_PLAYER_FILTERS);
  const [trayOpen, setTrayOpen] = useState(false);
  const [scope, setScope] = useState<RosterScope>("all");
  const [showAll, setShowAll] = useState(false);
  /**
   * The mode a picked player's pane is *reading*, for as long as no subject
   * carries one.
   *
   * **The mode in force has one spelling and it is the subject's** — see
   * `SubjectMode`, and `effectiveMode` below. This is the resting value the
   * pane falls back to before a reader has pressed `Narrow grid`, and it is
   * kept in step on every mode press so that clearing the narrowing does not
   * jump the pane back to a reading nobody chose.
   */
  const [restingMode, setRestingMode] = useState<SubjectMode>("owned");

  // Stable, so the tray and the facet panel under them are handed the same
  // props on every render of the page above — which re-renders this on every
  // line of the leagues stream.
  const clearFilters = useCallback(() => setFilters(NO_PLAYER_FILTERS), []);
  const toggleTray = useCallback(() => setTrayOpen((v) => !v), []);
  const pressSort = useCallback((key: SortKey) => setSort((held) => nextSort(held, key)), []);

  /**
   * Switching tabs clears the pick and returns the sort to `Share`.
   *
   * The pick is a row of *this* list and means nothing in the other; the sort
   * key may not even exist there (`Value` and `Age` are the player list's).
   * `Share` is the default in both, and it is the metric the population rule
   * exists to make honest.
   */
  const selectTab = useCallback((next: SharesTab) => {
    storeSharesTab(next);
    storeSharesConsoleOpen(true);
    setPicked(null);
    setSort(DEFAULT_SORT);
  }, []);

  /**
   * The query and the pick are cleared when the console closes, and the
   * selection is not.
   *
   * Every route out of the drawers cleared the query too; the *selection* is
   * the narrowing on the grid behind, which outlives the panel by design and is
   * named and undone by `SubjectTokens`. The pick goes with the query because a
   * detail pane is only ever read while the panel is up.
   *
   * **Adjusted during render rather than in an effect**, which is this page's
   * own idiom (`renderedSubject` in `leagues-home`) and the rule
   * `react-hooks/set-state-in-effect` enforces: a `setState` in an effect body
   * is a second render after paint, so the panel would fold with its old query
   * still in it for a frame. React re-runs this component before committing,
   * so the clear is part of the render that saw the console go down.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setPicked(null);
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
      if (event.key === "Escape") storeSharesConsoleOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* ---------------- the folds, released while shut ---------------- */

  /**
   * **Released while the console is down**, on the drawers' own terms: this
   * component is mounted for the page's life (the grid's subject narrowing
   * needs the maps behind it), and a `useMemo` holds its last value for as long
   * as it is. That is four hundred-odd `PlayerShare` objects and as many rows,
   * every one of them display work for a panel nobody is looking at.
   *
   * **What narrows the grid is untouched**, which is what makes this safe: that
   * reads the payloads' own maps (`rolls` in `leagues-home`), never these.
   */
  const playerFold = useMemo(
    () =>
      open && players.data
        ? playerShares(leagues, players.data.rosters, players.data.players)
        : null,
    [open, leagues, players.data],
  );
  const mateFold = useMemo(
    () =>
      open && leaguemates.data
        ? leaguemateShares(
            leagues,
            leaguemates.data.members,
            leaguemates.data.users,
            selfId,
          )
        : null,
    [open, leagues, leaguemates.data, selfId],
  );

  // Memoised rather than defaulted inline, so a render while a read is in
  // flight does not hand every memo below a new empty array to recompute from.
  const population = useMemo(() => playerFold?.players ?? [], [playerFold]);

  // Bounds off the population, so a board with no rookies offers no rookie
  // handle and next year's class arrives without an edit here.
  const ageBounds = useMemo(
    () => playerFilterBounds(population, (p) => p.age),
    [population],
  );
  const classBounds = useMemo(
    () => playerFilterBounds(population, (p) => p.draft_class),
    [population],
  );

  const rosterMap = rosters.data?.rosters ?? null;
  const playerNames = useMemo(() => rosters.data?.players ?? {}, [rosters.data]);

  /**
   * One pass over every stored roster, and its two readers both want every
   * person: the search matches a typed name against anybody's board, and a row
   * has to name the combos held on it without being opened. See `rosterIndex`.
   *
   * Gated on `open` with the folds above, and for a sharper version of the same
   * reason: this one walks *every stored roster*.
   */
  const index = useMemo(
    () => (open && rosterMap ? rosterIndex(leagues, rosterMap) : null),
    [open, leagues, rosterMap],
  );

  // Keyed by slot, never by key — see `subjectSlot`. A row is picked whatever
  // mode it is on, and a set of full keys would drop a row out of its own lit
  // state the moment a reader pressed `Taken`.
  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectSlot)),
    [subjects],
  );

  // The combos held, per person, so a row can say so. Names come from the same
  // map the chips are drawn from, and an id with no name falls back to itself —
  // a searchable token beats a blank.
  const combosByMate = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const subject of subjects.subjects) {
      if (subject.kind !== "leaguemate-player") continue;
      const at = subject.id.indexOf(":");
      if (at < 0) continue;
      const userId = subject.id.slice(0, at);
      const playerId = subject.id.slice(at + 1);
      const held = out.get(userId);
      const name = playerNames[playerId]?.name ?? playerId;
      if (held) held.push(name);
      else out.set(userId, [name]);
    }
    return out;
  }, [subjects, playerNames]);

  const playerRows = useMemo<ConsoleRow[]>(() => {
    if (!playerFold) return NO_ROWS;
    const counted = playerFold.league_count;
    return population
      .filter((p) => keepsPlayer(p, filters, ageBounds, classBounds))
      .map((player) => ({
        id: player.player_id,
        name: player.name,
        // **The position joins the note rather than standing in a bezel of its
        // own.** `filter(Boolean)` is what stops a player with no stored team
        // reading as `WR · ` — a dangling separator promising a fact that is
        // not there. `UNKNOWN_VALUE` keeps a player with no position reading
        // here the way he already reads in the `Pos` facet.
        note:
          [player.position ?? UNKNOWN_VALUE, player.team]
            .filter(Boolean)
            .join(" · ") || null,
        badge: {
          round: true,
          faceUrl: `https://sleepercdn.com/content/nfl/players/thumb/${player.player_id}.jpg`,
          label: player.name.charAt(0).toUpperCase(),
        },
        held: player.leagues.length,
        record: rowRecord(player.leagues),
        value: player.ktc_value,
        age: player.age,
        lit: false,
        subline: null,
        pct: counted > 0 ? Math.round((player.leagues.length / counted) * 100) : 0,
        search: player.name.toLowerCase(),
        slot: subjectSlot({ kind: "player", id: player.player_id }),
      }));
  }, [playerFold, population, filters, ageBounds, classBounds]);

  const mateRows = useMemo<ConsoleRow[]>(() => {
    if (!mateFold) return NO_ROWS;
    const counted = mateFold.league_count;
    return mateFold.mates.map((mate) => {
      const combos = combosByMate.get(mate.user_id);
      return {
        id: mate.user_id,
        name: mate.name,
        note: null,
        badge: {
          round: true,
          imageUrl: mate.avatar_url,
          label: mate.name.charAt(0).toUpperCase(),
        },
        held: mate.leagues.length,
        record: rowRecord(mate.leagues),
        value: null,
        age: null,
        // A lamp on the row rather than a pressed key: something inside it is
        // narrowing, which is a different thing from the row's own press and is
        // undone in a different place.
        lit: Boolean(combos),
        subline: combos ? `${combos.join(" · ")} held` : null,
        pct: counted > 0 ? Math.round((mate.leagues.length / counted) * 100) : 0,
        search: mate.name.toLowerCase(),
        slot: subjectSlot({ kind: "leaguemate", id: mate.user_id }),
      };
    });
  }, [mateFold, combosByMate]);

  const isPlayers = tab === "player";
  const all = isPlayers ? playerRows : mateRows;
  const read = isPlayers ? players : leaguemates;
  const counted = (isPlayers ? playerFold : mateFold)?.league_count ?? 0;
  const cols = COLUMNS[tab];

  /**
   * The search, deferred, so a keystroke does not block on re-sorting a
   * thousand rows — the drawer's own call.
   *
   * On the leaguemates tab a typed name matches a **person or a player they
   * roster**, which is what makes the placeholder honest. It is asked only with
   * a needle in hand, and off the index above rather than off a per-row string
   * built eagerly: a search text folded onto every row would be thirty-six
   * thousand names concatenated for every reader and spent only by one who
   * types.
   */
  const needle = useDeferredValue(query).trim().toLowerCase();
  const rows = useMemo(() => {
    const found = needle
      ? all.filter((row) => {
          if (row.search.includes(needle)) return true;
          if (isPlayers) return false;
          const held = index?.get(row.id);
          if (!held) return false;
          for (const id of held) {
            if ((playerNames[id]?.name ?? "").toLowerCase().includes(needle)) {
              return true;
            }
          }
          return false;
        })
      : all;
    const { key, ascending } = sort;
    return [...found].sort((a, b) => {
      if (key === "name") {
        const byName = NAME_ORDER.compare(a.name, b.name);
        return ascending ? byName : -byName;
      }
      const left = weightOf(a, key);
      const right = weightOf(b, key);
      // **Absent sorts last in either direction.** An unpriced player is off
      // KTC's board rather than the cheapest on it, and flipping the key must
      // not make him the dearest either.
      if (left === null && right === null) return NAME_ORDER.compare(a.name, b.name);
      if (left === null) return 1;
      if (right === null) return -1;
      if (left !== right) return ascending ? left - right : right - left;
      return NAME_ORDER.compare(a.name, b.name);
    });
  }, [all, needle, isPlayers, index, playerNames, sort]);

  const detail = useMemo(
    () => (picked ? (rows.find((r) => r.id === picked) ?? null) : null),
    [picked, rows],
  );

  /**
   * The mode in force on the picked player: the subject's where there is one,
   * and the pane's own resting reading otherwise.
   *
   * One spelling of the question, which is what the mode living on the subject
   * buys — two picks can sit on two modes, and the token above the grid names a
   * narrowing (`Chase · Taken`) rather than a player.
   */
  const pickedPlayerSubject =
    isPlayers && picked
      ? (pickedSubject(subjects, "player", picked) ?? null)
      : null;
  const mode: SubjectMode = pickedPlayerSubject?.mode ?? restingMode;

  const setMode = useCallback(
    (next: SubjectMode) => {
      // Written to both, and read from one. The resting value is kept in step so
      // that clearing the narrowing leaves the pane on the reading the reader
      // last chose rather than jumping back to one they did not.
      setRestingMode(next);
      if (picked && pickedPlayerSubject) onMode(picked, next);
    },
    [picked, pickedPlayerSubject, onMode],
  );

  /**
   * The three mode counts, **folded for the picked row and no other**.
   *
   * They are three walks of every stored roster; a memo over the whole list
   * would run them for four hundred players to answer for the one on screen.
   */
  const modeLeagues = useMemo(
    () =>
      isPlayers && picked && rosterMap
        ? playerModeLeagues(leagues, picked, rosterMap, selfId)
        : null,
    [isPlayers, picked, rosterMap, leagues, selfId],
  );
  const modeCounts = useMemo(
    () =>
      isPlayers && picked && rosterMap
        ? playerModeCounts(leagues, picked, rosterMap, selfId)
        : null,
    [isPlayers, picked, rosterMap, leagues, selfId],
  );

  const pick = useCallback((id: string) => {
    setPicked((held) => (held === id ? null : id));
  }, []);

  const facetCount = activeFilterCount(filters, ageBounds, classBounds);
  const held = subjects.subjects.length;

  return (
    /* Fixed to the bottom edge and centred on the shell's own `max-w-6xl`, so
       the case's shoulders line up with the rack's above. `pointer-events` is
       off on the section and back on inside it: the gutter either side is
       transparent, and a page that could not be clicked through it would be a
       hundred cards behind a pane of glass. */
    <section
      aria-label="Shares"
      /**
       * **The open height is a custom property the cascade sets, and the inline
       * style only ever reads it.**
       *
       * It has to be: the animated, positioned box is this section, so the
       * phone arm must reach *it* — and an inline style cannot carry a media
       * query. Written as a height on the case inside instead, the inner box
       * simply overflowed a section still sized at 62dvh, which at 390 is a
       * panel whose top half is drawn outside the thing that is supposed to be
       * sliding. Two whole declarations rather than a base and an override,
       * and no value interpolated into a class name: Tailwind finds classes by
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
      className={`lab-anim pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 transition-[height] duration-[340ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] [--shares-open-h:calc(100dvh-var(--rack-clear))] sm:[--shares-open-h:min(62dvh,calc(100dvh-var(--rack-clear)))] ${chromeClass}`}
      style={{
        height: open ? "var(--shares-open-h)" : "var(--shares-bar-h)",
      }}
    >
      <div
        className={`${SHARES_BAR_H} pointer-events-auto relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-t-[1.125rem] bg-[image:var(--panel-case-bg)] shadow-[var(--panel-case-shadow)]`}
      >
        <Bar
          open={open}
          tab={tab}
          onTab={selectTab}
          counted={counted}
          total={leagueTotal}
          summary={filterSummary}
          held={held}
          back={open && detail !== null}
          onList={() => setPicked(null)}
        />

        {/* Mounted only while up — see the module note. */}
        {open && (
          <div className="relative flex min-h-0 flex-1 gap-2 p-2 sm:gap-2.5 sm:p-2.5">
            {/* **Below `lg` the detail replaces the list**, which is the
                design's own phone arrangement: one pane at a time, and the
                bar's `‹ List` key is the way back. `display: none` on the
                hidden arm, so exactly one is ever in the accessibility tree. */}
            <div
              className={`min-w-0 flex-1 flex-col gap-2 sm:gap-2.5 lg:flex-[1.6_1_30rem] ${
                detail ? "hidden lg:flex" : "flex"
              }`}
            >
              <Ledge
                tab={tab}
                query={query}
                onQuery={setQuery}
                shown={rows.length}
                total={all.length}
                filters={filters}
                onFilters={setFilters}
                population={population}
                ageBounds={ageBounds}
                classBounds={classBounds}
                facetCount={facetCount}
                trayOpen={trayOpen}
                onToggleTray={toggleTray}
                onClearFilters={clearFilters}
              />
              <List
                rows={rows}
                cols={cols}
                sort={sort}
                onSort={pressSort}
                picked={picked}
                onPick={pick}
                chosen={chosen}
                loading={read.loading}
                error={read.error}
                onRetry={read.retry}
                empty={
                  isPlayers
                    ? "No players rostered in these leagues yet."
                    : "No leaguemates in these leagues yet."
                }
                narrowedEmpty={
                  isPlayers
                    ? "No player matches that narrowing."
                    : "No leaguemate matches that search."
                }
                narrowed={rows.length !== all.length}
              />
            </div>

            {/* The right pane stands *beside* the list where there is room and
                *in front of* it where there is not, and at rest above `lg` it
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
                    {isPlayers
                      ? "Press a player to see where you stand on him"
                      : "Press a leaguemate to see what they roster"}
                  </span>
                </p>
              ) : isPlayers ? (
                <PlayerDetail
                  row={detail}
                  mode={mode}
                  counts={modeCounts}
                  leagues={modeLeagues?.[mode] ?? null}
                  loading={rosters.loading}
                  error={rosters.error}
                  onRetry={rosters.retry}
                  users={leaguemates.data?.users ?? null}
                  narrowing={Boolean(pickedPlayerSubject)}
                  onMode={setMode}
                  onNarrow={() =>
                    onToggle({ kind: "player", id: detail.id, mode })
                  }
                />
              ) : (
                <MateDetail
                  row={detail}
                  leagues={leagues}
                  rosters={rosterMap}
                  loading={rosters.loading}
                  error={rosters.error}
                  onRetry={rosters.retry}
                  players={playerNames}
                  selfId={selfId}
                  scope={scope}
                  onScope={setScope}
                  showAll={showAll}
                  onShowAll={() => setShowAll((v) => !v)}
                  narrowing={chosen.has(detail.slot)}
                  onNarrow={() =>
                    onToggle({ kind: "leaguemate", id: detail.id })
                  }
                  isPicked={(playerId) =>
                    chosen.has(
                      subjectSlot({
                        kind: "leaguemate-player",
                        id: leaguematePlayerId(detail.id, playerId),
                      }),
                    )
                  }
                  onPick={(playerId) =>
                    onToggle({
                      kind: "leaguemate-player",
                      id: leaguematePlayerId(detail.id, playerId),
                    })
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The metric's own number for a row, or null where it has none. */
function weightOf(row: ConsoleRow, id: ColumnId): number | null {
  switch (id) {
    case "share":
      return row.held;
    case "record":
      return row.record?.pct ?? null;
    case "value":
      return row.value;
    case "age":
      return row.age;
  }
}

// One collator for the name tiebreak rather than `localeCompare` per
// comparison, which re-resolves the locale each call — a sort over a thousand
// rows is thousands of them, on every keystroke.
const NAME_ORDER = new Intl.Collator();

/**
 * What the panel is counting over, on the bar.
 *
 * **The denominator is leagues that contributed a roster or a member list**,
 * not the league count on the page: a league whose roster was never stored
 * contributes nothing and must not be counted, which is the rule
 * `PlayerShares.league_count` is written by. So a partly-synced account
 * legitimately reads `109 of 113`.
 */
function populationLine(
  counted: number,
  total: number,
  summary: string | null,
): string {
  const line = `${counted} of ${total} league${total === 1 ? "" : "s"}`;
  return summary ? `${line} · ${summary}` : line;
}

/* ------------------------------------------------------------------ */

/**
 * The collapsed bar, which is also the open one's header — a billet strip, and
 * the whole of it is the button.
 *
 * **The toggle is an `absolute inset-0` button rather than the strip itself**,
 * and it has to be one: the tab caps and `‹ List` are `<button>`s, and a
 * `<button>` inside a `<button>` is invalid and unreachable. So the strip is a
 * box, the toggle covers it under the content, and the content is
 * `pointer-events-none` with those keys re-enabled — a press anywhere else on
 * the bar still toggles, which is what "the bar is the whole control" means.
 * It is `StatBoard`'s `Bar` construction exactly.
 */
function Bar({
  open,
  tab,
  onTab,
  counted,
  total,
  summary,
  held,
  back,
  onList,
}: {
  open: boolean;
  tab: SharesTab;
  onTab: (tab: SharesTab) => void;
  counted: number;
  total: number;
  summary: string | null;
  /** How many subjects are picked — what a shut console still admits to. */
  held: number;
  /** A row is picked and the list is behind the pane — below `lg` only. */
  back: boolean;
  onList: () => void;
}) {
  return (
    <div className="relative flex h-[var(--shares-bar-h)] w-full shrink-0 items-center gap-2 overflow-hidden bg-[image:var(--billet-bg)] px-2 shadow-[var(--standing-strip-shadow)] sm:gap-3 sm:px-3.5">
      <BilletFinish />
      <button
        type="button"
        onClick={() => storeSharesConsoleOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "Collapse shares" : "Expand shares"}
        className="absolute inset-0 z-[1] cursor-pointer border-0 bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60"
      />
      {/* The content sits over the toggle and lets every press through to it;
          only the caps and `‹ List` take one back. */}
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

        {/* The lamp says the panel is live rather than a static table. It is
            the page's own pulsing lamp (`lab-anim animate-pulse`) rather than a
            second spelling of one.

            **The `image:` hint is not optional here**, and it is the
            difference between a lit pip and an invisible one: `--pip-lit-bg` is
            a *gradient*, and an arbitrary background with a bare `var()` and no
            hint compiles to `background-color` — an invalid declaration, which
            the browser drops, leaving a transparent disc with a glow around
            nothing. `league-config-window.tsx` has always written the hint and
            `stat-board.tsx` did not; both read it the same way now.

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

        {/* **The two tabs, in a channel cut into the case.**
            `CONSOLE_CHANNEL_METAL` and never `CONSOLE_CHANNEL` — that
            constant's own note carries the argument: its floor is a black
            alpha, right for a channel cut into *dark* stock, and this case is
            near-white in light mode, where 52% black is a hole punched through
            the part rather than a groove milled into it. */}
        <span
          role="group"
          aria-label="Which shares"
          className={`${CONSOLE_CHANNEL_METAL} pointer-events-auto flex shrink-0 items-center gap-1 p-1`}
        >
          <Cap lit={tab === "player"} onPress={() => onTab("player")}>
            Players
          </Cap>
          <Cap lit={tab === "leaguemate"} onPress={() => onTab("leaguemate")}>
            {/* Two spans switched by the cascade, not by state — a client
                component must not have to hydrate to learn a breakpoint. */}
            <span className="sm:hidden">Mates</span>
            <span className="hidden sm:inline">Leaguemates</span>
          </Cap>
        </span>

        <span
          aria-hidden
          className="hidden h-6 w-px shrink-0 bg-[image:var(--groove)] shadow-[var(--groove-highlight)] sm:block"
        />

        {/* **Gone below `sm`**: truncated it reads `8 of…`, which states nothing
            and still costs the caret its place. */}
        <span className="hidden min-w-0 flex-1 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-label)] [text-shadow:var(--standing-label-shadow)] sm:inline">
          {populationLine(counted, total, summary)}
        </span>

        {/* A shut console says nothing otherwise — the same argument
            `SubjectTokens` and the drawer's `populationNote` are written on. */}
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
 * One cap in one of the channels, lit or not — the rack's own key.
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
      className={`touch:min-h-11 shrink-0 whitespace-nowrap rounded-full border bg-transparent px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-9)] uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 lg:text-[length:var(--fs-10)] ${className} ${
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
 * The search, the count and the filters — in a hole cut into the case. The
 * sort is the list's own column heads (see `HeadKey`), and position is one of
 * the tray's facets rather than a strip of its own: the strip only ever wrote
 * the same `filters.positions` the tray's `Pos` row does, four of its values.
 *
 * A `--case-well-bg` recess rather than a panel: what sits in it is a set of
 * controls, and the case is the part they are set into. One wrapping row above
 * `lg` and stacked below, which is `StatBoard`'s `Ledge` and its arrangement.
 */
function Ledge({
  tab,
  query,
  onQuery,
  shown,
  total,
  filters,
  onFilters,
  population,
  ageBounds,
  classBounds,
  facetCount,
  trayOpen,
  onToggleTray,
  onClearFilters,
}: {
  tab: SharesTab;
  query: string;
  onQuery: (value: string) => void;
  shown: number;
  total: number;
  filters: PlayerFilterState;
  onFilters: (next: PlayerFilterState) => void;
  population: React.ComponentProps<typeof PlayerFilters>["players"];
  ageBounds: React.ComponentProps<typeof PlayerFilters>["ageBounds"];
  classBounds: React.ComponentProps<typeof PlayerFilters>["classBounds"];
  facetCount: number;
  trayOpen: boolean;
  onToggleTray: () => void;
  onClearFilters: () => void;
}) {
  const isPlayers = tab === "player";
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
          <span className="sr-only">
            {isPlayers ? "Search players" : "Search leaguemates and players"}
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            /* **The leaguemate placeholder names both**, because the search
               matches a typed name against a person *or* a player they roster —
               see the console's `needle`. A placeholder that said only one
               would leave the other undiscoverable. */
            placeholder={
              isPlayers ? "Search players" : "Search leaguemates and players"
            }
            className="w-full min-w-0 border-0 bg-transparent py-2 font-mono text-[length:var(--fs-12)] tracking-[0.04em] text-[color:var(--billet-name)] outline-none placeholder:text-[color:var(--readout-label)]"
          />
        </label>

        {/* **The denominator only where it says something.** At rest the
            design draws the bare figure, and a `471 / 471` beside it would be
            the same number twice; narrowed, what a reader wants is what it was
            narrowed *from*. */}
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

      {/* The facet tray rides as its own key — see `PlayerFilters`. Three rules
          keep a shut tray from costing the list anything, and each was a bug:

          - **`basis-full` only at `lg`.** It is what puts the tray on a line of
            its own in the wrapping row; below `lg` the ledge is a *column*, so
            the same basis is 100% of its height — indefinite, so read as the
            tray's content height — and a shut tray stood at its full open
            height (378px), invisible, pushing the list down under it.
          - **The tray is always last** (`order-last`), so the one gap its
            negative margin cancels is the one above it, at both widths.
          - **The margin is each arm's own gap** — `gap-1.5` in the column,
            `gap-2` in the row — so a shut tray leaves no stripe behind.

          The orders are on the key and the tray themselves: a `contents`
          wrapper is not a flex item, so an `order` on one applies to nothing. */}
      {isPlayers && (
        <PlayerFilters
          players={population}
          filters={filters}
          onChange={onFilters}
          ageBounds={ageBounds}
          classBounds={classBounds}
          open={trayOpen}
          onToggleOpen={onToggleTray}
          keyClassName="lg:order-5"
          trayClassName="order-last lg:basis-full"
          trayClosedClassName="-mt-1.5 lg:-mt-2"
        />
      )}
      {isPlayers && facetCount > 0 && (
        <button
          type="button"
          onClick={onClearFilters}
          className={`${CONSOLE_KEY_PILL_BARE} shrink-0 border-foreground/10 bg-[image:var(--key-metal)] px-2.5 py-1.5 text-[length:var(--fs-9)] tracking-[0.14em] text-foreground/80 shadow-[var(--key-shadow)] lg:order-6`}
        >
          Clear
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** The list: lit glass holding a sticky header and a scroller of rows. */
function List({
  rows,
  cols,
  sort,
  onSort,
  picked,
  onPick,
  chosen,
  loading,
  error,
  onRetry,
  empty,
  narrowedEmpty,
  narrowed,
}: {
  rows: readonly ConsoleRow[];
  cols: readonly ColumnId[];
  /** Which head the rows are ordered by, and which way — the head lights it. */
  sort: SortState;
  /** A press on a head — see `nextSort`. */
  onSort: (key: SortKey) => void;
  picked: string | null;
  onPick: (id: string) => void;
  chosen: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Nothing to list at all — a fact about the account. */
  empty: string;
  /** Nothing *left* — a fact about the reader's own narrowing. */
  narrowedEmpty: string;
  narrowed: boolean;
}) {
  return (
    <div className={`${CONSOLE_GLASS} @container flex min-h-0 flex-1 flex-col rounded-xl`}>
      <Scanlines />
      {/* **The read reports its failure**, where `useManagerLineups` swallows
          one: a lineup is an enhancement beside a list, and this panel is only
          this data — a silent failure is a list that opens empty with nothing
          saying why. The retry is what the latch makes necessary; see
          `SharesRead.retry`. */}
      {error ? (
        <p className="relative z-[1] m-0 flex flex-wrap items-center justify-between gap-2 px-3 py-6 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-error">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className={`${CONSOLE_KEY_PILL_BARE} border-foreground/12 px-2.5 py-1 text-[length:var(--fs-9)] tracking-[0.16em] text-foreground/72 hover:text-readout`}
          >
            Retry
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="relative z-[1] m-0 px-3 py-6 text-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.12em] text-[color:var(--readout-label)]">
          {loading ? "Reading…" : narrowed ? narrowedEmpty : empty}
        </p>
      ) : (
        <>
          {/* The column header, above the scroller so it does not travel with
              it, and **the only sort control** — see `HeadKey`.

              **Drawn at every width**, where it used to be gone below `@md`:
              it is a control now rather than a caption, and a phone reader
              who lost it would lose the sort. Below `@md` the row's cells wrap
              onto a second line, and the row is `justify-end` so that line
              sits flush right — exactly under these heads, which are the same
              fixed widths behind the same gap. */}
          <div
            className={`${CONSOLE_WINDOW_LEDGE} relative z-[2] mx-[3px] mt-[3px] flex items-center gap-2 rounded-[7px] py-1 pl-[0.6875rem] pr-[0.6875rem]`}
          >
            <HeadKey id="name" sort={sort} onSort={onSort} className="min-w-0 flex-1" />
            {cols.map((id) => (
              <HeadKey
                key={id}
                id={id}
                sort={sort}
                onSort={onSort}
                className="shrink-0 px-[0.375rem]"
                width={COLUMN_WIDTH[id]}
              />
            ))}
          </div>
          <ul className="lab-scroll-glass relative z-[1] m-0 flex min-h-0 flex-1 list-none flex-col gap-[5px] overflow-y-auto p-[3px]">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                cols={cols}
                picked={picked === row.id}
                narrowing={chosen.has(row.slot)}
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
 * One column head, as the key that sorts by it.
 *
 * **A press sorts by this column; a press on the lit head reverses it** — see
 * `nextSort`. The lit head carries the direction as an arrow, which is the one
 * thing the rail it replaced never had to say, since its directions were fixed.
 * The arrow is drawn only on the lit head, so an unlit head spends no width on
 * one: `Age ▲` is 32px of the 34 a `2.875rem` column leaves inside its gutter.
 *
 * The gutter is the cell's own `0.375rem`, so a head's label starts where the
 * figure under it does.
 */
function HeadKey({
  id,
  sort,
  onSort,
  className,
  width,
}: {
  id: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className: string;
  width?: string;
}) {
  const on = sort.key === id;
  const label = id === "name" ? "Name" : COLUMN_LABEL[id];
  return (
    <button
      type="button"
      onClick={() => onSort(id)}
      aria-pressed={on}
      aria-label={
        on
          ? `${SORT_LABEL[id]}, sorted ${sort.ascending ? "ascending" : "descending"} — press to reverse`
          : `Sort by ${SORT_LABEL[id]}`
      }
      style={width ? { width } : undefined}
      className={`${className} flex items-center gap-1 whitespace-nowrap rounded-[4px] text-left font-mono text-[length:var(--fs-9)] uppercase focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-active/60 ${
        id === "name" ? "tracking-[0.14em]" : "tracking-[0.1em]"
      } ${
        on
          ? "text-[color:var(--billet-accent)]"
          : "text-[color:var(--billet-label)] hover:text-readout"
      }`}
    >
      {/* **Below `@md` the name head reads `A–Z` / `Z–A`.** The cells wrap
          under the name there and sit flush right under the column heads, so
          the name's key has only the ~24px left of them — where `Name ▲` is 33
          and truncated to `N ▲`. The letters are the direction as well as the
          label, so that arm needs no arrow. */}
      {id === "name" ? (
        <>
          <span aria-hidden className="min-w-0 truncate tracking-normal @md:hidden">
            {on && !sort.ascending ? "Z–A" : "A–Z"}
          </span>
          <span className="hidden min-w-0 truncate @md:inline">{label}</span>
        </>
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
      {on && (
        <span
          aria-hidden
          className={`shrink-0 text-[length:var(--fs-8)] tracking-normal ${
            id === "name" ? "hidden @md:inline" : ""
          }`}
        >
          {sort.ascending ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

/**
 * One row, as a key that can be held down.
 *
 * **`memo`'d, and every prop is a value or a stable callback.** This component
 * is mounted for the page's life and the page above it re-renders on every
 * stream chunk, filter press and card toggle; without the memo that is a
 * thousand rows of ~30 nodes each reconciled to draw exactly what they drew.
 *
 * **Three states, and two of them are different claims.** Resting is the key at
 * rest; *picked* is the row the detail pane is reading and reads as pressed;
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
 * **Below `@md` the cells wrap onto a line of their own.** Four cells beside a
 * badge is ~330px of a ~342px row; unwrapped, the name collapses to nothing.
 * This is `ShareRow`'s existing finding and it lands identically here.
 */
const Row = memo(function Row({
  row,
  cols,
  picked,
  narrowing,
  onPick,
}: {
  row: ConsoleRow;
  cols: readonly ColumnId[];
  picked: boolean;
  narrowing: boolean;
  onPick: (id: string) => void;
}) {
  const on = picked || narrowing || row.lit;
  return (
    <li
      className={
        "lab-anim rounded-xl border bg-[image:var(--key-bg)] transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
        "motion-safe:hover:-translate-y-0.5 hover:border-active/40 hover:shadow-[var(--key-shadow),0_16px_26px_-14px_rgba(0,0,0,0.9),0_0_26px_-10px_var(--accent-glow)] " +
        (picked
          ? "border-active/50 shadow-[var(--key-shadow-pressed),inset_0_0_22px_color-mix(in_srgb,var(--accent)_14%,transparent),0_0_24px_-10px_var(--accent-glow)]"
          : narrowing || row.lit
            ? "border-active/50 shadow-[var(--key-shadow),0_0_24px_-10px_var(--accent-glow)]"
            : "border-foreground/9 shadow-[var(--key-shadow)]")
      }
    >
      <button
        type="button"
        onClick={() => onPick(row.id)}
        aria-pressed={picked}
        // `justify-end` moves only the wrapped cell line below `@md` (the name
        // is `flex-1`, so every other line is already full): it puts the cells
        // flush right, under the list's heads.
        className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 rounded-xl py-2 pl-[0.6875rem] pr-[0.6875rem] text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-active/60 @md:flex-nowrap"
      >
        <Badge badge={row.badge} selected={on} />

        {/* `basis` is the row minus the badge and its gap, so the cells cannot
            fit beside it and wrap to a line of their own. Above `@md` it is
            `auto` and the row is one line. */}
        <span className="min-w-0 flex-1 basis-[calc(100%-2.375rem)] @md:basis-auto">
          <span
            className={`block truncate text-[length:var(--fs-13)] tracking-[-0.005em] ${
              on ? "font-semibold text-readout" : "text-foreground/85"
            }`}
          >
            {row.name}
          </span>
          {row.note && (
            <span className="block truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46">
              {row.note}
            </span>
          )}
          {row.subline && (
            <span className="block truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-active">
              {row.subline}
            </span>
          )}
        </span>

        {cols.map((id) => (
          <Cell key={id} id={id} row={row} />
        ))}
      </button>
    </li>
  );
});

/**
 * The badge: a lit bezel with an initial, an avatar or a headshot in it.
 *
 * The console owns it rather than taking a node from the caller, on the
 * drawer's own two reasons: the bezel is this panel's surface, and the ink is a
 * *selected* state only the row knows.
 */
function Badge({
  badge,
  selected,
}: {
  badge: ConsoleRow["badge"];
  selected: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex size-[1.875rem] shrink-0 items-center justify-center overflow-hidden rounded-full border border-foreground/12 bg-[image:var(--bezel-bg)] text-[length:var(--fs-12)] font-semibold shadow-[var(--bezel-shadow)] ${
        // A letter *behind* a face is a fallback rather than the content, so it
        // is drawn quieter than one that is the whole of what the bezel says.
        badge.faceUrl
          ? "text-foreground/50"
          : selected
            ? "text-readout"
            : "text-foreground/68"
      }`}
    >
      {badge.imageUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={badge.imageUrl} alt="" className="size-full object-cover" />
      ) : (
        badge.label
      )}
      {/* `bg-top`, never `bg-center`: a Sleeper headshot is framed head and
          shoulders, and a centred crop of one in a 1.875rem disc is a chin. */}
      {badge.faceUrl && (
        <span
          className="absolute inset-0 bg-cover bg-top"
          style={{ backgroundImage: `url(${badge.faceUrl})` }}
        />
      )}
    </span>
  );
}

/**
 * One readout cell — one shape, four metrics.
 *
 * **Missing values render an em dash, never a zero**: an unpriced player is off
 * KTC's board rather than worthless, a player with no stored age has no age
 * rather than an age of nothing, and a set of leagues that has played nothing
 * has no record rather than an `0–0`.
 *
 * **None of them is coloured.** `rankColor` says how *good* a position is, and
 * none of these four has a good — holding a player in nine leagues is a
 * different fact from holding him in one, not a better result. So the figure is
 * the readout's own ink and the meaning is in the number.
 */
function Cell({ id, row }: { id: ColumnId; row: ConsoleRow }) {
  let main = "—";
  let trail: string | null = null;
  let sub: string | null = null;
  let bar = false;

  switch (id) {
    case "share":
      // **The held count alone.** The bar above already states the population,
      // so a denominator on every row is the one figure that cannot differ
      // between rows, repeated a thousand times. The percentage and the meter
      // are what say "of what".
      main = String(row.held);
      trail = `${row.pct}%`;
      bar = true;
      break;
    case "record":
      if (row.record) {
        main = row.record.label;
        sub = row.record.pctLabel;
      }
      break;
    case "value":
      if (row.value != null) main = row.value.toLocaleString();
      break;
    case "age":
      if (row.age != null) main = String(row.age);
      break;
  }

  return (
    <span
      style={{ width: COLUMN_WIDTH[id] }}
      // The border is composed onto the *shell*, never appended to
      // `CONSOLE_WINDOW` — see that constant's split: two base border-colour
      // utilities of the same specificity are settled by Tailwind's emit order.
      // **The design's own `0.25rem 0.375rem`, not the drawer's `px-2 py-1.5`.**
      // A six-pixel gutter is what the four fixed widths are drawn against: at
      // eight, `9,412` at `--fs-13` wants 45px of the 44 a `3.75rem` Value cell
      // has left, and the cell's own `overflow-hidden` takes the last digit off
      // a price with nothing on screen saying so.
      className={`${CONSOLE_WINDOW_SHELL} flex shrink-0 flex-col justify-center gap-0.5 self-stretch rounded-[0.4375rem] border-black/85 px-[0.375rem] py-1`}
    >
      <Scanlines />
      <span
        className={`relative flex items-baseline justify-between gap-1 whitespace-nowrap font-mono leading-[1.2] tabular-nums text-readout [text-shadow:var(--readout-text-glow)] ${CELL_TEXT[id]}`}
      >
        <span>{main}</span>
        {trail && (
          <span className="text-[length:var(--fs-9)] text-readout-label">
            {trail}
          </span>
        )}
      </span>
      {sub && (
        <span className="relative font-mono text-[length:var(--fs-9)] leading-[1.2] tabular-nums text-readout-label">
          {sub}
        </span>
      )}
      {bar && (
        <span
          aria-hidden
          className="relative mt-0.5 block h-[3px] rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
        >
          <span
            className="block h-[3px] rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
            // A held row is never drawn empty: at 1 of 113 a true-width bar is
            // invisible and reads as "none" rather than as "one".
            style={{ width: `${Math.max(row.pct, row.held > 0 ? 6 : 0)}%` }}
          />
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */

/** The detail pane's own header: the subject, its note, and the controls. */
function DetailLedge({
  row,
  narrowing,
  onNarrow,
  narrowLabel,
  children,
}: {
  row: ConsoleRow;
  narrowing: boolean;
  onNarrow: () => void;
  /** What the grid would be narrowed *to* — the key's accessible name. */
  narrowLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`${CONSOLE_WINDOW_LEDGE} relative z-[2] mx-1.5 mt-1.5 flex shrink-0 flex-col gap-1.5 rounded-[7px] px-2.5 py-2`}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-[length:var(--fs-15)] font-semibold text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)]">
          {row.name}
        </span>
        {row.note && (
          <span className="shrink-0 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-[color:var(--billet-label)]">
            {row.note}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {children}
        {/* **One key, not a press on every row.** Every league in this pane
            narrows to the same set, so a row here is a reading and this is the
            control; pressed, it says the grid behind is already on it. */}
        <button
          type="button"
          onClick={onNarrow}
          aria-pressed={narrowing}
          aria-label={
            narrowing ? `Stop narrowing to ${narrowLabel}` : `Narrow the league grid to ${narrowLabel}`
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

/**
 * A picked player: which leagues each of the three readings answers for, and
 * the key that puts one on the grid.
 */
function PlayerDetail({
  row,
  mode,
  counts,
  leagues,
  loading,
  error,
  onRetry,
  users,
  narrowing,
  onMode,
  onNarrow,
}: {
  row: ConsoleRow;
  mode: SubjectMode;
  counts: React.ComponentProps<typeof PlayerModeTrack>["counts"];
  /** The leagues on the chosen arm, or null while the rosters read is out. */
  leagues: readonly { league: ManagerLeague; holder: string | null }[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Where a holder's id becomes a name — the leaguemates payload's own map. */
  users: ManagerLeaguematesPayload["users"] | null;
  narrowing: boolean;
  onMode: (mode: SubjectMode) => void;
  onNarrow: () => void;
}) {
  return (
    <>
      <DetailLedge
        row={row}
        narrowing={narrowing}
        onNarrow={onNarrow}
        narrowLabel={`${row.name}, ${MODE_WORD[mode]}`}
      />
      <div className="lab-scroll-glass relative z-[1] min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1.5">
        {/* Unchanged — the mode lives on the subject, which is what lets two
            picks sit on two modes and the token above the grid name a narrowing
            rather than a player. */}
        <PlayerModeTrack
          mode={mode}
          counts={counts}
          onPick={onMode}
          playerName={row.name}
        />
        {leagues === null ? (
          <p className="m-0 flex flex-wrap items-center justify-between gap-2 px-2.5 py-3 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46">
            <span>
              {error ?? (loading ? "Reading rosters…" : "No rosters read yet.")}
            </span>
            {error && (
              <button
                type="button"
                onClick={onRetry}
                className={`${CONSOLE_KEY_PILL_BARE} border-foreground/12 px-2 py-0.5 text-[length:var(--fs-9)] tracking-[0.16em] text-foreground/72 hover:text-readout`}
              >
                Retry
              </button>
            )}
          </p>
        ) : leagues.length === 0 ? (
          <p className="m-0 px-2.5 py-3 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46">
            {`No league on this reading — see the other two.`}
          </p>
        ) : (
          /* **The tiles are readings, not controls.** Every league in this
             pane narrows to the same set, so a press on one would be the
             header key's press wearing a second glyph — and the design's own
             prototype does exactly that while drawing the tile unlit, which is
             a control that edits the grid with nothing on it saying so. They
             are `<li>`s. */
          <ul
            className="m-0 grid list-none gap-[0.3125rem] p-0"
            style={{
              gridTemplateColumns: "repeat(auto-fill,minmax(15rem,1fr))",
            }}
          >
            {leagues.map(({ league, holder }) => {
              const record = rowRecord([league]);
              return (
                <li
                  key={league.league_id}
                  className={`${CONSOLE_TILE_DRAWER} relative flex items-center gap-2 rounded-[0.4375rem] px-2 py-1.5`}
                >
                  <BilletFinish />
                  <span
                    aria-hidden
                    className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-[0.3125rem] border border-foreground/12 bg-[image:var(--bezel-bg)] font-mono text-[length:var(--fs-8)] uppercase text-foreground/68 shadow-[var(--bezel-shadow)]"
                  >
                    {league.name.charAt(0)}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--fs-12)] text-foreground/90">
                      {league.name}
                    </span>
                    {/* **Who has him, in words.** `You` on the owned arm,
                        `Nobody` on the free one, and the leaguemate's own name
                        where there is one — the same map every other row on
                        this page names people through, falling back to the id
                        on `PlayerShare`'s rule that a token beats a blank.

                        It is lit on `taken` alone, which is the only arm where
                        the line is a *name* rather than the word the mode has
                        already said. */}
                    <span
                      className={`block truncate font-mono text-[length:var(--fs-8)] uppercase tracking-[0.16em] ${
                        mode === "taken" ? "text-active" : "text-foreground/46"
                      }`}
                    >
                      {holder
                        ? (users?.[holder]?.display_name ?? holder)
                        : mode === "owned"
                          ? "You"
                          : "Nobody"}
                    </span>
                  </span>
                  {/* A record of nothing is a claim that they went winless, so
                      a league that has played none draws the dash. */}
                  <span
                    className={`${CONSOLE_WINDOW} relative inline-flex min-w-7 shrink-0 justify-center rounded-[0.375rem] px-[0.3125rem] py-[0.1875rem] font-mono text-[length:var(--fs-11)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]`}
                  >
                    <Scanlines />
                    <span className="relative">{record?.label ?? "—"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

/** How a mode reads in the `Narrow grid` key's accessible name. */
const MODE_WORD: Record<SubjectMode, string> = {
  owned: "the leagues you roster him in",
  taken: "the leagues a leaguemate rosters him in",
  available: "the leagues nobody rosters him in",
};

/**
 * A picked leaguemate: the leagues shared with them behind one key, and their
 * whole board as chips.
 *
 * **A chip's press is independent of the row's**, which is the thing the pane
 * exists for: `Slim` narrows to the leagues shared with Slim and `Slim · Chase`
 * narrows to the ones where Slim holds Chase, and both can be lit at once.
 *
 * **`LeaguemateRosterRail` is mounted unchanged**, inside this pane's own
 * `@container` so its two-column arm resolves against the pane's width rather
 * than the viewport's — which is what makes "as-is" mean the same thing here as
 * it did in the drawer that used to hold it.
 */
function MateDetail({
  row,
  leagues,
  rosters,
  loading,
  error,
  onRetry,
  players,
  selfId,
  scope,
  onScope,
  showAll,
  onShowAll,
  narrowing,
  onNarrow,
  isPicked,
  onPick,
}: {
  row: ConsoleRow;
  leagues: readonly ManagerLeague[];
  rosters: ManagerLeaguemateRostersPayload["rosters"] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  players: ManagerLeaguemateRostersPayload["players"];
  selfId: string | null;
  scope: RosterScope;
  onScope: (scope: RosterScope) => void;
  showAll: boolean;
  onShowAll: () => void;
  narrowing: boolean;
  onNarrow: () => void;
  isPicked: (playerId: string) => boolean;
  onPick: (playerId: string) => void;
}) {
  const board = useMemo(
    () =>
      rosters
        ? leaguematePlayers(leagues, row.id, rosters, players, selfId, scope)
        : null,
    [rosters, leagues, row.id, players, selfId, scope],
  );

  return (
    <>
      <DetailLedge
        row={row}
        narrowing={narrowing}
        onNarrow={onNarrow}
        narrowLabel={`the leagues you share with ${row.name}`}
      >
        <ScopeTrack scope={scope} onPick={onScope} />
      </DetailLedge>
      <div className="lab-scroll-glass @container relative z-[1] min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1.5">
        {board === null ? (
          <p className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/[0.28] px-2.5 py-3 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/46 shadow-[var(--track-shadow)]">
            <span>
              {error ?? (loading ? "Reading rosters…" : "No rosters read yet.")}
            </span>
            {error && (
              <button
                type="button"
                onClick={onRetry}
                className={`${CONSOLE_KEY_PILL_BARE} border-foreground/12 px-2 py-0.5 text-[length:var(--fs-9)] tracking-[0.16em] text-foreground/72 hover:text-readout`}
              >
                Retry
              </button>
            )}
          </p>
        ) : (
          <LeaguemateRosterRail
            players={
              showAll ? board.players : board.players.slice(0, RAIL_PREVIEW)
            }
            leagueCount={board.league_count}
            total={board.players.length}
            showingAll={showAll}
            onShowAll={onShowAll}
            isPicked={isPicked}
            onPick={onPick}
            mateName={row.name}
          />
        )}
      </div>
    </>
  );
}

/**
 * Which of a leaguemate's players the rail lists.
 *
 * It narrows the *board inside the pane* rather than the list of rows, which is
 * why it is a `Roster` label rather than a second `Filters` key. The labels
 * shorten below `@md` rather than the keys wrapping — two spans switched by the
 * cascade, not by state.
 */
const SCOPES: { id: RosterScope; label: string; short: string }[] = [
  { id: "all", label: "All", short: "All" },
  { id: "shared2", label: "2+ shared", short: "2+" },
  { id: "mine", label: "Also mine", short: "Mine" },
];

function ScopeTrack({
  scope,
  onPick,
}: {
  scope: RosterScope;
  onPick: (scope: RosterScope) => void;
}) {
  return (
    <span className="inline-flex items-center gap-[0.4375rem]">
      <span className="shrink-0 font-mono text-[length:var(--fs-8)] uppercase tracking-[0.18em] text-foreground/42">
        Roster
      </span>
      {/* **`CONSOLE_TRACK`, not the bar's channel**, and that is a decision
          rather than an inconsistency: this sits exactly where
          `PlayerModeTrack` sits on the other tab, so the two have to be one
          recess. A channel is what the *bar* cuts into the case for a set of
          caps; a track is the key stock a single travelling key runs in, which
          is what both of these are. */}
      <span
        className={`${CONSOLE_TRACK} inline-flex items-center gap-1 p-1`}
        role="group"
        aria-label="Which of their players"
      >
        {SCOPES.map(({ id, label, short }) => {
          const on = scope === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              aria-pressed={on}
              aria-label={label}
              className={
                "touch:min-h-11 inline-flex shrink-0 items-center rounded-full border px-2.5 py-[0.3125rem] font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 " +
                (on
                  ? "border-active/55 bg-[image:var(--key-bg)] text-readout [text-shadow:var(--readout-text-glow)] shadow-[var(--key-shadow),inset_0_0_14px_color-mix(in_srgb,var(--accent)_16%,transparent)]"
                  : "border-transparent text-foreground/58 hover:text-readout")
              }
            >
              {/* The labels shorten below `@md` rather than the keys wrapping —
                  two spans switched by the cascade, not by state. */}
              <span aria-hidden className="@md:hidden">
                {short}
              </span>
              <span aria-hidden className="hidden @md:inline">
                {label}
              </span>
            </button>
          );
        })}
      </span>
    </span>
  );
}
