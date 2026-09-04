"use client";

import { type ReactNode, useMemo, useState } from "react";

import type {
  KtcBoardChoice,
  LineupMetricId,
  ManagerLeague,
  ManagerLineupsPayload,
} from "@/shared/contract";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  CONSOLE_KEY,
  CONSOLE_KEY_BLOCK,
  CONSOLE_READOUT,
  type LeagueFilters,
  LeagueFiltersDialog,
  ManagerPlate,
  matchesFilters,
  usePublishRackReadout,
  useKtcBoard,
  useLineupColumns,
  useManagerLeagues,
} from "@/features/shared";

import {
  type LeagueSubjects,
  matchesSubjects,
  NO_SUBJECTS,
  removeSubject,
  type Subject,
  toggleSubject,
} from "../helpers/league-subjects";
import { useManagerLineups } from "../hooks/use-manager-lineups";
import {
  useManagerLeaguemates,
  useManagerPlayers,
} from "../hooks/use-manager-shares";
import { LeagueCard } from "./league-card";
import { LeaguemateSharesDrawer } from "./leaguemate-shares-drawer";
import { LineupColumnsDialog } from "./lineup-columns-dialog";
import { PlayerSharesDrawer } from "./player-shares-drawer";
import { SeasonSummary } from "./season-summary";
import { SubjectTokens } from "./subject-tokens";

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
 * The header is a plate, a summary housing and a View housing on one row, and
 * `items-stretch` rather than `items-center` is what makes that row read as a
 * rack: three instruments of one height, not three objects floating on a
 * midline.
 *
 * **The panel is gone.** The page used to draw a rounded, bordered panel with
 * `--background` showing around it; the ground in `layout.tsx` is that surface
 * now and runs to the viewport edges. With the rack floating above, a second
 * bounded rectangle inside the viewport read as a panel inside a panel.
 *
 * What went with it: the trim rule that carried the two dialog triggers and
 * the theme key, and the accent line above it that said what the list had been
 * narrowed to. The triggers moved into the View housing and the sentence
 * became the readout at the foot of it; the theme key belongs to the rack now,
 * because a page-level copy would be a second control over one setting.
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

  // The KTC market this device reads. It rides *both* server reads below for
  // one reason: the price a shares row prints and the ranks a card prints are
  // on one market or they are on two, and the reader chose one.
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
  const visible = useMemo(
    () =>
      leagueFiltered.filter((league) =>
        matchesSubjects(
          league.league_id,
          subjects,
          players.data?.rosters ?? null,
          leaguemates.data?.members ?? null,
        ),
      ),
    [leagueFiltered, subjects, players.data, leaguemates.data],
  );

  // A token names what the reader picked. The maps are the only place those
  // names live, so an id that outlives its payload falls back to itself rather
  // than to a blank chip.
  const subjectName = (s: Subject) =>
    s.kind === "player"
      ? (players.data?.players[s.id]?.name ?? s.id)
      : (leaguemates.data?.users[s.id]?.display_name ?? s.id);

  // Fetched once the leagues settle — `!refreshing` flipping true is also what
  // refetches after a cold sync, when the rosters this read solves from were
  // just written. See the hook. The board rides the request rather than being
  // applied here, because the four KTC columns are ranked and only the server
  // can rank them.
  const lineups = useManagerLineups(
    username,
    state.season,
    leagues.length > 0 && !refreshing,
    ktcBoard,
  );
  const columns = useLineupColumns();

  // Sleeper lets a display name go missing, so the username is the fallback
  // everywhere this pair is shown.
  const name = user ? user.display_name || user.username : username;

  // The rack's lit pill names whoever's page this is. Published rather than
  // read up there, because the season is the *stream's* answer and the URL
  // does not carry it — see `usePublishRackReadout`.
  usePublishRackReadout(username, state.season);

  return (
    <div className="relative">
      {/* Stretch, not centre: the three instruments are one rack, so they take
          one height and their internal grooves and bezels stretch with it.
          They stack at a phone's width, where a row of three cannot. */}
      <header className="relative flex flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-5">
        <ManagerPlate
          name={name}
          avatarUrl={user?.avatar_url ?? null}
          eyebrow={
            <span className="flex items-baseline gap-2">
              {heading}
              {state.season && (
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
                  · {state.season}
                </span>
              )}
            </span>
          }
        />

        {/* The summary is about the account, so it only appears once there is
            an account's worth of leagues to summarise. */}
        {leagues.length > 0 && <SeasonSummary leagues={leagues} />}

        <BrowseHousing
          open={drawer}
          onOpen={(kind) => {
            // Latch and open in the same handler — never during render.
            setOpened((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
            setDrawer(kind);
          }}
        />

        <ViewHousing
          filters={filters}
          onChange={setFilters}
          leagues={leagues}
          columns={columns}
          board={ktcBoard}
          ktc={lineups?.ktc ?? null}
          matched={visible.length}
          narrowing={narrowing}
        />
      </header>

      {/* One rule as the boundary before the grid. It used to carry the
          controls; it is only a boundary now. */}
      <div
        aria-hidden
        className="relative my-9 h-px bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
      />

      {/* The drawers hide their own state once closed, so the narrowing they
          applied has to be named somewhere the reader can see and undo it. */}
      <SubjectTokens
        subjects={subjects}
        names={subjectName}
        onRemove={(s) => setSubjects((prev) => removeSubject(prev, s))}
        onMatch={(match) => setSubjects((prev) => ({ ...prev, match }))}
        onClear={() => setSubjects(NO_SUBJECTS)}
      />

      {error ? (
        <p
          role="alert"
          className="relative inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[0.8125rem] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
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
              className="relative mb-6 inline-flex items-center gap-3 rounded-full border border-foreground/8 bg-[image:var(--key-bg)] py-2 pl-2.5 pr-5 shadow-[var(--plate-shadow)]"
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
                <span className="relative font-mono text-[0.8125rem] text-readout [text-shadow:var(--readout-text-glow)]">
                  {progress && progress.total > 0
                    ? `Refreshing ${progress.loaded} of ${progress.total}…`
                    : "Refreshing…"}
                </span>
              </span>
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
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
              className="relative mb-6 inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[0.8125rem] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
            >
              <span aria-hidden className="size-[0.4375rem] rounded-full bg-error shadow-[0_0_10px_var(--error)]" />
              {refreshError}
            </p>
          )}
          {leagues.length === 0 ? (
            <Plate>
              <p className="m-0 font-mono text-[0.8125rem] text-foreground/72">
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
                  <p className="m-0 font-mono text-[0.8125rem] text-foreground/72">
                    No leagues match these filters.
                  </p>
                  <p className="mt-2 truncate font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-active">
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
            <ul className="relative m-0 grid list-none grid-cols-1 gap-[1.125rem] p-0">
              {visible.map((league) => (
                <LeagueCard
                  key={league.league_id}
                  league={league}
                  columns={columns}
                  entry={lineups?.leagues[league.league_id] ?? null}
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
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
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
          selfId={user?.user_id ?? null}
          subjects={subjects}
          onToggle={(s) => setSubjects((prev) => toggleSubject(prev, s))}
        />
      )}
    </div>
  );
}

/**
 * The fourth instrument on the header row: the two doors onto the shares
 * drawers.
 *
 * A housing of its own rather than two more keys in `ViewHousing`, because they
 * are a different job. View narrows the grid from what a league *is*; Browse
 * opens a list of who is *in* it — and the narrowing that comes back from one
 * lands in the token tray under the rule, not in View's readout.
 *
 * **No count on either key.** The data behind them is fetched on first press,
 * so a figure would be absent exactly until you no longer needed it. The
 * drawer's own readout says how many it holds.
 */
function BrowseHousing({
  open,
  onOpen,
}: {
  open: Subject["kind"] | null;
  onOpen: (kind: Subject["kind"]) => void;
}) {
  const key = `${CONSOLE_KEY_BLOCK} justify-between gap-3 bg-[image:var(--key-bg)] shadow-[var(--key-shadow)] sm:w-full`;
  const state = (on: boolean) =>
    on
      ? "border-active/45 text-readout"
      : "border-foreground/10 text-foreground/80 hover:text-readout";

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-foreground/8 bg-[image:var(--key-bg)] p-2.5 shadow-[var(--plate-shadow)] sm:min-w-44">
      <span className="px-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/50">
        Browse
      </span>
      <div className="flex flex-1 flex-wrap items-start gap-2 sm:flex-col sm:flex-nowrap sm:items-stretch">
        <button
          type="button"
          onClick={() => onOpen("player")}
          aria-haspopup="dialog"
          aria-expanded={open === "player"}
          // Shape and state composed rather than concatenated onto a string
          // that already names a border colour — same specificity, and which
          // one wins is decided by Tailwind's emit order.
          className={`${key} ${state(open === "player")}`}
        >
          Players
        </button>
        <button
          type="button"
          onClick={() => onOpen("leaguemate")}
          aria-haspopup="dialog"
          aria-expanded={open === "leaguemate"}
          className={`${key} ${state(open === "leaguemate")}`}
        >
          Leaguemates
        </button>
      </div>
    </div>
  );
}

/**
 * The third instrument on the header row: the two dialog triggers, stacked,
 * over a readout of what they have left.
 *
 * It replaces a trim rule with three bordered buttons hanging off it, and the
 * readout replaces the accent sentence that used to sit above that rule. Both
 * dialogs hide their own state, so something on the page has to say what the
 * grid below has been narrowed to — `{matched} / {total}` is that, with the
 * filter summary under it.
 *
 * `mt-auto` on the readout is what makes the row's heights agree: the housing
 * stretches to the tallest instrument beside it, and the readout takes up the
 * slack at the bottom rather than leaving a gap under the keys.
 *
 * At a phone's width the three go on one line and the summary line drops — the
 * figure is the half that cannot be got anywhere else.
 */
function ViewHousing({
  filters,
  onChange,
  leagues,
  columns,
  board,
  ktc,
  matched,
  narrowing,
}: {
  filters: LeagueFilters;
  onChange: (filters: LeagueFilters) => void;
  leagues: readonly ManagerLeague[];
  columns: readonly LineupMetricId[];
  board: KtcBoardChoice;
  ktc: ManagerLineupsPayload["ktc"];
  matched: number;
  narrowing: boolean;
}) {
  const key = `${CONSOLE_KEY_BLOCK} justify-between gap-3 sm:w-full`;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-foreground/8 bg-[image:var(--key-bg)] p-2.5 shadow-[var(--plate-shadow)] sm:ml-auto sm:min-w-60">
      <span className="px-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-foreground/50">
        View
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2 sm:flex-col sm:flex-nowrap sm:items-stretch">
        <LeagueFiltersDialog
          filters={filters}
          onChange={onChange}
          leagues={leagues}
          triggerClassName={key}
        />
        <LineupColumnsDialog
          columns={columns}
          board={board}
          ktc={ktc}
          triggerClassName={key}
        />

        <span
          className={`${CONSOLE_READOUT} ml-auto flex flex-col rounded-[0.625rem] px-3 py-2 sm:ml-0 sm:mt-auto`}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
          />
          <span className="relative font-mono text-[1.0625rem] leading-none tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
            {matched} / {leagues.length}
          </span>
          {narrowing && (
            <span className="relative mt-1.5 hidden truncate font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout/60 sm:block">
              {filterSummary(filters)}
            </span>
          )}
        </span>
      </div>
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
          className="m-0 font-mono text-[0.9375rem] text-readout [text-shadow:var(--readout-text-glow)]"
          aria-live="polite"
        >
          Syncing leagues from Sleeper…
        </p>
        {total > 0 && (
          <p className="m-0 font-mono text-[0.9375rem] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
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
        <p className="relative mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-error">
          {progress.failed} league{progress.failed === 1 ? "" : "s"} failed to
          sync
        </p>
      )}
    </div>
  );
}
