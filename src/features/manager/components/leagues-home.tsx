"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  BILLET_KEY_CHROME,
  CONSOLE_KEY,
  CONSOLE_METAL_TRACK_SM,
  LeagueFiltersDialog,
  LineupColumnsDialog,
  ManagerBillet,
  matchesFilters,
  matchesSubjects,
  NO_SUBJECTS,
  parseLeaguematePlayerId,
  PLATE_KEY,
  removeSubject,
  setSubjectMode,
  SubjectTokens,
  toggleSubject,
  type LeagueSubjects,
  type Subject,
  type RackDrawerKey,
  type SubjectMode,
  type SubjectRolls,
  useActiveCard,
  usePublishRackControls,
  useKtcBoard,
  useLineupColumns,
  useManagerLeagues,
} from "@/features/shared";

import { useManagerLineups } from "../hooks/use-manager-lineups";
import {
  useManagerLeaguemateRosters,
  useManagerLeaguemates,
  useManagerPlayers,
} from "../hooks/use-manager-shares";
import { modeRolls, leaguematePlayerRolls } from "../helpers/leaguemate-rosters";
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
  const { user, leagues, progress, refreshing, error, refreshError } = state;
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
  const leaguemates = useManagerLeaguemates(
    username,
    state.season,
    opened.has("leaguemate"),
  );
  // **Latched on either drawer**, which is the one of the three that is: the
  // leaguemate panel's rail wants it on open, and the players panel's three
  // mode keys want it one press later. See the hook.
  const leaguemateRosters = useManagerLeaguemateRosters(
    username,
    state.season,
    opened.has("leaguemate") || opened.has("player"),
  );

  const narrowing =
    activeFilterCount(filters) > 0 || subjects.subjects.length > 0;
  // **The league filters only** — never the subject selection. A drawer's
  // readout says what population its shares are counted over, and the subjects
  // are picked *in* the drawers: naming them there would have the panel
  // describe a narrowing it is the source of.
  const leagueNarrowing =
    activeFilterCount(filters) > 0 ? filterSummary(filters) : null;

  // **The two narrowings are two passes and the order is the cheap one.** A
  // league rejected on its type never has its roster walked — and the drawers
  // count over exactly this intermediate list, never over the one below it.
  const leagueFiltered = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
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

  // Fetched once the leagues settle — `!refreshing` flipping true is also what
  // refetches after a cold sync, when the rosters this read solves from were
  // just written. See the hook. The columns ride the request rather than being
  // applied here, because their ranks are the server's: only it can rank a
  // roster against the other eleven, and a forced market is a board only it can
  // price.
  const lineups = useManagerLineups(
    username,
    state.season,
    leagues.length > 0 && !refreshing,
    columns,
  );

  // Sleeper lets a display name go missing, so the username is the fallback
  // everywhere this pair is shown.
  const name = user ? user.display_name || user.username : username;

  // Latch and open in one handler — never during render. It is a `useCallback`
  // because it crosses the rack seam below, where a new identity every render
  // would re-publish on every render and set an ancestor's state in a loop; see
  // `usePublishRackControls`.
  const openDrawer = useCallback((kind: Subject["kind"]) => {
    setOpened((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
    setDrawer(kind);
  }, []);

  // **The two Browse keys, and nothing else.** Filters and Columns came back
  // down onto the plate and the tray under it — see the header below — so the
  // rack no longer needs the filter state, the unfiltered league list, the
  // column selection or the KTC pair, and none of them is published. Publishing
  // a field the rack does not read is a field that looks load-bearing to the
  // next reader of either file.
  usePublishRackControls({ keys: BROWSE_KEYS, drawer, onOpenDrawer: openDrawer });

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

  return (
    <div className="relative">
      {/* The page's own header stands down while a card is parked: it is
          `display: none` rather than unmounted, so the two dialogs it holds
          keep their draft state and neither is rebuilt when the card closes. */}
      <header className={`relative ${card.parked ? "hidden" : ""}`}>
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
              ktc={lineups?.ktc ?? []}
              triggerClassName={CONSOLE_KEY}
            />
          </div>
        )}
      </header>

      {/* One rule as the boundary before the grid. It used to carry the
          controls; it is only a boundary now. */}
      <div
        aria-hidden
        className={`relative my-9 h-px bg-gradient-to-r from-active/35 via-foreground/5 to-transparent ${card.parked ? "hidden" : ""}`}
      />

      {/* The drawers hide their own state once closed, so the narrowing they
          applied has to be named somewhere the reader can see and undo it. */}
      <div className={card.parked ? "hidden" : "contents"}>
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
              className={`relative mb-6 inline-flex items-center gap-3 rounded-full border border-foreground/8 bg-[image:var(--key-bg)] py-2 pl-2.5 pr-5 shadow-[var(--plate-shadow)] ${card.parked ? "hidden" : ""}`}
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
          {/* A failed refresh is a note beside a usable list, never a
              replacement for it: the leagues below are what was stored, and
              they are still worth reading. */}
          {refreshError && (
            <p
              role="alert"
              className={`relative mb-6 inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[length:var(--fs-13)] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)] ${card.parked ? "hidden" : ""}`}
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
            // manager, this one is about the selection — and it is the reader's
            // to undo, so it says so.
            <Plate>
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                    No leagues match these filters.
                  </p>
                  <p className="mt-2 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
                    {filterSummary(filters)}
                  </p>
                </div>
                {/* A real key, from the constant rather than a fourth copy of
                    the stack — a hand-spelled riser is how one of them stops
                    travelling. */}
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_LEAGUE_FILTERS)}
                  className={CONSOLE_KEY}
                >
                  Clear filters
                </button>
              </div>
            </Plate>
          ) : (
            // **The gap is the plate row's overhang, not a rhythm.** A league
            // card's header hangs 13px above the card's own top edge, so the
            // row has to carry that plus enough breath that one league's name
            // does not sit on another league's foot. 18px is that overhang
            // plus 5, and it is `lineupchecker-home.tsx`'s own figure for the
            // same card — the two pages list the same leagues and a gap that
            // differed between them would be a drift with nothing on screen
            // saying which page a reader was on.
            //
            // It was 28px while the header was a milled billet, whose overhang
            // is 20px rather than 13; that number comes back down with the
            // ledge. The first card's plate has the filter summary's own
            // margin above it.
            // **`overflow-anchor: none`**, and it is load-bearing rather than
            // tidy: opening a card parks it under the rack with a smooth
            // scroll, and the panel that mounts on the same frame is exactly
            // what scroll anchoring is built to compensate for — the browser
            // sees content grow above the viewport's anchor and adjusts
            // `scrollTop` to keep it still, which lands the card somewhere
            // arbitrary and looks like the park having missed. Excluding this
            // subtree is what leaves the park the only thing moving the page.
            // See `ExpandedPanel`.
            // **The list is the parked shell.** `shellProps` is a measured
            // height, the plate's overhang as padding and a scroller that only
            // ever engages where the panel hit its floor; off it is `{}` and
            // this is the grid it always was. Which cards stand down is CSS
            // reading the open disclosure — see `globals.css` — rather than a
            // prop, so a hundred cards are not re-rendered to hide
            // ninety-nine of them.
            <ul
              ref={listRef}
              {...card.shellProps}
              className="relative m-0 mt-2 grid list-none grid-cols-1 gap-[1.125rem] p-0 [overflow-anchor:none]"
            >
              {visible.map((league) => (
                <LeagueCard
                  key={league.league_id}
                  league={league}
                  columns={columns}
                  entry={lineups?.leagues[league.league_id] ?? null}
                  // The three that decide which boards a *past* stop is priced
                  // on. They are the same three the lineups read above was
                  // asked for the present, which is the whole point: a rewound
                  // roster measured on another season's projections or another
                  // market is not a comparison. The resolved season, never the
                  // page's raw query — see `parseRequestedSeason`.
                  season={state.season}
                  username={username}
                  // **`auto`, not the stored board.** The rail redraws this
                  // card's own team browser over past rosters, and that browser
                  // reads `LeagueTeam.totals` — which the route computes on the
                  // league's own market and QB board, whatever any column has
                  // forced. A past stop priced on a different board from the
                  // present table beside it is two numbers on two rulers, which
                  // is the one thing the timeline's three narrowing parameters
                  // exist to prevent.
                  board="auto"
                  open={card.isOpen(league.league_id)}
                  lit={card.isLit(league.league_id)}
                  onToggle={card.toggle}
                />
              ))}
            </ul>
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
          onClose={() => setDrawer(null)}
          leagues={leagueFiltered}
          leagueTotal={leagues.length}
          filterSummary={leagueNarrowing}
          read={players}
          rosters={leaguemateRosters}
          selfId={user?.user_id ?? null}
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
          onMode={(playerId, mode) =>
            setSubjects((prev) => setSubjectMode(prev, "player", playerId, mode))
          }
        />
      )}
      {opened.has("leaguemate") && (
        <LeaguemateSharesDrawer
          open={drawer === "leaguemate"}
          onClose={() => setDrawer(null)}
          leagues={leagueFiltered}
          leagueTotal={leagues.length}
          filterSummary={leagueNarrowing}
          read={leaguemates}
          rosters={leaguemateRosters}
          selfId={user?.user_id ?? null}
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
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
