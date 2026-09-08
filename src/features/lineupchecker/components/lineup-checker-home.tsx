"use client";

import {
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  BILLET_KEY_CHROME,
  CONSOLE_METAL_TRACK_SM,
  LeagueFiltersDialog,
  ManagerBillet,
  matchesFilters,
  matchesSubjects,
  NO_SUBJECTS,
  PLATE_KEY,
  removeSubject,
  SubjectTokens,
  toggleSubject,
  type LeagueSubjects,
  type RackDrawerKey,
  type Subject,
  type SubjectRolls,
  useManagerLeagues,
  useActiveCard,
  usePublishRackControls,
  useUrlParam,
  writeQueryParam,
} from "@/features/shared";

// Deep-imported rather than through the folder's barrel, which reaches the
// network: this module is pure and this is the one predicate that says what a
// week is. `week-stepper.tsx` reads `LAST_REGULAR_WEEK` the same way.
import { isPlausibleWeek } from "@/shared/projections/weeks";

import { useLineupCheck } from "../hooks/use-lineup-check";
import {
  attentionByReason,
  needsAttention,
} from "../helpers/lineup-check-metrics";
import type { WeekLineupEntry } from "../helpers/starter-shares";
import { weekSummary } from "../helpers/week-summary";
import { AttentionStrip } from "./attention-strip";
import { OpponentsMark, StartersMark } from "./browse-marks";
import { LineupCheckCard, LineupMarkDefs } from "./lineup-check-card";
import { OpponentSharesDrawer } from "./opponent-shares-drawer";
import { StarterSharesDrawer } from "./starter-shares-drawer";
import { WeekSummary } from "./week-summary";
import { WeekStepper } from "./week-stepper";

/**
 * The two Browse keys this page puts in the rack: their legends, and the
 * glyphs the rack draws them as below `md`.
 *
 * **Module scope, not a literal in the render**, which is the requirement
 * `usePublishRackControls` states rather than a habit: the publish effect
 * depends on this array, so one rebuilt each render would publish each render,
 * set an ancestor's state and re-render — a loop rather than a stale value.
 * The two `icon` elements are built once here for the same reason.
 *
 * The glyphs are this folder's — see `browse-marks.tsx` — because the rack
 * cannot `switch` on the route, which is exactly why the legends became data
 * when this page became the second publisher of a pair.
 */
const BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "starter", label: "Starters", icon: <StartersMark /> },
  { kind: "opponent", label: "Opponents", icon: <OpponentsMark /> },
];

/** Stable empty answer, so a render before the check lands hands the memos below
 *  the same object rather than a new one to recompute from. */
const NO_LEAGUES: Record<string, never> = {};

/**
 * The lineup checker: every league this account plays in, what its lineup is
 * projected to score against the best one still reachable, and whether its
 * starters are seated in the order they lock best in.
 *
 * **The manager is named by the route**, `/lineupchecker/[username]`, the way
 * `/manager/[username]` names one. It read the stored account until this
 * landed, which made the page unlinkable: there was one URL for every manager,
 * so a reader could not open somebody else's lineups, keep a bookmark for a
 * second account, or send anyone a link to what they were looking at. The tool
 * registry's `hrefFor` is what still gets a reader there in one press from
 * `/tools` and from the rack, so the stored account is a *default* rather than
 * the only answer — which is exactly the arrangement Manager already has.
 *
 * **The two reads are separate on purpose.** The leagues arrive on the same
 * stream `/manager` reads, and the check is a batch read beside it — so the
 * cards draw as soon as the league list lands and the numbers fill in behind
 * them, rather than the page waiting on the slower of the two. It is also what
 * makes a failed check cost the week's numbers and not the list.
 *
 * The header and the card are the leagues console's. A reader arriving from
 * `/manager` is looking at the same leagues, and a second vocabulary for them
 * would be a second chance for one to drift — which is why this page draws
 * `ManagerBillet`, the identity milled out of the same stock its league cards'
 * strips are made of, and not the recessed `ManagerPlate` it drew until the
 * billet pass reached it. For as long as it did, a reader walking between the
 * two tools saw one account drawn as two objects: chrome engraved into a plate
 * here, ink stamped on metal there. What differs now is only the figures,
 * because a week is not a season: a projected record and a projected win rate
 * where `/manager` carries the standing ones, the count of lineups wanting a
 * press stamped beside the record, and the four reasons on a milled strip of
 * their own under the row — see `WeekSummary` and `AttentionStrip` for what
 * moved where, and why the reasons could not stay on the row.
 *
 * **The week stepper has one copy again**, in the row under the header at
 * every width. It rode the plate's bottom strip below `sm` because that strip
 * had slack a phone's row did not; the billet has no bottom strip — its
 * controls are items of its own row, beside the name on a phone — and a
 * stepper wedged in beside them would be the name losing its line to a dial.
 * The row keeps its hairline from `sm` up, where there is a page for it to
 * run across, and is the stepper alone below it.
 *
 * **The panel is gone, for the reason it went there.** This page used to draw
 * a rounded, bordered panel with `--background` showing around it; the ground
 * the route renders (`ConsoleGround`) is that surface now and runs to the
 * viewport edges, so with the rack floating above there is no second bounded
 * rectangle inside the viewport. The cards inherit the rest of the fix: the
 * panel's inset and border were 106px at 1280 and 50px at 390 that this page
 * spent and `/manager` did not, so the same card over the same league was
 * measurably narrower here — 1014 against 1120, on a shell widened to `console`
 * precisely so a lit readout would not clip. With the panel gone both pages are
 * one card per row at `PageShell width="console"` and a card is the same width
 * on either, by construction rather than by two spellings of a width.
 */
export function LineupCheckerHome({
  username,
  heading,
}: {
  username: string;
  heading: ReactNode;
}) {
  /**
   * **The stepped week is `?week=`, and there is no second copy of it.**
   *
   * It was `useState` seeded from nothing; making it a link meant either
   * copying the URL into that state on mount — which is a render's worth of the
   * wrong week, and an effect writing state from an external system — or
   * reading the URL *as* the state. It reads the URL. `useUrlParam` is the same
   * store `useActiveCard` derives the open card from, so a Back that crosses a
   * week change moves the page rather than leaving the address bar disagreeing
   * with the stepper.
   *
   * **Null is a real state and is never written.** "The week the route
   * resolves" is what the page opens on, and the week *shown* is always read
   * back off the payload — see `WeekStepper`. A default stamped into the URL on
   * load would freeze this page on whatever week it happened to open on for
   * anyone who bookmarked it.
   *
   * **`replace`, not `push`**, because a stepper is a dial rather than a place:
   * eighteen presses should not be eighteen entries between the reader and the
   * page they came from.
   *
   * `isPlausibleWeek` rather than the bounds spelled again — it is the
   * predicate the *route* validates `?week=` with, and one spelling is what
   * stops a link this page accepts from being one the route refuses.
   *
   * It is independent of `?league=` in both directions — stepping the week with
   * a card open must not close it, and closing a card must not drop the week —
   * which falls out of them being two params neither of which reads the other.
   */
  const rawWeek = Number(useUrlParam("week"));
  const week = isPlausibleWeek(rawWeek) ? rawWeek : null;

  const stepWeek = useCallback((next: number) => {
    writeQueryParam("week", String(next));
  }, []);

  return (
    <Checker
      // Remounting on a changed manager is what keeps every piece of state
      // below — the week, the filters, the hooks' subjects — from having to
      // each remember to reset. There is exactly one subject on this page, and
      // Next reuses this component across a param change rather than
      // remounting it, so the key is what makes walking from one manager to
      // another start over.
      key={username}
      username={username}
      heading={heading}
      week={week}
      onWeek={stepWeek}
    />
  );
}

function Checker({
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
  // **Read off the unfiltered list, both of them** — the leagues console's rule
  // and it breaks identically here: taken off the filtered list, a selection
  // matching nothing would put the cold sync bar back on screen and suppress
  // the check for every league on the account.
  const cold = leagues.length === 0 && refreshing;

  const [filters, setFilters] = useState(DEFAULT_LEAGUE_FILTERS);
  // The drawers' half of the narrowing, on `LeaguesHome`'s terms. `opened` is a
  // latch rather than the open flag: a picked subject keeps narrowing the grid
  // after its drawer closes, and both panels keep their own search and scroll
  // once they have been opened.
  const [subjects, setSubjects] = useState<LeagueSubjects>(NO_SUBJECTS);
  const [drawer, setDrawer] = useState<Subject["kind"] | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<Subject["kind"]>>(new Set());

  const { payload: check, reread } = useLineupCheck(
    username,
    state.season,
    week,
    leagues.length > 0 && !refreshing,
  );
  const checked = check?.leagues ?? NO_LEAGUES;

  // **The two narrowings are two passes and the order is the cheap one** — the
  // leagues console's arrangement, and the drawers count over exactly this
  // intermediate list, never over the one below it.
  const leagueFiltered = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  // One league's contribution to a week fold: the league row the page draws and
  // the week the check solved for it. A league the check answered nothing for
  // is absent rather than present and empty — the denominator rule the two
  // panels' `league_count` is written by.
  const entries = useMemo<WeekLineupEntry[]>(
    () =>
      leagueFiltered.flatMap((league) => {
        const entry = checked[league.league_id];
        return entry ? [{ league, entry }] : [];
      }),
    [leagueFiltered, checked],
  );

  // The two populations a subject picked on this page is answered from: who was
  // on each of the manager's rosters this week, and who was on each opponent's.
  // A league with no opponent is simply absent from the second, which the
  // predicate reads as "this league does not hold them" — correct, and a
  // different state from the map not having arrived at all.
  const rolls = useMemo(() => {
    const starter: Record<string, string[]> = {};
    const opponent: Record<string, string[]> = {};
    for (const [id, entry] of Object.entries(checked)) {
      starter[id] = [
        ...entry.lineup.flatMap((seat) =>
          seat.player ? [seat.player.player_id] : [],
        ),
        ...entry.bench.map((p) => p.player_id),
      ];
      if (entry.opponent_lineup && entry.opponent_bench) {
        opponent[id] = [
          ...entry.opponent_lineup.flatMap((seat) =>
            seat.player ? [seat.player.player_id] : [],
          ),
          ...entry.opponent_bench.map((p) => p.player_id),
        ];
      }
    }
    return { starter, opponent };
  }, [checked]);

  // Null until the check lands, which `matchesSubjects` reads as "nothing here
  // can say" and ignores — the only reading that matches what is on screen,
  // since failing it closed would empty the grid while a read is in flight.
  const subjectRolls = useCallback<SubjectRolls>(
    (kind) => {
      if (check === null) return null;
      if (kind === "starter") return rolls.starter;
      if (kind === "opponent") return rolls.opponent;
      return null;
    },
    [check, rolls],
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
    for (const { entry } of entries) {
      const sides = [
        entry.lineup,
        entry.opponent_lineup ?? [],
      ].flatMap((lineup) => lineup.flatMap((s) => (s.player ? [s.player] : [])));
      const found = [...sides, ...entry.bench, ...(entry.opponent_bench ?? [])].find(
        (p) => p.player_id === subject.id,
      );
      if (found?.name) return found.name;
    }
    return subject.id;
  };

  // Latch and open in one handler — never during render. It is a `useCallback`
  // because it crosses the rack seam below, where a new identity every render
  // would re-publish on every render and set an ancestor's state in a loop.
  const openDrawer = useCallback((kind: Subject["kind"]) => {
    setOpened((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
    setDrawer(kind);
  }, []);

  usePublishRackControls({
    keys: BROWSE_KEYS,
    drawer,
    onOpenDrawer: openDrawer,
  });
  // **Both are taken over the narrowed list**, the same argument
  // `seasonSummary` reverses itself on: a reader who has filtered to dynasty is
  // asking about their dynasty week, and the plate is the page's one set of
  // figures.
  //
  // One memo for the four, because they move together and only with these two
  // inputs: the page renders once per line of the leagues stream, and each of
  // these is a walk over every league's solved lineup — four walks a progress
  // line, for a header that had not changed.
  const { attention, reasons, summary, answered } = useMemo(
    () => ({
      attention: needsAttention(visible, checked),
      reasons: attentionByReason(visible, checked),
      summary: weekSummary(visible, checked),
      // The window's denominator is the leagues *on screen* that the check
      // answered for, not every league it answered for: narrowed to one league,
      // `1 of 3` would be a count over a list the reader cannot see.
      answered: visible.filter(
        (league) => checked[league.league_id] !== undefined,
      ).length,
    }),
    [visible, checked],
  );

  const name = user ? user.display_name || user.username : username;

  /**
   * **An open card is the screen, and it is a link** — `?league=<id>`, beside
   * the `?week=` the stepper writes. The park, the lock and the param are
   * `useActiveCard`'s; this page owns which rows may be opened and standing its
   * own header down while one is.
   *
   * `ids` is the narrowed list for `LeaguesHome`'s reason: a filter or a subject
   * that takes the open league off the page closes the card rather than parking
   * a shell around a league nobody can see, and it is what re-validates a
   * deeplink as the leagues stream fills in.
   */
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(() => visible.map((l) => l.league_id), [visible]);
  const card = useActiveCard({ param: "league", ids, listRef });

  return (
    <div className="relative">
      {/* It stands down while a card is parked — `display: none` rather than
          unmounted, so the filters dialog it holds keeps its draft — and
          `chromeClass` fades it either side of that, with the other cards. */}
      <header className={`relative ${card.chromeClass}`}>
        <ManagerBillet
          name={name}
          avatarUrl={user?.avatar_url ?? null}
          /*
            **The Filters key sits on the header**, the arrangement `/manager`
            arrived at: up in the rack the key said "a filter is on" and nothing
            said *what* was narrowed, while the sentence that said so stood on a
            line of its own under the header. Here the key, the key that undoes
            it and the sentence are one object — and, since the billet, so are
            the four reasons, which is why they are `controls` rather than
            `children`: DOM order is the wide row's read order, and the strip
            has to come after the keys to take the line under them.

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
                    the desktop row after the gauge. The track is the *metal*
                    one, and below `sm` there is no raised key to recess — the
                    keys are etched into the face there, so the recess goes
                    with them. See `BILLET_KEY_CHROME`. */}
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
                {/* The four reasons, on a strip of their own under the row —
                    `w-full`, so the billet's own `flex-wrap` gives it a line. */}
                <AttentionStrip reasons={reasons} pending={check === null} />
                {/* The filter summary in words. `w-full` at every width, where
                    on the plate it took the strip's slack: the billet's row is
                    a name column, a well, a 108px gauge and the keys, and there
                    is no slack for a sentence to take. Its ink is
                    `--billet-accent` rather than `text-active` for the reason
                    every ink on this part is — it is stamped on metal, and the
                    page's accent is drawn for the ground behind it. */}
                {narrowing && (
                  <p className="relative order-6 m-0 w-full min-w-0 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-[color:var(--billet-accent)] lg:order-none">
                    {filterSummary(filters)} · {visible.length} of {leagues.length}
                  </p>
                )}
              </>
            ) : undefined
          }
          /* The copy is the page's and the *treatment* is the billet's — see
             `ManagerBillet`, which inks the whole eyebrow row so the season
             cannot come to be drawn differently from the word it qualifies.

             The week is deliberately *not* a third field here, though the
             handoff offers one: the stepper directly under this header names
             it in a lit readout at every width, and a second copy two lines
             above it is the same news in two places — the argument that took
             the `WIN` caption out of the dial's window. */
          eyebrow={
            <>
              {heading}
              {state.season && <span>· {state.season}</span>}
            </>
          }
        >
          {/* The week's figures, milled into the billet — and only once there
              is an account's worth of leagues to sum. They read off `visible`,
              the list as narrowed, with `answered` as the attention count's
              denominator; see {@link WeekSummary}. */}
          {leagues.length > 0 ? (
            <WeekSummary
              summary={summary}
              attention={attention}
              of={answered}
              pending={check === null}
            />
          ) : undefined}
        </ManagerBillet>
      </header>

      {/* The stepper keeps the row under the header at every width, and the
          hairline fills the rest of it from `sm` up — below that the row is
          the stepper alone, a rule across the rest of a phone's width having
          nothing on its far side to lead to. See the module note for why the
          strip-mounted copy went with the plate. */}
      <div
        className={`relative my-6 flex flex-wrap items-center gap-3 sm:my-9 ${card.chromeClass}`}
      >
        <WeekStepper week={check?.week ?? null} onChange={onWeek} />
        <div
          aria-hidden
          className="hidden h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent sm:block"
        />
      </div>

      {/* The drawers hide their own state once closed, so the narrowing they
          left behind needs a home on the page — the manager console's own
          argument, and the same strip. */}
      <SubjectTokens
        subjects={subjects}
        names={subjectName}
        onRemove={(s) => setSubjects((prev) => removeSubject(prev, s))}
        onMatch={(match) => setSubjects((prev) => ({ ...prev, match }))}
        onClear={() => setSubjects(NO_SUBJECTS)}
      />

      {error ? (
        <Alert>{error}</Alert>
      ) : cold ? (
        <ColdProgress progress={progress} />
      ) : (
        <>
          {/* A projections read that failed is a note beside a usable list of
              leagues, never a replacement for it: the leagues are real and
              their numbers are absent, which is a different claim from zero. */}
          {check?.projections === "error" && (
            <Alert>
              Couldn&rsquo;t project this week&rsquo;s lineups. The leagues below
              are current; the numbers read blank rather than zero.
            </Alert>
          )}
          {check?.week === null && (
            <Plate>
              <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                No week left to check in {check.season} — the season is over.
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
            // manager, this one is about the selection.
            <Plate>
              <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                No leagues match these filters.
              </p>
              <p className="mt-2 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
                {filterSummary(filters)}
              </p>
            </Plate>
          ) : (
            <>
              {/* The cleared-check mark's face gradient, once for the whole
                  page rather than once per tile — see `LineupMarkDefs`. It is
                  mounted here because this is the one place that knows there
                  is a list of cards at all, and *beside* the list rather than
                  inside it: a `<ul>` takes `<li>` children and nothing else. */}
              <LineupMarkDefs />
              {/* **The list is the parked shell** — see `LeaguesHome`, which
                  carries the argument, and `useActiveCard`.
                  `[overflow-anchor:none]` for its reason too: opening a card
                  grows content above the viewport's anchor and the browser
                  compensates by moving `scrollTop`, which lands the park
                  somewhere arbitrary and reads as its having missed. */}
              <ul
                ref={listRef}
                {...card.shellProps}
                className="relative m-0 grid list-none grid-cols-1 gap-[1.125rem] p-0 [overflow-anchor:none]"
              >
                {visible.map((league) => (
                  <LineupCheckCard
                    key={league.league_id}
                    league={league}
                    entry={checked[league.league_id] ?? null}
                    onSynced={reread}
                    open={card.isOpen(league.league_id)}
                    lit={card.isLit(league.league_id)}
                    onToggle={card.toggle}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Mounted once each kind has been opened, and kept: a closed drawer is
          `open={false}`, not unmounted, so its search, its scroll and the
          decisions view a reader was inside survive being shut. Both count over
          `entries` — the league-filtered, subject-unnarrowed list — and the
          readout's denominator is `leagues.length`, the account's own total. */}
      {opened.has("starter") && (
        <StarterSharesDrawer
          open={drawer === "starter"}
          onClose={() => setDrawer(null)}
          entries={entries}
          week={check?.week ?? null}
          leagueTotal={leagues.length}
          filterSummary={narrowing ? filterSummary(filters) : null}
          pending={check === null}
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
        />
      )}
      {opened.has("opponent") && (
        <OpponentSharesDrawer
          open={drawer === "opponent"}
          onClose={() => setDrawer(null)}
          entries={entries}
          week={check?.week ?? null}
          leagueTotal={leagues.length}
          filterSummary={narrowing ? filterSummary(filters) : null}
          pending={check === null}
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
        />
      )}
    </div>
  );
}

/** The recessed plate the empty states sit on. */
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

/** The first visit, where there is nothing stored to check yet. */
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
