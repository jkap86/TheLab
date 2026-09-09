"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ManagerLineupsPayload } from "@/shared/contract";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  BILLET_KEY_CHROME,
  CONSOLE_KEY,
  CONSOLE_METAL_TRACK_SM,
  FlaskDefs,
  LeagueFiltersDialog,
  LineupColumnsDialog,
  slotsInHand,
  ManagerBillet,
  matchesFilters,
  matchesSubjects,
  NO_SUBJECTS,
  parseLeaguematePlayerId,
  PLATE_KEY,
  removeSubject,
  setSubjectMode,
  shortName,
  SubjectTokens,
  toggleSubject,
  type LeagueSubjects,
  type Subject,
  type RackDrawerKey,
  type SubjectMode,
  type SubjectRolls,
  invalidateLeagueLineups,
  useActiveCard,
  usePublishRackControls,
  useKtcBoard,
  useLineupColumns,
  useSummaryReadings,
  toggleSummaryReadings,
  useTeamsColumn,
  useManagerLeagues,
} from "@/features/shared";

import { useManagerLineups } from "../hooks/use-manager-lineups";
import {
  useManagerLeaguemateRosters,
  useManagerLeaguemates,
  useManagerPlayers,
} from "../hooks/use-manager-shares";
import {
  leagueOwners,
  modeRolls,
  leaguematePlayerRolls,
} from "../helpers/leaguemate-rosters";
import { LeaguematesMark, PlayersMark } from "./browse-marks";
import { LeagueCard } from "./league-card";
import { LeaguemateSharesDrawer } from "./leaguemate-shares-drawer";
import { PlayerSharesDrawer } from "./player-shares-drawer";
import { SeasonSummary } from "./season-summary";

/** How a moded player pick reads in the token tray — see `subjectName`. */
const MODE_WORDS: Record<SubjectMode, string> = {
  owned: "Owned",
  taken: "Taken",
  available: "Available",
};

/**
 * What the columns dialog is handed before the lineups read lands. Module
 * scope rather than `?? []` at the call site: a fresh array per render is a
 * changed prop per render, and this page renders on every stream chunk.
 */
const EMPTY_KTC: ManagerLineupsPayload["ktc"] = [];

/**
 * The two Browse keys this page puts in the rack: their legends, and the
 * glyphs the rack draws them as below `md`.
 *
 * **Module scope, not a literal in the render**, and that is the requirement
 * `usePublishRackControls` states rather than a habit: the publish effect
 * depends on this array, so one rebuilt each render would publish each render,
 * set an ancestor's state and re-render — a loop rather than a stale value.
 * The two `icon` elements are built once here for the same reason.
 *
 * The glyphs are this folder's — see `browse-marks.tsx` — because the rack
 * cannot `switch` on the route, which is the argument that made the legends
 * data one grain earlier.
 */
const BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "player", label: "Players", icon: <PlayersMark /> },
  { kind: "leaguemate", label: "Leaguemates", icon: <LeaguematesMark /> },
];

/**
 * A manager's leagues for a season, as one console.
 *
 * The five states are unchanged — which one shows still turns entirely on what
 * the stream has said so far, see {@link useManagerLeagues} — but each one now
 * has a surface of its own in the instrument vocabulary: the cold sync is a lit
 * readout with a segmented bar, the warm refresh is a readout pill above the
 * grid, and both empty states are plates. The pair in the middle is still the
 * one worth naming: a cold visit has nothing to show and gets the bar, while a
 * warm one shows its stored leagues immediately and puts the same sync's
 * progress in a pill above them. Both are the same stream.
 *
 * **The header is one plate, and it carries its own controls.** It was four
 * instruments on a row — the identity plate, a season housing, a Browse housing
 * and a View housing — and every one of them was a box saying something about
 * the same person. The season is engraved onto the plate itself now (see
 * {@link SeasonSummary}), and the four control keys went up into the app rack,
 * where they were reachable at any scroll depth rather than only at the top of
 * a hundred-league page.
 *
 * **Two of the four have since come back down**, and the reason is that up
 * there they were a second answer to a question this plate already had the
 * figure for. The rack's lit Filters key said "a filter is on"; the plate's
 * `Leagues 9 / 14` said the same thing with a number, and neither said what had
 * been narrowed — so the key, the count and the summary sentence are one strip
 * on the plate now (see {@link ManagerPlate}'s `controls`), and the columns
 * picker's key sits on its own row under it. The rack keeps the two Browse
 * keys, which open drawers rather than describing this page.
 *
 * **The rack is mounted in `layout.tsx`, so it cannot see this component's
 * state — and that is the real cost of putting anything up there.** The state
 * stays here, because everything else on the page reads it: `filters` and
 * `subjects` are the two narrowing passes, `drawer` and `opened` are what the
 * drawers below are mounted and opened by, and the per-subject reset during
 * render owns all four. What crosses the seam is one published object —
 * {@link usePublishRackControls}, now the drawer pair alone — and the rule that
 * comes with it is the one the tools menu already lives by: a page that
 * publishes nothing renders no controls.
 *
 * **The panel is gone.** The page used to draw a rounded, bordered panel with
 * `--background` showing around it; the ground in `layout.tsx` is that surface
 * now and runs to the viewport edges. With the rack floating above, a second
 * bounded rectangle inside the viewport read as a panel inside a panel.
 */
export function LeaguesHome({
  username,
  season,
  heading,
}: {
  username: string;
  season?: string;
  /** Static copy, rendered on the server — see the page. */
  heading: ReactNode;
}) {
  const state = useManagerLeagues(username, season);
  const { user, leagues, progress, refreshing, error, refreshError, stale } =
    state;
  /**
   * The leagues on screen are cache and nothing is coming to replace them.
   *
   * **This is the state the page had no way of admitting to.** The route serves
   * stored leagues without refreshing whenever the sync is throttled, deduped,
   * shed for want of an admission permit, or held by another caller's advisory
   * lock — and the hook now also lands here when a stream is cut before its
   * closing result. Every one of those looked identical to a refresh that had
   * just completed: no spinner, no error, no note, a list that might be minutes
   * or days old.
   *
   * Not drawn beside a `refreshError`, which says the same thing with a reason
   * attached, and not over an empty list, where "showing cached league data" is
   * a claim about data that is not there.
   */
  const showStale = stale && !refreshing && !refreshError && leagues.length > 0;
  // **Read off the unfiltered list, both of them.** `cold` decides whether the
  // page is a progress bar, and the gate below decides whether the lineups are
  // fetched at all; taken off the filtered list, a selection that matches
  // nothing would put the cold sync bar back on screen and suppress the solve
  // for every league on the account.
  const cold = leagues.length === 0 && refreshing;

  // **The selection is per-manager and unpersisted** — a way of reading this
  // list, not a device preference. The reset happens during render rather than
  // in an effect, the idiom `useManagerLeagues` documents: an effect would
  // paint one frame of the new manager's leagues under the old manager's
  // filters.
  const [filters, setFilters] = useState(DEFAULT_LEAGUE_FILTERS);
  // The drawers' half of the narrowing, on the same terms. `opened` is a latch
  // rather than the open flag: a picked subject keeps narrowing the grid after
  // its drawer closes, and the predicate still needs the map behind it.
  const [subjects, setSubjects] = useState<LeagueSubjects>(NO_SUBJECTS);
  const [drawer, setDrawer] = useState<Subject["kind"] | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<Subject["kind"]>>(new Set());

  const subject = `${username} ${season ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setFilters(DEFAULT_LEAGUE_FILTERS);
    // All four reset together: a subject picked for one manager narrows nothing
    // on the next, and a latch carried over would fetch the new manager's maps
    // before anyone asked to see them.
    setSubjects(NO_SUBJECTS);
    setDrawer(null);
    setOpened(new Set());
  }

  // The KTC market this device reads, for the shares drawer's Value column —
  // one figure for a player held across a dozen leagues, so there is no league
  // for `auto` to resolve against and the reader's stored answer is the only
  // one there is (`resolveKtcCrossLeagueFormat`).
  //
  // **The cards no longer read it**, which is what moving the market into the
  // bay changed: a column names its own board now, and a page-wide key would be
  // a second answer to a question four columns each give their own. What the
  // cards ask for instead is the *variants* their columns have forced — see
  // `useManagerLineups`.
  const ktcBoard = useKtcBoard();

  // Read once, by both drawers and by the predicate below — see the hook for
  // why the latch rather than `drawer !== null`.
  const players = useManagerPlayers(
    username,
    state.season,
    opened.has("player"),
    ktcBoard,
  );
  // **Latched on either drawer, like the rosters read below it**, and for the
  // same kind of reason one step further on. Its `users` map is the only place
  // a user id becomes a name and a face on this page, and the card's ownership
  // readout wants exactly that for a subject picked in the *players* panel —
  // where this drawer has never been opened. Gated on its own drawer alone, a
  // reader who narrowed to the leagues somebody else holds a player in would
  // get a billet naming a raw Sleeper id on every card.
  //
  // It is the cheap one of the three to widen: ~1,300 member ids and ~720 user
  // rows on a 113-league account, against every roster of every league for the
  // read below. See `ManagerLeaguematesPayload`.
  const leaguemates = useManagerLeaguemates(
    username,
    state.season,
    opened.has("leaguemate") || opened.has("player"),
  );
  // **Latched on either drawer**, which is the one of the three that is: the
  // leaguemate panel's rail wants it on open, and the players panel's three
  // mode keys want it one press later. See the hook.
  const leaguemateRosters = useManagerLeaguemateRosters(
    username,
    state.season,
    opened.has("leaguemate") || opened.has("player"),
  );

  const filtersActive = activeFilterCount(filters) > 0;
  const subjectsActive = subjects.subjects.length > 0;
  const narrowing = filtersActive || subjectsActive;
  // **The league filters only** — never the subject selection. A drawer's
  // readout says what population its shares are counted over, and the subjects
  // are picked *in* the drawers: naming them there would have the panel
  // describe a narrowing it is the source of.
  const leagueNarrowing = filtersActive ? filterSummary(filters) : null;

  // **The two narrowings are two passes and the order is the cheap one.** A
  // league rejected on its type never has its roster walked — and the drawers
  // count over exactly this intermediate list, never over the one below it.
  const leagueFiltered = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );
  /**
   * The starting seats this account's leagues actually run — the columns
   * picker's Slot vocabulary.
   *
   * **The unfiltered list, deliberately.** A column is a device preference that
   * outlives any narrowing — the same four bays answer every card on the page —
   * so a vocabulary that moved with the Filters dialog would take keys off a
   * track for a reason the panel cannot state, and a reader who had narrowed to
   * redraft would find the superflex seat they were comparing had gone. It is
   * the same population `cold` and the `useManagerLineups` gate read, and for
   * the same kind of reason.
   */
  const seatsInHand = useMemo(
    () => slotsInHand(leagues.map((league) => league.roster_positions)),
    [leagues],
  );
  // The two populations this page can answer a subject from, behind the
  // resolver `matchesSubjects` takes. The two kinds it does *not* answer for —
  // the lineup checker's week panels — come back null, which the predicate
  // reads as "nothing here can say" and ignores rather than failing either way.
  // **The two union maps, built once per payload and never per press.** Neither
  // mints a string — an entry is a reference to an id already parsed out of the
  // response — which is what makes them affordable over a payload this size.
  const unions = useMemo(
    () =>
      leaguemateRosters.data
        ? modeRolls(leaguemateRosters.data.rosters, user?.user_id ?? null)
        : null,
    [leaguemateRosters.data, user?.user_id],
  );

  // **The combo map is built only while a combo is held**, and that gate is a
  // boolean rather than the selection itself: it is the one map here that mints
  // a string per rostered player per league, and a reader who never expands a
  // leaguemate row should not pay for it. Gating on *whether* any is picked
  // rather than on *which* keeps the map's contents a fact about the payload
  // rather than about the query.
  const holdsCombo = subjects.subjects.some(
    (s) => s.kind === "leaguemate-player",
  );
  const combos = useMemo(
    () =>
      holdsCombo && leaguemateRosters.data
        ? leaguematePlayerRolls(leaguemateRosters.data.rosters)
        : null,
    [holdsCombo, leaguemateRosters.data],
  );

  /**
   * The one player whose owner the cards may name, or null.
   *
   * **Exactly one subject, of kind `player`, on the `taken` narrowing.** Each
   * of the three is a real bound rather than a convenience:
   *
   * - The billet names *one* player's owner, so two picked subjects would have
   *   it silently answer for whichever came first. A second bay is what that
   *   case wants and it is unbuilt — deliberately, rather than implied.
   * - `taken` is the only mode with an owner to name. On `owned` the manager
   *   holds him, and on `available` nobody does; a readout for either would be
   *   a claim the reader did not ask for, and the `You` / `Free` variants an
   *   earlier design pass carried were cut for exactly that.
   * - A leaguemate pick narrows to a *person*, not a player, so there is no
   *   subject for an owner to be the owner of.
   */
  const takenSubject =
    subjects.subjects.length === 1 &&
    subjects.subjects[0].kind === "player" &&
    subjects.subjects[0].mode === "taken"
      ? subjects.subjects[0].id
      : null;

  /**
   * League id → who holds him there, resolved to the name and face the billet
   * draws.
   *
   * **The rule is `leagueOwners`' and the names are the leaguemates payload's**,
   * which is the seam this keeps on the right side of: one spelling of *who
   * holds him* — the same fold the drawer's `Taken` count is read from, so the
   * card and the drawer cannot come to disagree — and one spelling of *who that
   * person is*, which is the map every other row on this page already names
   * people through.
   *
   * A stored row with no display name falls back to the id, on `PlayerShare`'s
   * rule that a token beats a blank; a person the users map has not named yet
   * does the same, which is what the frame between the two reads landing looks
   * like.
   *
   * Counted over `leagueFiltered` on the module's own population rule, and it
   * is a superset of the cards on screen either way.
   */
  const owners = useMemo(() => {
    if (takenSubject == null || !leaguemateRosters.data) return null;
    const users = leaguemates.data?.users;
    const out = new Map<string, { name: string; avatarUrl: string | null }>();
    for (const [leagueId, userId] of leagueOwners(
      leagueFiltered,
      takenSubject,
      leaguemateRosters.data.rosters,
      user?.user_id ?? null,
    )) {
      const row = users?.[userId];
      out.set(leagueId, {
        name: shortName(row?.display_name ?? userId),
        avatarUrl: row?.avatar_url ?? null,
      });
    }
    return out;
  }, [
    takenSubject,
    leagueFiltered,
    leaguemateRosters.data,
    leaguemates.data,
    user?.user_id,
  ]);

  const rolls = useCallback<SubjectRolls>(
    (kind, mode) => {
      if (kind === "player") {
        // `owned` is the manager's own rosters — the map this page has always
        // narrowed by, and deliberately not re-derived from the wider payload:
        // two spellings of one narrowing, and the wrong one would be the one
        // nobody was looking at.
        if (mode === "taken") return unions?.taken ?? null;
        if (mode === "available") return unions?.everyone ?? null;
        return players.data?.rosters ?? null;
      }
      if (kind === "leaguemate") return leaguemates.data?.members ?? null;
      if (kind === "leaguemate-player") return combos;
      return null;
    },
    [players.data, leaguemates.data, unions, combos],
  );
  const visible = useMemo(
    () =>
      leagueFiltered.filter((league) =>
        matchesSubjects(league.league_id, subjects, rolls),
      ),
    [leagueFiltered, subjects, rolls],
  );

  // A token names what the reader picked. The maps are the only place those
  // names live, so an id that outlives its payload falls back to itself rather
  // than to a blank chip.
  // A token names what the reader picked, and for the two new kinds that is a
  // pair rather than a name: `Slim · Chase` for a combo, `Chase · Taken` for a
  // moded pick. The maps are the only place those names live, so an id that
  // outlives its payload falls back to itself rather than to a blank chip.
  const playerName = (id: string) =>
    players.data?.players[id]?.name ??
    leaguemateRosters.data?.players[id]?.name ??
    id;
  const mateName = (id: string) =>
    leaguemates.data?.users[id]?.display_name ?? id;

  const subjectName = (s: Subject) => {
    if (s.kind === "leaguemate-player") {
      const pair = parseLeaguematePlayerId(s.id);
      return pair
        ? `${mateName(pair.userId)} · ${playerName(pair.playerId)}`
        : s.id;
    }
    if (s.kind === "leaguemate") return mateName(s.id);
    // The resting mode is what the token said before there were three, so it
    // still says it: a suffix on every player chip would be a word spent on the
    // reading a reader did not choose.
    const name = playerName(s.id);
    return s.mode && s.mode !== "owned"
      ? `${name} · ${MODE_WORDS[s.mode]}`
      : name;
  };

  const columns = useLineupColumns();
  // Whether the open card keeps its standing and four rank windows on screen —
  // one boolean per device, shared with the lineup checker's `Checks` key.
  // Composed with `open` per card below rather than passed as itself, so a
  // toggle moves one prop on the one card that is open. See `useSummaryReadings`.
  const readingsShown = useSummaryReadings();
  /**
   * What the expanded card's standings pane reads and is ordered by.
   *
   * Read once here rather than in each card, on the rule the rack's own
   * `columns` already follows: a hundred cards subscribing to one device
   * preference is a hundred subscriptions to buy nothing, and both the request
   * below and the cards need the same answer.
   */
  const teamsColumn = useTeamsColumn();

  // Fetched once the leagues settle — `!refreshing` flipping true is also what
  // refetches after a cold sync, when the rosters this read solves from were
  // just written. See the hook. The columns ride the request rather than being
  // applied here, because their ranks are the server's: only it can rank a
  // roster against the other eleven, and a forced market is a board only it can
  // price.
  /**
   * A sync landed, so every expanded card's stored answer is out of date.
   *
   * **This is the invalidation the per-league split needed.** A card's teams
   * are read once and kept — closing and re-opening must not pay again — which
   * is right until the rosters behind them are rewritten, and the leagues
   * stream settling is exactly when that has happened. The store re-asks for
   * the keys a card is still reading and drops the rest, so an open card
   * refreshes in place and a closed one costs nothing.
   *
   * The whole store rather than this page's keys: the event is rare (one per
   * refresh), and a trades card holding a stale league would want the same
   * news. Fired on the *transition*, not on the state, so a page that arrives
   * already settled does not throw away an answer it has just read.
   */
  const wasRefreshing = useRef(refreshing);
  useEffect(() => {
    const settled = wasRefreshing.current && !refreshing;
    wasRefreshing.current = refreshing;
    if (settled) invalidateLeagueLineups();
  }, [refreshing]);

  const { payload: lineups, pending: ranksPending } = useManagerLineups(
    username,
    state.season,
    leagues.length > 0 && !refreshing,
    // **The four bays and nothing else.** The standings pane's own column used
    // to ride this request, because its per-roster totals came off this
    // payload; they come off the expanded card's own per-league read now, so
    // changing what that pane is sorted by costs one open card's round trip
    // rather than the whole page's ranks. See `useManagerLineups`.
    columns,
  );

  // Sleeper lets a display name go missing, so the username is the fallback
  // everywhere this pair is shown.
  const name = user ? user.display_name || user.username : username;

  /**
   * **An open card is the screen, and it is a link** — `?league=<id>`. The
   * park, the lock and the param are all `useActiveCard`'s; what this page owns
   * is which rows it is allowed to open (`ids`) and standing its own header
   * down while one is.
   *
   * `ids` is the **narrowed** list, deliberately, and it is the one place the
   * two populations this file keeps apart come together: a filter or a subject
   * that takes the open league off the page closes the card rather than parking
   * a shell around a league nobody can see. It is also what re-validates a
   * deeplink as the stream fills in — an id that matches nothing on mount can
   * match a minute later, which on a route fed by NDJSON is the ordinary case
   * rather than an edge.
   */
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(() => visible.map((l) => l.league_id), [visible]);
  const card = useActiveCard({ param: "league", ids, listRef });
  // Read out so the handler below can depend on it by name: `close` is a
  // `useCallback` over a literal `param` and a stable helper, which is what
  // keeps `openDrawer` stable in turn.
  const { close: closeCard } = card;

  // Latch and open in one handler — never during render. It is a `useCallback`
  // because it crosses the rack seam below, where a new identity every render
  // would re-publish on every render and set an ancestor's state in a loop; see
  // `usePublishRackControls`.
  //
  // **It closes the open card first, and that is the point of the press rather
  // than tidiness.** These two drawers exist to *narrow the grid* — a player
  // row or a leaguemate row is a subject, and picking one leaves the leagues
  // they are in. While a card is parked there is no grid to narrow: the page is
  // locked, the header has stood down and every league but the open one is
  // `display: none`, so the reader picked a subject and watched one card that
  // may or may not still be in the selection, with the count that would have
  // told them off screen. The drawer is a modal over a page in the wrong state.
  //
  // So the press does what the reader means by it — take me back to the list I
  // am about to filter — and the collapse runs behind the drawer's own
  // backdrop, so the grid is standing again by the time they have picked. A
  // press with no card open is a no-op: `close` reads the URL and returns when
  // it names no card.
  const openDrawer = useCallback(
    (kind: Subject["kind"]) => {
      closeCard();
      setOpened((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
      setDrawer(kind);
    },
    [closeCard],
  );
  // The drawers' three handlers, stable for the page's life: each is a
  // functional update on a setter and closes over nothing else, and each is a
  // prop of a drawer that stays mounted and holds several hundred memo'd rows
  // — an inline arrow here would re-render every one of them on every stream
  // chunk and card toggle.
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const toggleDrawerSubject = useCallback(
    (s: Subject) => setSubjects((prev) => toggleSubject(prev, s)),
    [],
  );
  const setPlayerMode = useCallback(
    (playerId: string, mode: SubjectMode) =>
      setSubjects((prev) => setSubjectMode(prev, "player", playerId, mode)),
    [],
  );

  // **The two Browse keys, and nothing else.** Filters and Columns came back
  // down onto the plate and the tray under it — see the header below — so the
  // rack no longer needs the filter state, the unfiltered league list, the
  // column selection or the KTC pair, and none of them is published. Publishing
  // a field the rack does not read is a field that looks load-bearing to the
  // next reader of either file.
  usePublishRackControls({ keys: BROWSE_KEYS, drawer, onOpenDrawer: openDrawer });

  /**
   * What to say, and what to offer, when the grid narrows to nothing.
   *
   * **Which narrowing emptied it is the whole question**, and the page used to
   * answer it one way whatever the truth was. Two things narrow this grid — the
   * league rules and the subjects picked in the drawers — and they are undone by
   * two different controls, so a message naming the wrong one comes with a key
   * that does nothing: `Clear filters` over filters already at their defaults
   * leaves the reader looking at the same empty page, with the token tray above
   * it as the only clue and nothing pointing at it.
   *
   * It never renders with neither active — a page with nothing narrowing and no
   * visible leagues has no unfiltered leagues either, which is the arm above.
   */
  const emptyState = useMemo(() => {
    if (filtersActive && subjectsActive) {
      return {
        message: "No leagues match the current filters and selection.",
        summary: filterSummary(filters),
        action: "Clear all",
        clear: () => {
          setFilters(DEFAULT_LEAGUE_FILTERS);
          setSubjects(NO_SUBJECTS);
        },
      };
    }
    if (subjectsActive) {
      return {
        message: "No leagues match this selection.",
        // The tokens are named in the tray above rather than restated here: the
        // filter summary is a sentence nothing else on the page carries, where
        // a subject is a chip the reader can already see.
        summary: null,
        action: "Clear selection",
        clear: () => setSubjects(NO_SUBJECTS),
      };
    }
    return {
      message: "No leagues match these filters.",
      summary: filterSummary(filters),
      action: "Clear filters",
      clear: () => setFilters(DEFAULT_LEAGUE_FILTERS),
    };
  }, [filters, filtersActive, subjectsActive]);

  return (
    <div className="relative">
      {/* The page's own header stands down while a card is parked: it is
          `display: none` rather than unmounted, so the two dialogs it holds
          keep their draft state and neither is rebuilt when the card closes.
          `chromeClass` is what fades it out on the way there and in on the
          way back, with the other cards — see `useActiveCard`. */}
      <header className={`relative ${card.chromeClass}`}>
        <ManagerBillet
          name={name}
          avatarUrl={user?.avatar_url ?? null}
          /*
            **The Filters key sits on the header, not in the rack**, and the
            summary sentence sits under it. Up in the rack the key was a second
            answer to a question the header already carried the figure for: the
            rack's lit key said "a filter is on" and `Leagues 9 / 14` said the
            same thing with a number, while neither said *what* was narrowed.
            Here the key, the count and the sentence are one object, and
            pressing the key is a press away from the figure it moves.

            `leagues` is the **unfiltered** list deliberately — it is the
            population every count inside the dialog is taken over, and handing
            it the filtered one would collapse each of the dialog's own menus to
            the selection already made.
          */
          controls={
            leagues.length > 0 ? (
              <>
                {/* The keys are an item of the billet's own row: `order-3` puts
                    them beside the name on a phone, where `ml-auto` pins them
                    to the row's far end, and DOM order puts them at the end of
                    the desktop row after the gauge.

                    The track is the recess a raised key travels in, and below
                    `sm` there is no raised key to recess — the keys are etched
                    into the billet's face there, so the recess goes with them.
                    It is the *metal* track: a hole cut in a machined part
                    rather than a channel of key stock. */}
                <span
                  className={`relative order-3 ml-auto flex items-center gap-1.5 self-center sm:self-auto sm:p-1 lg:order-none lg:ml-0 ${CONSOLE_METAL_TRACK_SM}`}
                >
                  <LeagueFiltersDialog
                    filters={filters}
                    onChange={setFilters}
                    leagues={leagues}
                    triggerClassName={PLATE_KEY}
                    triggerChrome={BILLET_KEY_CHROME}
                  />
                  {/* Only while there is something to clear: a key that is a
                      no-op three quarters of the time is a key a reader stops
                      reading. */}
                  {activeFilterCount(filters) > 0 && (
                    <button
                      type="button"
                      onClick={() => setFilters(DEFAULT_LEAGUE_FILTERS)}
                      className={`${PLATE_KEY} ${BILLET_KEY_CHROME} border-foreground/10 text-foreground/80 hover:text-readout`}
                    >
                      Clear
                    </button>
                  )}
                </span>
                {/* The filter summary in words, which the View housing's
                    readout used to carry under its count and which then stood
                    alone under the header. It says the *filters* only: the
                    subject selection has the token tray below, where it can be
                    undone.

                    `w-full` at every width, where on the plate it took the row's
                    slack from `sm` up: the billet's row is a name column, two
                    wells, a 108px gauge and the keys, and there is no slack for
                    a sentence to take. Its ink is `--billet-accent` rather than
                    `text-active` for the reason every ink on this part is —
                    it is stamped on metal, and the page's accent is drawn for
                    the ground behind it. */}
                {leagueNarrowing && (
                  <p className="relative order-5 m-0 w-full min-w-0 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-accent)] lg:order-none">
                    {leagueNarrowing}
                  </p>
                )}
              </>
            ) : undefined
          }
          /* The copy is the page's and the *treatment* is the billet's — see
             `ManagerBillet`, which inks the whole eyebrow row so the season
             cannot come to be drawn differently from the word it qualifies. */
          eyebrow={
            <>
              {heading}
              {state.season && <span>· {state.season}</span>}
            </>
          }
        >
          {/* The season is engraved on the plate rather than standing beside it
              — and only once there is an account's worth of leagues to sum. It
              reads off `visible`, the list as narrowed, with `leagues.length`
              beside it as the denominator; see {@link SeasonSummary}. */}
          {leagues.length > 0 ? (
            <SeasonSummary
              leagues={visible}
              total={leagues.length}
              narrowing={narrowing}
            />
          ) : undefined}
        </ManagerBillet>

        {/*
          **The picker's key, and no tray around it.** This was `ColumnsStrip`:
          a `CONSOLE_WELL` holding a `Columns` label, one lit chip per chosen
          column and the key at `ml-auto`. The chips are gone — the designer's
          call — and with them the reason for the well, since a tray holding a
          single key reads as a hole rather than as a panel of controls. The
          key stands on the row on its own instead, right-aligned above the
          grid it configures.

          The bound the chips carried has moved again, and further in. It used
          to be the dialog refusing to clear the last bay standing; with every
          bay always set there is nothing to clear to, so the rule lives in
          `normalizeLineupColumns`, which tops a short selection back up to
          four. What it protects is unchanged and still silent when broken:
          `normalize` falls back to `DEFAULT_LINEUP_COLUMNS` when handed an
          *empty* array, which is right for a stale stored value and would be
          four columns nobody chose if a press could ever reach it.
        */}
        {leagues.length > 0 && (
          <div className="relative mt-3.5 flex items-center justify-end">
            <LineupColumnsDialog
              columns={columns}
              ktc={lineups?.ktc ?? EMPTY_KTC}
              slots={seatsInHand}
              triggerClassName={CONSOLE_KEY}
            />
          </div>
        )}
      </header>

      {/* One rule as the boundary before the grid. It used to carry the
          controls; it is only a boundary now. */}
      <div
        aria-hidden
        className={`relative my-9 h-px bg-gradient-to-r from-active/35 via-foreground/5 to-transparent ${card.chromeClass}`}
      />

      {/* The drawers hide their own state once closed, so the narrowing they
          applied has to be named somewhere the reader can see and undo it. */}
      {/* `contents` at rest so the page's layout is what it was; the
          stylesheet gives it a box for as long as it is fading, because opacity
          has no effect on an element that has none. */}
      <div className={`contents ${card.chromeClass}`}>
        <SubjectTokens
          subjects={subjects}
          names={subjectName}
          onRemove={(s) => setSubjects((prev) => removeSubject(prev, s))}
          onMatch={(match) => setSubjects((prev) => ({ ...prev, match }))}
          onClear={() => setSubjects(NO_SUBJECTS)}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="relative inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[length:var(--fs-13)] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
        >
          <span aria-hidden className="size-[0.4375rem] rounded-full bg-error shadow-[0_0_10px_var(--error)]" />
          {error}
        </p>
      ) : cold ? (
        <ColdProgress progress={progress} />
      ) : (
        <>
          {refreshing && (
            <p
              className={`relative mb-6 inline-flex items-center gap-3 rounded-full border border-foreground/8 bg-[image:var(--key-bg)] py-2 pl-2.5 pr-5 shadow-[var(--plate-shadow)] ${card.chromeClass}`}
              aria-live="polite"
            >
              <span className="relative inline-flex items-center gap-2.5 overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-1.5 shadow-[var(--readout-shadow)]">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
                />
                <span
                  aria-hidden
                  className="lab-anim relative size-[0.4375rem] rounded-full bg-active shadow-[0_0_10px_var(--accent-glow)]"
                  style={{ animation: "tools-pulse 2.4s ease-out infinite" }}
                />
                <span className="relative font-mono text-[length:var(--fs-13)] text-readout [text-shadow:var(--readout-text-glow)]">
                  {progress && progress.total > 0
                    ? `Refreshing ${progress.loaded} of ${progress.total}…`
                    : "Refreshing…"}
                </span>
              </span>
              <span className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
                Leagues below are what was stored
              </span>
            </p>
          )}
          {/* The quieter half of the same idea: nothing failed loudly, but the
              refresh did not land either, so the list below is stored data of
              unknown age. Drawn in the readout's own ink rather than the error
              tone — it is a fact about freshness, not a fault. */}
          {showStale && (
            <p
              role="status"
              className={`relative mb-6 inline-flex items-center gap-3 rounded-full border border-foreground/8 bg-[image:var(--key-bg)] py-2 pl-2.5 pr-5 shadow-[var(--plate-shadow)] ${card.chromeClass}`}
            >
              <span className="relative inline-flex items-center gap-2.5 overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-1.5 shadow-[var(--readout-shadow)]">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
                />
                <span
                  aria-hidden
                  className="relative size-[0.4375rem] rounded-full bg-readout-label"
                />
                <span className="relative font-mono text-[length:var(--fs-13)] text-readout-line">
                  Showing cached league data
                </span>
              </span>
              <span className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
                Refresh may be incomplete
              </span>
            </p>
          )}
          {/* A failed refresh is a note beside a usable list, never a
              replacement for it: the leagues below are what was stored, and
              they are still worth reading. */}
          {refreshError && (
            <p
              role="alert"
              className={`relative mb-6 inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[length:var(--fs-13)] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)] ${card.chromeClass}`}
            >
              <span aria-hidden className="size-[0.4375rem] rounded-full bg-error shadow-[0_0_10px_var(--error)]" />
              {refreshError}
            </p>
          )}
          {leagues.length === 0 ? (
            <Plate>
              <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                No leagues found{state.season ? ` for ${state.season}` : ""}.
              </p>
            </Plate>
          ) : visible.length === 0 ? (
            // A different claim from the one above: that one is about the
            // manager, this one is about the *narrowing* — and it is the
            // reader's to undo, so it says which narrowing and offers the key
            // that undoes exactly that one.
            //
            // **Three arms, because there are two narrowings.** The grid is
            // filtered by the league rules *and* by the subjects picked in the
            // drawers, and this used to blame the first for both: a page
            // emptied by a player nobody else rosters read "No leagues match
            // these filters" over a summary that said every league matched,
            // beside a Clear filters key that cleared filters already at their
            // defaults and changed nothing. The reader had to work out for
            // themselves that the token tray above was the thing narrowing.
            <Plate>
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                    {emptyState.message}
                  </p>
                  {emptyState.summary ? (
                    <p className="mt-2 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
                      {emptyState.summary}
                    </p>
                  ) : null}
                </div>
                {/* A real key, from the constant rather than a fourth copy of
                    the stack — a hand-spelled riser is how one of them stops
                    travelling. */}
                <button
                  type="button"
                  onClick={emptyState.clear}
                  className={CONSOLE_KEY}
                >
                  {emptyState.action}
                </button>
              </div>
            </Plate>
          ) : (
            <>
            {/* The flask's gradients and its clip, once for the whole page
                rather than once per rank window — a hundred cards' worth of
                windows is a great many copies of four gradients parsed for one
                identical result. `LineupMarkDefs`' arrangement and its reason,
                and mounted the same way: here, because this is the one place
                that knows there is a list of cards at all, and *beside* the
                list rather than inside it, since a `<ul>` takes `<li>` children
                and nothing else. See `FlaskDefs`. */}
            <FlaskDefs />
            {/* **The gap is the plate row's overhang, not a rhythm.** A league
                card's header hangs 13px above the card's own top edge, so the
                row has to carry that plus enough breath that one league's name
                does not sit on another league's foot. 18px is that overhang
                plus 5, and it is `lineupchecker-home.tsx`'s own figure for the
                same card — the two pages list the same leagues and a gap that
                differed between them would be a drift with nothing on screen
                saying which page a reader was on.

                It was 28px while the header was a milled billet, whose overhang
                is 20px rather than 13; that number comes back down with the
                ledge. The first card's plate has the filter summary's own
                margin above it.

                **`overflow-anchor: none`**, and it is load-bearing rather than
                tidy: opening a card parks it under the rack with a smooth
                scroll, and the panel that mounts on the same frame is exactly
                what scroll anchoring is built to compensate for — the browser
                sees content grow above the viewport's anchor and adjusts
                `scrollTop` to keep it still, which lands the card somewhere
                arbitrary and looks like the park having missed. Excluding this
                subtree is what leaves the park the only thing moving the page.
                See `ExpandedPanel`.

                **The list is the parked shell.** `shellProps` is a measured
                height, the plate's overhang as padding and a scroller that only
                ever engages where the panel hit its floor; off it is `{}` and
                this is the grid it always was. Which cards stand down is CSS
                reading the open disclosure — see `globals.css` — rather than a
                prop, so a hundred cards are not re-rendered to hide
                ninety-nine of them. */}
            <ul
              ref={listRef}
              {...card.shellProps}
              // **`lab-card-contain` is `content-visibility: auto` on every
              // collapsed card**, plus the padding and negative margin that
              // keep the billet's overhang inside the box paint containment
              // clips — see `globals.css`, where the measurement is. It is a
              // class rather than a rule on `[data-card-list]` because the
              // trades board's cards are a different height and its list ends
              // in an infinite-scroll sentinel, which is the one arrangement a
              // first-layout height estimate could disturb.
              className="lab-card-contain relative m-0 mt-2 grid list-none grid-cols-1 gap-[1.125rem] p-0 [overflow-anchor:none]"
            >
              {visible.map((league) => (
                <LeagueCard
                  key={league.league_id}
                  league={league}
                  columns={columns}
                  summary={lineups?.leagues[league.league_id] ?? null}
                  // **A fact about the page, not about this league**, and that
                  // is the whole of why it is threaded rather than read off
                  // `summary` beside it. A null summary is two states — the
                  // read has not landed, and the read landed and does not
                  // answer for this league — and only the first is a window
                  // that should say it is working. The second is permanent:
                  // this list carries a league the manager was chopped out of
                  // and the lineups query answers only for a league they hold
                  // a roster in, so that card's summary is null for as long as
                  // the page is open. See `ManagerLineupsState.pending`.
                  ranksPending={ranksPending}
                  // Who holds the picked player here, where a leaguemate does.
                  // **Two primitives rather than the row itself**, because the
                  // card is `memo`'d over every league on the account and an
                  // object built in this render would be a new reference on
                  // each one — see `LeagueCard`'s own note. Null on every card
                  // whenever there is no such narrowing, which is the resting
                  // state of this page.
                  ownerName={owners?.get(league.league_id)?.name ?? null}
                  ownerAvatarUrl={
                    owners?.get(league.league_id)?.avatarUrl ?? null
                  }
                  // The three that decide which boards a *past* stop is priced
                  // on. They are the same three the lineups read above was
                  // asked for the present, which is the whole point: a rewound
                  // roster measured on another season's projections or another
                  // market is not a comparison. The resolved season, never the
                  // page's raw query — see `parseRequestedSeason`.
                  season={state.season}
                  username={username}
                  // **What the card's standings pane reads, and therefore what
                  // its history rail prices on.** This was `board="auto"` — the
                  // right answer while that pane read `LeagueTeam.totals` on
                  // each league's own market whatever any bay had forced, since
                  // a past stop on a different board from the table in front of
                  // it is two numbers on two rulers. The pane names its own
                  // board now, so the rail follows *it* and the rule is
                  // unchanged.
                  teamsColumn={teamsColumn}
                  slots={seatsInHand}
                  open={card.isOpen(league.league_id)}
                  lit={card.isLit(league.league_id)}
                  onToggle={card.toggle}
                  // Whether this card's standing and four rank windows are
                  // folded away: only while it is open, and only while the
                  // device's readings preference is off. Composed here so a
                  // toggle moves one prop on the open card rather than
                  // dropping the memo on all 113 — see `useSummaryReadings`.
                  summaryFolded={
                    card.isOpen(league.league_id) && !readingsShown
                  }
                  onToggleReadings={toggleSummaryReadings}
                />
              ))}
            </ul>
            </>
          )}
        </>
      )}

      {/* Mounted once each kind has been opened, and kept: a closed drawer is
          `open={false}`, which is what lets its search state and its scroll
          position survive a second press. Both count over `leagueFiltered` —
          the population a selection is made *against*, never the one it
          leaves. */}
      {opened.has("player") && (
        <PlayerSharesDrawer
          open={drawer === "player"}
          onClose={closeDrawer}
          leagues={leagueFiltered}
          leagueTotal={leagues.length}
          filterSummary={leagueNarrowing}
          read={players}
          rosters={leaguemateRosters}
          selfId={user?.user_id ?? null}
          subjects={subjects}
          onToggle={toggleDrawerSubject}
          onMode={setPlayerMode}
        />
      )}
      {opened.has("leaguemate") && (
        <LeaguemateSharesDrawer
          open={drawer === "leaguemate"}
          onClose={closeDrawer}
          leagues={leagueFiltered}
          leagueTotal={leagues.length}
          filterSummary={leagueNarrowing}
          read={leaguemates}
          rosters={leaguemateRosters}
          selfId={user?.user_id ?? null}
          subjects={subjects}
          onToggle={toggleDrawerSubject}
        />
      )}
    </div>
  );
}

/** The recessed plate both empty states sit on. */
function Plate({ children }: { children: ReactNode }) {
  return (
    <div className="relative rounded-2xl border border-foreground/8 bg-[image:var(--plate-bg)] p-6 shadow-[var(--plate-shadow)]">
      {children}
    </div>
  );
}

/**
 * The first visit, where there is nothing stored to show yet.
 *
 * A determinate bar rather than a spinner, because the wait is proportional to
 * something the server knows and reports: a 50-league account is a genuinely
 * long fetch, and "38 of 53" is the difference between waiting and wondering.
 * Before the first progress event lands there is no total, so it says so in
 * words instead of drawing an empty bar at 0%.
 *
 * The bar is segmented (`--progress-fill`) rather than solid. On a lit readout
 * a solid fill reads as a painted rectangle; discrete segments read as an
 * instrument counting up, which is what this is.
 */
function ColdProgress({
  progress,
}: {
  progress: { loaded: number; total: number; failed: number } | null;
}) {
  const total = progress?.total ?? 0;
  const loaded = progress?.loaded ?? 0;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-black/85 bg-[image:var(--readout-bg)] px-6 py-5 shadow-[var(--readout-shadow)]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />
      <div className="relative flex flex-wrap items-baseline justify-between gap-4">
        <p
          className="m-0 font-mono text-[length:var(--fs-15)] text-readout [text-shadow:var(--readout-text-glow)]"
          aria-live="polite"
        >
          Syncing leagues from Sleeper…
        </p>
        {total > 0 && (
          <p className="m-0 font-mono text-[length:var(--fs-15)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {loaded} / {total}
          </p>
        )}
      </div>
      <div
        className="relative mt-4 h-2 overflow-hidden rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_4px_rgba(0,0,0,0.95)]"
        role="progressbar"
        aria-valuenow={total > 0 ? pct : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Syncing leagues"
      >
        <div
          className="h-full rounded-full bg-[image:var(--progress-fill)] shadow-[0_0_12px_var(--accent-glow)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress && progress.failed > 0 && (
        // Reported while it runs rather than only at the end: these leagues are
        // not coming back on this pass, and the list about to appear is short by
        // exactly this many.
        <p className="relative mt-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-error">
          {progress.failed} league{progress.failed === 1 ? "" : "s"} failed to
          sync
        </p>
      )}
    </div>
  );
}
