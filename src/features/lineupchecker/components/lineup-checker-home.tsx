"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  CONSOLE_KEY,
  CONSOLE_KEY_PILL,
  CONSOLE_TRACK,
  CONSOLE_WINDOW,
  LeagueFiltersDialog,
  ManagerPlate,
  matchesFilters,
  matchesSubjects,
  NO_SUBJECTS,
  removeSubject,
  Scanlines,
  SubjectTokens,
  toggleSubject,
  type LeagueSubjects,
  type RackDrawerKey,
  type Subject,
  type SubjectRolls,
  useManagerLeagues,
  usePublishRackControls,
} from "@/features/shared";

import { useLineupCheck } from "../hooks/use-lineup-check";
import {
  attentionByReason,
  needsAttention,
  type AttentionReasons,
} from "../helpers/lineup-check-metrics";
import type { WeekLineupEntry } from "../helpers/starter-shares";
import { weekSummary } from "../helpers/week-summary";
import { LineupCheckCard } from "./lineup-check-card";
import { OpponentSharesDrawer } from "./opponent-shares-drawer";
import { StarterSharesDrawer } from "./starter-shares-drawer";
import { WeekSummary } from "./week-summary";
import { WeekStepper } from "./week-stepper";

/**
 * The two Browse keys this page puts in the rack, and their legends.
 *
 * **Module scope, not a literal in the render**, which is the requirement
 * `usePublishRackControls` states rather than a habit: the publish effect
 * depends on this array, so one rebuilt each render would publish each render,
 * set an ancestor's state and re-render — a loop rather than a stale value.
 */
const BROWSE_KEYS: readonly RackDrawerKey[] = [
  { kind: "starter", label: "Starters" },
  { kind: "opponent", label: "Opponents" },
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
 * The plate and the card are the leagues console's. A reader arriving from
 * `/manager` is looking at the same leagues, and a second vocabulary for them
 * would be a second chance for one to drift — which is why this page took that
 * one's header pass whole: the figures are engraved on the identity plate
 * rather than standing beside it in a housing of their own, and the Filters key
 * and the sentence saying what it narrowed are a strip along the plate's foot.
 * What differs is only the figures themselves, because a week is not a season:
 * a projected record and a projected win rate where `/manager` carries the
 * standing ones, with the attention window at the plate's right end.
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
  // A stepped week, or null to take the one the route resolves. Null is a real
  // opening state: which week is current is the route's answer, and the week
  // *shown* is always read back off the payload — see `WeekStepper`.
  const [week, setWeek] = useState<number | null>(null);

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
      onWeek={setWeek}
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
  const attention = needsAttention(visible, checked);
  const reasons = attentionByReason(visible, checked);
  const summary = weekSummary(visible, checked);
  // The window's denominator is the leagues *on screen* that the check
  // answered for, not every league it answered for: narrowed to one league,
  // `1 of 3` would be a count over a list the reader cannot see.
  const answered = visible.filter(
    (league) => checked[league.league_id] !== undefined,
  ).length;

  const name = user ? user.display_name || user.username : username;

  return (
    <div className="relative">
      <header className="relative">
        <ManagerPlate
          name={name}
          avatarUrl={user?.avatar_url ?? null}
          /*
            **The Filters key sits on the plate**, the arrangement `/manager`
            arrived at: up in the rack the key said "a filter is on" and nothing
            said *what* was narrowed, while the sentence that said so stood on a
            line of its own under the header. Here the key, the key that undoes
            it and the sentence are one object.

            `leagues` is the **unfiltered** list deliberately — it is the
            population every count inside the dialog is taken over, and handing
            it the filtered one would collapse each of the dialog's own menus to
            the selection already made.
          */
          controls={
            leagues.length > 0 ? (
              <>
                <span className={`${CONSOLE_TRACK} flex items-center gap-1.5 p-1`}>
                  <LeagueFiltersDialog
                    filters={filters}
                    onChange={setFilters}
                    leagues={leagues}
                    triggerClassName={`${CONSOLE_KEY_PILL} inline-flex items-center`}
                  />
                  {/* Only while there is something to clear: a key that is a
                      no-op three quarters of the time is a key a reader stops
                      reading. */}
                  {narrowing && (
                    <button
                      type="button"
                      onClick={() => setFilters(DEFAULT_LEAGUE_FILTERS)}
                      className={CONSOLE_KEY}
                    >
                      Clear
                    </button>
                  )}
                </span>
                {/* `flex-[1_1_12rem]` is what lets the sentence take the rest of
                    the strip and then drop to its own line rather than
                    truncating the moment the keys grow. */}
                {narrowing && (
                  <p className="m-0 min-w-0 flex-[1_1_12rem] truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
                    {filterSummary(filters)} · {visible.length} of {leagues.length}
                  </p>
                )}
              </>
            ) : undefined
          }
          eyebrow={
            <span className="flex items-baseline gap-2">
              {heading}
              {state.season && (
                <span className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
                  · {state.season}
                </span>
              )}
            </span>
          }
        >
          {/* The week is engraved on the plate rather than standing beside it,
              and the attention window rides at its right end — the header pass
              `/manager` took, applied to the figures this page has. Passing
              children is what switches `ManagerPlate` to its full-width box;
              with no leagues there is nothing to sum and the plate stays the
              `inline-flex` it has always been here. */}
          {leagues.length > 0 ? (
            <WeekSummary summary={summary}>
              <AttentionWindow
                attention={attention}
                of={answered}
                reasons={reasons}
                pending={check === null}
              />
            </WeekSummary>
          ) : undefined}
        </ManagerPlate>
      </header>

      {/* The stepper keeps the row and the hairline fills the rest of it. The
          `Clear filters` key that used to stand at its far end is on the plate
          now, beside the key that set the filter in the first place. */}
      <div className="relative my-9 flex flex-wrap items-center gap-3">
        <WeekStepper week={check?.week ?? null} onChange={onWeek} />
        <div
          aria-hidden
          className="h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
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
            <ul className="relative m-0 grid list-none grid-cols-1 gap-[1.125rem] p-0">
              {visible.map((league) => (
                <LineupCheckCard
                  key={league.league_id}
                  league={league}
                  entry={checked[league.league_id] ?? null}
                  onSynced={reread}
                />
              ))}
            </ul>
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

/**
 * How many of these lineups want a press, and what for.
 *
 * **One lit window, where it used to be a plate holding a readout.** The plate
 * went with the header pass: the identity plate is the instrument now and this
 * is a window set into it, the same surface every other reading on the console
 * is drawn on.
 *
 * The count is over *leagues* — a league with both a gap and a re-seat is one
 * league, and one trip to Sleeper. The four rows underneath are over *reasons*,
 * and **they do not sum to it**, which is why the count is stated separately
 * and the rows are labelled by reason rather than presented as a breakdown a
 * reader could add up. See `attentionByReason`.
 *
 * Before the check lands there is no number at all: an em dash rather than a
 * zero, which would read as "all clear" for the length of a round trip, and no
 * rows, because four zeroes make the same claim four times. `aria-live` is on
 * the count so the answer is announced when it arrives.
 */
function AttentionWindow({
  attention,
  of,
  reasons,
  pending,
}: {
  attention: number;
  of: number;
  reasons: AttentionReasons;
  pending: boolean;
}) {
  return (
    <div
      className={`${CONSOLE_WINDOW} flex min-w-[12.5rem] flex-col gap-[0.4375rem] rounded-[0.625rem] px-3 py-2.5 font-mono`}
      title={`${attention} of ${of} league${of === 1 ? "" : "s"} checked need a look`}
    >
      <Scanlines />
      <span className="relative flex items-baseline justify-between gap-2.5">
        <span className="text-[length:var(--fs-9)] uppercase tracking-[0.18em] text-readout-label">
          Need a look
        </span>
        <span
          aria-live="polite"
          className={`text-[length:var(--fs-17)] leading-none tabular-nums ${
            !pending && attention > 0
              ? "text-error [text-shadow:0_0_12px_rgba(252,165,165,0.45)]"
              : "text-readout [text-shadow:var(--readout-text-glow)]"
          }`}
        >
          {pending ? "—" : `${attention} of ${of}`}
        </span>
      </span>

      <span
        aria-hidden
        className="relative block h-px bg-[color-mix(in_srgb,var(--readout-label)_26%,transparent)]"
      />

      <ReasonRow label="Points left" count={pending ? null : reasons.points} />
      <ReasonRow label="Kickoff order" count={pending ? null : reasons.kickoff} />
      <ReasonRow label="Superflex" count={pending ? null : reasons.superflex} />
      <ReasonRow label="Roster slots" count={pending ? null : reasons.roster} />
    </div>
  );
}

/**
 * One reason, and how many leagues are off for it.
 *
 * A row above zero is lit in the error tone, pip included; a zero row is the
 * window's muted ink throughout, so the eye finds the reasons that want a press
 * without reading four numbers. `null` is the state before the check lands —
 * the em dash, never a zero, for the reason the count above draws one.
 */
function ReasonRow({ label, count }: { label: string; count: number | null }) {
  const lit = count !== null && count > 0;
  return (
    <span className="relative flex items-center gap-2">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-full ${
          lit
            ? "bg-error shadow-[0_0_10px_rgba(252,165,165,0.5)]"
            : "bg-readout-muted"
        }`}
      />
      <span
        className={`flex-1 whitespace-nowrap text-[length:var(--fs-10)] uppercase tracking-[0.14em] ${
          lit ? "text-readout-line" : "text-readout-muted"
        }`}
      >
        {label}
      </span>
      <span
        className={`text-[length:var(--fs-13)] leading-none tabular-nums ${
          lit
            ? "text-error [text-shadow:0_0_10px_rgba(252,165,165,0.5)]"
            : "text-readout-muted"
        }`}
      >
        {count ?? "—"}
      </span>
    </span>
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
