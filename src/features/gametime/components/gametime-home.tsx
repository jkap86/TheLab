"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  BILLET_KEY_CHROME,
  BrowseDock,
  BubblingFlask,
  CONSOLE_KEY,
  CONSOLE_METAL_TRACK_SM,
  FlaskDefs,
  LeagueFiltersDialog,
  ManagerBillet,
  matchesFilters,
  matchesSubjects,
  narrowedEmptyState,
  NO_SUBJECTS,
  PLATE_KEY,
  removeSubject,
  storeLeagueFilters,
  subjectCount,
  WeekSharesDrawer,
  SubjectTokens,
  toggleSubject,
  type LeagueSubjects,
  type Subject,
  type SubjectRolls,
  type WeekLineupEntry,
  type WeekSharePlayer,
  type WeekShareSide,
  useManagerLeagues,
  useActiveCard,
  useLeagueFilters,
  useUrlParam,
  PLAYER_SCORES_BROWSE_KEYS,
  weekSubjectRolls,
  WeekGauge,
  WeekStepper,
  writeQueryParam,
} from "@/features/shared";

import { isPlausibleWeek } from "@/shared/projections/weeks";
import type { GametimePlayer, GametimeSide } from "@/shared/contract";

import { useGametime } from "../hooks/use-gametime";
import { gametimeReadout } from "../helpers/connection";
import type { GametimeReadout, LeagueListState } from "../helpers/connection";
import {
  formatLiveRecord,
  formatLiveWinPct,
  leaguesAnswered,
  leaguesInPlay,
  liveSummary,
} from "../helpers/live-record";
import { GametimeCard } from "./gametime-card";
import { StatBoard, STAT_BAR_H } from "./stat-board";

/** Stable empty answer, so a render before the read lands hands the memos the same object. */
const NO_LEAGUES: Record<string, never> = {};
const NO_BOARD: Record<string, never> = {};
const NO_LINES: Record<string, never> = {};
const NO_ENTRIES: WeekLineupEntry[] = [];

/**
 * One player, as the shared week panels compare him — **this tool's live
 * projection** on {@link WeekSharePlayer.figure}.
 *
 * `live` rather than `scored` or `projected`, and the choice is the one thing
 * this adapter decides. It is the page's own headline figure: every total on
 * the plate and in the panes is a sum of it, so a panel comparing anything else
 * would judge the week on a number no card here prints. It is also the reading
 * a start/sit call wants mid-Sunday — `scored + projected × remaining` is this
 * app's best estimate of what a decision will finally have cost, where `scored`
 * alone says a player who has not kicked off cost nothing and `projected` alone
 * is the answer the lineup checker already gives one tool over. The panels are
 * labelled `Live` so a reader is never left inferring which of three scales
 * they are looking at.
 *
 * Null stays null and is never a zero, on `GametimePlayer.live`'s own grammar:
 * no projection and no game to have scored in is an em dash.
 */
const figured = (player: GametimePlayer): WeekSharePlayer => ({
  player_id: player.player_id,
  name: player.name,
  positions: player.positions,
  team: player.team,
  figure: player.live,
});

/** One side of a league's game, as the shared fold reads it. */
const asSide = (side: GametimeSide): WeekShareSide => ({
  lineup: side.lineup.map((seat) => ({
    slot: seat.slot,
    player: seat.player ? figured(seat.player) : null,
  })),
  bench: side.bench.map(figured),
});

/**
 * Gametime: every league this account plays in, what its lineup has scored,
 * what it is on course to score, and where each starter's game is — pushed to
 * the page as the games are played.
 *
 * **It is the lineup checker with the week in progress.** The route names the
 * manager (`/gametime/[username]`), the leagues arrive on the same stream
 * `/manager` reads, the week is `?week=` on the checker's own terms, the header
 * is `ManagerBillet` with the same gauge over a *live* record, the filters are
 * the same dialog, and the card is the checker's card with the week's result
 * in its windows. What differs is the read behind it: a stream rather than a
 * fetch (`useGametime`), so the numbers move without a press.
 *
 * **The two Browse keys are the checker's, and they are the same two panels.**
 * This file used to say they were deliberately absent, on the argument that
 * Starters and Opponents answer who you started and who you play — questions
 * about the lineup as *set* — where this page is about what that lineup is
 * doing. That argument is why the panels were not built here first and it is not
 * an argument against them: the question a reader asks on a Sunday is the same
 * one, and the answer is more useful with the week in progress, not less.
 * "Which of my twelve lineups is Bijan in" is a question about the same rosters;
 * what changes is that the figure beside him is what he has done and is on
 * course to do rather than what he was projected for. So it is one fold, one
 * drawer and one pair of keys, in `features/shared`, with this page supplying
 * the entries and the word for its own scale — see `figured` above, which is
 * where the choice of {@link GametimePlayer.live} is made and argued.
 *
 * **What a press narrows is the league grid**, exactly as on the checker: the
 * subjects compose with the league filters as a second pass, so picking a
 * player leaves the cards he is on. And a press *closes the open card* first,
 * because a parked card is the screen — there is no grid on screen to narrow
 * while one is open.
 */
export function GametimeHome({ username, heading }: { username: string; heading: ReactNode }) {
  const rawWeek = Number(useUrlParam("week"));
  const week = isPlausibleWeek(rawWeek) ? rawWeek : null;
  const stepWeek = useCallback((next: number) => {
    writeQueryParam("week", String(next));
  }, []);

  return (
    <Live key={username} username={username} heading={heading} week={week} onWeek={stepWeek} />
  );
}

function Live({
  username,
  heading,
  week,
  onWeek,
}: {
  username: string;
  heading: ReactNode;
  week: number | null;
  onWeek: (week: number) => void;
}) {
  const state = useManagerLeagues(username);
  const { user, leagues, progress, refreshing, error } = state;
  const cold = leagues.length === 0 && refreshing;

  // **The selection is the device's, shared with `/manager` and
  // `/lineupchecker`** and outliving the visit — see
  // `features/shared/league-filters-store`.
  const filters = useLeagueFilters();
  const setFilters = storeLeagueFilters;
  // The drawers' half of the narrowing, on the checker's terms. `opened` is a
  // latch rather than the open flag: a picked subject keeps narrowing the grid
  // after its drawer closes, and both panels keep their own search and scroll
  // once they have been opened.
  const [subjects, setSubjects] = useState<LeagueSubjects>(NO_SUBJECTS);
  const [drawer, setDrawer] = useState<Subject["kind"] | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<Subject["kind"]>>(new Set());

  const { payload, pending, connection, stale } = useGametime(
    username,
    state.season,
    week,
    leagues.length > 0 && !refreshing,
  );
  const solved = payload?.leagues ?? NO_LEAGUES;
  const board = payload?.board ?? NO_BOARD;
  const leagueList: LeagueListState =
    leagues.length > 0 ? "ready" : refreshing ? "loading" : "none";
  // **One call, two readers.** The pill beside the stepper draws this and every
  // card's in-play lamp pulses on it, and the rule is pure and tested — so it
  // is folded here rather than inside the pill, where a card could not see it
  // and a second spelling would be a lamp pulsing under a readout saying the
  // page had stopped listening.
  const readout = gametimeReadout({
    connection,
    leagues: leagueList,
    games: payload?.games ?? null,
    stale,
    degraded:
      payload !== null &&
      (payload.projections === "error" ||
        payload.stats === "error" ||
        payload.scores === "error"),
  });

  // **The two narrowings are two passes and the order is the cheap one** — the
  // leagues console's arrangement, and the drawers count over exactly this
  // intermediate list, never over the one below it.
  const leagueFiltered = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  /**
   * **Neither the entries nor the roll maps are built until a drawer has been
   * opened**, which is the latch's second job and `/api/trades/facets`' own
   * bargain: a reader who never presses a Browse key pays nothing for the
   * panels. Both are a walk over every player of every roster on the account,
   * and `matchesSubjects` returns true without asking the resolver while the
   * selection is empty — so before the first press there is nothing to answer
   * for. The latch never goes back, so a picked subject that outlives its
   * drawer still narrows.
   */
  const browsed = opened.size > 0;

  /**
   * One league's contribution to a week fold, adapted to the shared side shape
   * — see `figured` for which figure, and `week-shares.ts` for why the fold
   * takes a normalised side rather than either tool's wire.
   *
   * A league nothing could be solved for is absent rather than present and
   * empty, which is the denominator rule the panels' `league_count` is written
   * by; so is a league with no opponent, on the opponent side alone.
   *
   * It re-runs on every frame the room pushes, which is what a stream costs a
   * page that folds its own payload — one shallow map per player of per roster,
   * against a walk over the same players the fold behind it already makes. What
   * is behind the latch is the expensive half.
   */
  const entries = useMemo<WeekLineupEntry[]>(
    () =>
      browsed
        ? leagueFiltered.flatMap((league) => {
            const entry = solved[league.league_id];
            if (!entry) return [];
            return [
              {
                league,
                mine: asSide(entry.mine),
                opponent: entry.opponent ? asSide(entry.opponent) : null,
                // Sleeper seats a best-ball lineup itself — and here it is
                // *solved* from the very live figures a delta would compare, so
                // a call in one would be a decision the reader is told they got
                // right by construction. See
                // `WeekLineupEntry.set_by_manager`.
                set_by_manager: !entry.best_ball,
              },
            ];
          })
        : NO_ENTRIES,
    [browsed, leagueFiltered, solved],
  );

  // The five populations a subject picked on this page is answered from: who
  // each side started and who each side sat, plus the resting reading a row
  // picked with no key pressed means. Folded from the same entries the panel
  // reads rather than by hand here — a page whose grid narrowed differently
  // from the page beside it is the drift `weekSubjectRolls` exists to prevent.
  //
  // A league with no opponent is simply absent from the two opposing maps,
  // which the predicate reads as "this league does not hold them" — correct,
  // and a different state from the map not having arrived at all.
  const rolls = useMemo(() => weekSubjectRolls(entries), [entries]);

  // Null until the first frame lands, which `matchesSubjects` reads as "nothing
  // here can say" and ignores — the only reading that matches what is on
  // screen, since failing it closed would empty the grid while a read is in
  // flight.
  const subjectRolls = useCallback<SubjectRolls>(
    (kind, _mode, reading) => {
      if (payload === null || kind !== "week") return null;
      return rolls[reading ?? "either"];
    },
    [payload, rolls],
  );

  const visible = useMemo(
    () =>
      leagueFiltered.filter((league) =>
        matchesSubjects(league.league_id, subjects, subjectRolls),
      ),
    [leagueFiltered, subjects, subjectRolls],
  );

  const narrowing = activeFilterCount(filters) > 0;

  // A token names what the reader picked. The folded lineups are the only place
  // those names live, so an id that outlives its payload falls back to itself
  // rather than to a blank chip.
  const subjectName = (subject: Subject) => {
    for (const entry of entries) {
      for (const fielded of [entry.mine, entry.opponent]) {
        if (!fielded) continue;
        const found =
          fielded.lineup.find((s) => s.player?.player_id === subject.id)
            ?.player ??
          fielded.bench.find((p) => p.player_id === subject.id);
        if (found?.name) return found.name;
      }
    }
    return subject.id;
  };

  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(() => visible.map((l) => l.league_id), [visible]);
  const card = useActiveCard({ param: "league", ids, listRef });
  // Read out so the handler below can depend on it by name — the checker's own
  // pair, in the same place and for the same reason.
  const { close: closeCard } = card;

  // Latch and open in one handler — never during render. It is a `useCallback`
  // because it is `BrowseDock`'s `onOpen`, and this page re-renders once per
  // line of the leagues stream: a fresh identity each time would re-render the
  // dock on every one of them. It used to be the rack seam that required it,
  // where a new identity re-published and set an ancestor's state in a loop —
  // the same rule at a much lower price, which is what moving the keys down
  // into the page bought.
  //
  // **It closes the open card first**, on `LeaguesHome`'s argument: a picked
  // subject narrows the league grid, and a parked card *is* the screen — the
  // page is locked and every league but the open one is `display: none`, so
  // there is no grid on screen to be narrowed. A press with no card open is a
  // no-op on that half.
  const openDrawer = useCallback(
    (kind: Subject["kind"]) => {
      closeCard();
      setOpened((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
      setDrawer(kind);
    },
    [closeCard],
  );

  const { summary, inPlay, answered } = useMemo(
    () => ({
      summary: liveSummary(visible, solved),
      inPlay: leaguesInPlay(visible, solved),
      answered: leaguesAnswered(visible, solved),
    }),
    [visible, solved],
  );

  /**
   * What to say, and what to offer, when the grid narrows to nothing — see
   * `narrowedEmptyState`. Two things narrow it, they are undone by two
   * different controls, and a message naming the wrong one comes with a key
   * that does nothing.
   */
  const empty = narrowedEmptyState(
    narrowing,
    subjectCount(subjects) > 0,
    filterSummary(filters),
  );
  const clearNarrowing = () => {
    if (empty.action !== "subjects") setFilters(DEFAULT_LEAGUE_FILTERS);
    if (empty.action !== "filters") setSubjects(NO_SUBJECTS);
  };

  const name = user ? user.display_name || user.username : username;

  return (
    /* `STAT_BAR_H` on the root rather than on the board alone: the dock at the
       foot of this page lifts by exactly the bar's height, and both read the
       one declaration. See the constant, and the dock's `lift` below. */
    <div className={`relative ${STAT_BAR_H}`}>
      {/*
        **The page's Browse key, pinned to the bottom-right of the viewport.**
        It was published up into the app rack; the lineup checker's own note
        carries the argument in full, and it is that page's word for word —
        these two tools list the same leagues and open the same panel, so the
        one thing that may differ between them is the legend, which is the
        page's own. See `PLAYER_SCORES_BROWSE_KEYS`.

        First in the tree for the tab order and drawn at the foot of the
        viewport by the stylesheet, which is `LeaguesHome`'s decision and not
        the handoff's letter — again, see the checker.
      */}
      <BrowseDock
        keys={PLAYER_SCORES_BROWSE_KEYS}
        drawer={drawer}
        onOpen={openDrawer}
        parked={card.parked}
        chromeClass={card.chromeClass}
        /*
          **This page's foot is not empty, and the handoff's reference draws it
          as though it were** — the stat board's bar is `fixed` to the bottom
          edge and the dock at the specified `bottom: 1.5rem` lands on it.
          Measured at 1280 against the real page: the two overlap across
          x 1040–1209 and the bar's upper 28px, and because the bar is one
          full-width `<button>`, `elementFromPoint` at the `Expand` caption's
          own centre answers the *dock*. The caption is a press that opens the
          drawer.

          So the dock clears the bar by the bar's own height and nothing else:
          the 1.5rem the handoff asks for is still there, measured from the top
          of the bar rather than from the fold. The two other answers are a
          designer's to take — put this page's dock at the bottom *left*, or
          stand it down while the board is open — and both are changes to where
          a part lives rather than to how far it sits off an edge, which is why
          neither was taken here.
        */
        lift="var(--stat-bar-h)"
      />
      <FlaskDefs />
      <header className={`relative ${card.chromeClass}`}>
        <ManagerBillet
          name={name}
          avatarUrl={user?.avatar_url ?? null}
          controls={
            leagues.length > 0 ? (
              <>
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
                  {narrowing && (
                    <button
                      type="button"
                      onClick={() => setFilters(DEFAULT_LEAGUE_FILTERS)}
                      className={`${PLATE_KEY} ${BILLET_KEY_CHROME} border-foreground/10 text-foreground/80 hover:text-readout`}
                    >
                      Clear
                    </button>
                  )}
                </span>
                {narrowing && (
                  <p className="relative order-6 m-0 w-full min-w-0 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-accent)] lg:order-none">
                    {filterSummary(filters)} · {visible.length} of {leagues.length}
                  </p>
                )}
              </>
            ) : undefined
          }
          eyebrow={
            <>
              {heading}
              {state.season && <span>· {state.season}</span>}
            </>
          }
        >
          {leagues.length > 0 ? (
            <WeekGauge
              record={formatLiveRecord(summary)}
              winPct={summary.winPct}
              pct={formatLiveWinPct(summary)}
              recordLabel="Live rec"
              winLabel="Live win"
              pending={pending}
              pendingLabel="Reading"
              count={{
                label: "In play",
                tone: !pending && inPlay > 0 ? "var(--accent)" : undefined,
                live: true,
                centred: pending,
                title: pending
                  ? undefined
                  : `${inPlay} of ${answered} league${answered === 1 ? "" : "s"} with a game in progress`,
                value: pending ? <BubblingFlask size={24} label="Reading" /> : `${inPlay} / ${answered}`,
              }}
            />
          ) : undefined}
        </ManagerBillet>
      </header>

      <div className={`relative my-6 flex flex-wrap items-center gap-3 sm:my-9 ${card.chromeClass}`}>
        <WeekStepper week={payload?.week ?? null} onChange={onWeek} />
        <LiveReadout readout={readout} />
        <div
          aria-hidden
          className="hidden h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent sm:block"
        />
      </div>

      {/* The drawers hide their own state once closed, so the narrowing they
          left behind needs a home on the page — the manager console's own
          argument, and the same strip. `contents` at rest so the layout is what
          it was, and the stylesheet gives it a box for as long as it is fading
          with the rest of the page: opacity has no effect on an element with
          none. */}
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
        <Alert>{error}</Alert>
      ) : cold ? (
        <ColdProgress progress={progress} />
      ) : (
        <>
          {payload?.projections === "error" && (
            <Alert>
              Couldn&rsquo;t project this week&rsquo;s lineups. The leagues below are
              current; the numbers read blank rather than zero.
            </Alert>
          )}
          {payload?.projections === "ok" && payload.stats === "error" && (
            <Note>Live stats unavailable — showing the projections until Sleeper answers.</Note>
          )}
          {payload?.projections === "ok" && payload.scores === "error" && (
            <Note>Game clocks unavailable — a player with a stat line is priced as half played.</Note>
          )}
          {payload?.week === null && (
            <Plate>
              <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                No week left to follow in {payload.season} — the season is over.
              </p>
            </Plate>
          )}
          {leagues.length === 0 ? (
            <Plate>
              <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                No leagues found{state.season ? ` for ${state.season}` : ""}.
              </p>
            </Plate>
          ) : visible.length === 0 ? (
            // A different claim from the one above: that one is about the
            // manager, this one is about the selection — and *which* of the two
            // narrowings emptied the page decides the words and the key, since
            // a message naming the wrong one comes with a control that does
            // nothing. See `narrowedEmptyState`.
            <Plate>
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                    {empty.message}
                  </p>
                  {empty.summary ? (
                    <p className="mt-2 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
                      {empty.summary}
                    </p>
                  ) : null}
                </div>
                {/* A real key, from the constant rather than a hand-spelled
                    riser — which is how one of them stops travelling. */}
                <button
                  type="button"
                  onClick={clearNarrowing}
                  className={CONSOLE_KEY}
                >
                  {empty.label}
                </button>
              </div>
            </Plate>
          ) : (
            <ul
              ref={listRef}
              {...card.shellProps}
              /* **A margin rather than the padding the handoff names**, and
                 the difference is what the park does to each. The collapsed
                 bar is 52px of fixed chrome over the foot of the page, so the
                 last card needs clearance below it — but while a card is
                 parked `useActiveCard` writes this list's `height` from a
                 measurement, and padding inside a border-box height comes out
                 of the card's own room. The same write zeroes the margin,
                 which is exactly right: a parked card is the screen, the bar
                 stands down with the rest of the page's chrome, and there is
                 nothing left to clear. */
              className="relative m-0 mb-[5.5rem] grid list-none grid-cols-1 gap-[1.125rem] p-0 [overflow-anchor:none]"
            >
              {visible.map((league) => {
                const open = card.isOpen(league.league_id);
                return (
                  <GametimeCard
                    key={league.league_id}
                    league={league}
                    entry={solved[league.league_id] ?? null}
                    // Only the open card reads the scoreboard, and only the
                    // open card is handed it. The board is a new object on
                    // every frame the room pushes — every twenty seconds while
                    // a game runs — so passing it to all of them would break
                    // `GametimeCard`'s memo for a hundred closed cards to move
                    // the seat rows of one. `NO_BOARD` is module-scoped, so a
                    // closed card's props are identical frame to frame and its
                    // memo holds; opening one hands it the current board in
                    // the same render that opens it.
                    board={open ? board : NO_BOARD}
                    pending={pending}
                    // Whether the in-play lamp pulses, and nothing else. A
                    // boolean that flips a handful of times a Sunday against
                    // an `entry` that moves every twenty seconds, so what it
                    // costs the memo is nothing beside what it protects.
                    live={readout.pulse}
                    open={open}
                    lit={card.isLit(league.league_id)}
                    onToggle={card.toggle}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* Mounted once each kind has been opened, and kept: a closed drawer is
          `open={false}`, not unmounted, so its search, its scroll and the
          decisions view a reader was inside survive being shut. Both count over
          `entries` — the league-filtered, subject-unnarrowed list — and the
          readout's denominator is `leagues.length`, the account's own total.

          `pending` is the hook's own answer rather than `payload === null`,
          which is also true after a stream that will never answer. */}
      {opened.has("week") && (
        <WeekSharesDrawer
          open={drawer === "week"}
          onClose={() => setDrawer(null)}
          entries={entries}
          week={payload?.week ?? null}
          leagueTotal={leagues.length}
          filterSummary={narrowing ? filterSummary(filters) : null}
          /* The live projection: this page's own figure, and the one every
             total on it is a sum of. See `figured`. */
          figureLabel="Live"
          pending={pending}
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
          onSubjects={setSubjects}
        />
      )}

      {/* The week's own reading, which is about the NFL rather than about this
          account: every skill player with a scoring line, behind a bar pinned
          to the foot of the console. It is `fixed`, so it takes no part in the
          parked-card layout — but it takes `chromeClass` all the same, because
          a parked card is sized to the fold less a few pixels and a 52px bar
          would cover the drawer bars at the bottom of its panes. The page's
          chrome steps back for a parked card; the rack stays, because the rack
          is the app's rather than this page's. */}
      <StatBoard
        week={payload?.week ?? null}
        lines={payload?.players ?? NO_LINES}
        board={board}
        chromeClass={card.chromeClass}
      />
    </div>
  );
}

/**
 * What the page is doing, beside the stepper: a lamp and a word.
 *
 * Every reading it can give is `gametimeReadout`'s, which is pure and tested —
 * this is the pill it is drawn in. Lit while the stream is answering and
 * dimmed while it is not; the lamp pulses only while a game is actually
 * running, which is the one thing a reader looking at a quiet page needs told.
 *
 * **It takes the reading rather than the four inputs to it**, because the
 * cards' own in-play lamps pulse on the same `pulse` and a rule folded in two
 * places is two places for it to drift.
 */
function LiveReadout({ readout }: { readout: GametimeReadout }) {
  return (
    <span
      role="status"
      className="relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-2 shadow-[var(--readout-shadow)]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />
      <span
        aria-hidden
        className={`relative size-[0.4375rem] shrink-0 rounded-full ${
          readout.pulse
            ? "lab-anim animate-pulse bg-readout shadow-[0_0_10px_var(--accent-glow)]"
            : readout.lit
              ? "bg-readout/70"
              : "bg-foreground/30"
        }`}
      />
      <span
        className={`relative whitespace-nowrap font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] ${
          readout.lit
            ? "text-readout [text-shadow:var(--readout-text-glow)]"
            : "text-readout-muted"
        }`}
      >
        {readout.text}
      </span>
    </span>
  );
}

function Plate({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-5 rounded-2xl border border-foreground/8 bg-[image:var(--plate-bg)] p-6 shadow-[var(--plate-shadow)]">
      {children}
    </div>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="relative mb-6 inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[length:var(--fs-13)] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
    >
      <span
        aria-hidden
        className="size-[0.4375rem] shrink-0 rounded-full bg-error shadow-[0_0_10px_var(--error)]"
      />
      {children}
    </p>
  );
}

/** A note beside a usable page, in the readout's own ink rather than the alert's. */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="relative mb-4 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-foreground/60">
      {children}
    </p>
  );
}

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
    </div>
  );
}
