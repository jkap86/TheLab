"use client";

import { type ReactNode, useMemo, useState } from "react";

import {
  activeFilterCount,
  Avatar,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  matchesFilters,
  ThemeToggle,
  useLineupColumns,
} from "@/features/shared";

import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { useManagerLineups } from "../hooks/use-manager-lineups";
import { LeagueCard } from "./league-card";
import { LeagueFiltersDialog } from "./league-filters-dialog";
import { LineupColumnsDialog } from "./lineup-columns-dialog";

/**
 * A manager's leagues for a season.
 *
 * Five states, and which one shows turns entirely on what the stream has said
 * so far — see {@link useManagerLeagues}. The one worth naming is the pair in
 * the middle: a cold visit has nothing to show and gets a progress bar, while a
 * warm one shows its stored leagues immediately and puts the same sync's
 * progress in a line above them. Both are the same stream.
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
  // list, not a device preference, which is the argument `LeagueTeams` makes for
  // its own `<select>`. The reset happens during render rather than in an
  // effect, the idiom `useManagerLeagues` documents: an effect would paint one
  // frame of the new manager's leagues under the old manager's filters.
  const [filters, setFilters] = useState(DEFAULT_LEAGUE_FILTERS);
  const subject = `${username} ${season ?? ""}`;
  const [renderedSubject, setRenderedSubject] = useState(subject);
  if (renderedSubject !== subject) {
    setRenderedSubject(subject);
    setFilters(DEFAULT_LEAGUE_FILTERS);
  }

  const narrowing = activeFilterCount(filters) > 0;
  const visible = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  // Fetched once the leagues settle — `!refreshing` flipping true is also what
  // refetches after a cold sync, when the rosters this read solves from were
  // just written. See the hook.
  const lineups = useManagerLineups(
    username,
    state.season,
    leagues.length > 0 && !refreshing,
  );
  const columns = useLineupColumns();

  return (
    <section className="@container">
      <header className="mb-6 flex items-center gap-4">
        <Avatar
          url={user?.avatar_url ?? null}
          name={user?.display_name || user?.username || username}
          size="xl"
        />
        <div className="min-w-0 flex-1">
          {heading}
          {/* Sleeper lets a display name go missing, so the username is the
              fallback everywhere this pair is shown. */}
          <p className="mt-1 truncate font-display text-2xl font-semibold tracking-tight">
            {user ? user.display_name || user.username : username}
          </p>
          {state.season && (
            <p className="mt-0.5 text-xs text-foreground/60">
              {state.season} season
              {leagues.length > 0 &&
                (narrowing
                  ? ` · ${visible.length} of ${leagues.length} leagues`
                  : ` · ${leagues.length} league${leagues.length === 1 ? "" : "s"}`)}
            </p>
          )}
          {/* A modal hides its own state, so this line is the only thing on the
              page saying what the list below has been narrowed to. */}
          {narrowing && (
            <p className="mt-0.5 truncate text-xs text-active">
              {filterSummary(filters)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <LeagueFiltersDialog
            filters={filters}
            onChange={setFilters}
            leagues={leagues}
          />
          <LineupColumnsDialog columns={columns} />
          <ThemeToggle />
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-foreground/12 bg-foreground/[0.04] p-6 text-sm text-error"
        >
          {error}
        </p>
      ) : cold ? (
        <ColdProgress progress={progress} />
      ) : (
        <>
          {refreshing && (
            <p className="mb-4 text-xs text-foreground/60" aria-live="polite">
              {progress && progress.total > 0
                ? `Refreshing ${progress.loaded} of ${progress.total}…`
                : "Refreshing…"}
            </p>
          )}
          {/* A failed refresh is a note beside a usable list, never a replacement
              for it: the leagues below are what was stored, and they are still
              worth reading. */}
          {refreshError && (
            <p role="alert" className="mb-4 text-xs text-error">
              {refreshError}
            </p>
          )}
          {leagues.length === 0 ? (
            <p className="rounded-2xl border border-foreground/12 bg-foreground/[0.04] p-6 text-sm text-foreground/60">
              No leagues found{state.season ? ` for ${state.season}` : ""}.
            </p>
          ) : visible.length === 0 ? (
            // A different claim from the one above: that one is about the
            // manager, this one is about the selection — and it is the reader's
            // to undo, so it says so.
            <div className="rounded-2xl border border-foreground/12 bg-foreground/[0.04] p-6">
              <p className="text-sm text-foreground/60">
                No leagues match these filters.
              </p>
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_LEAGUE_FILTERS)}
                className="mt-3 rounded-lg border border-active/40 bg-active/10 px-4 py-1.5 text-sm font-medium text-active transition-colors hover:bg-active/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/50"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="grid gap-3 @2xl:grid-cols-2">
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
    </section>
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
    <div className="rounded-2xl border border-foreground/12 bg-foreground/[0.04] p-6 shadow-[0_24px_60px_-34px_var(--surface-shadow)]">
      <p className="text-sm text-foreground/80" aria-live="polite">
        {total > 0
          ? `Syncing leagues — ${loaded} of ${total}…`
          : "Syncing leagues from Sleeper…"}
      </p>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
        aria-valuenow={total > 0 ? pct : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Syncing leagues"
      >
        <div
          className="h-full rounded-full bg-active transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress && progress.failed > 0 && (
        // Reported while it runs rather than only at the end: these leagues are
        // not coming back on this pass, and the list about to appear is short by
        // exactly this many.
        <p className="mt-2 text-xs text-error">
          {progress.failed} league{progress.failed === 1 ? "" : "s"} failed to
          sync.
        </p>
      )}
    </div>
  );
}
