"use client";

import type { ReactNode } from "react";

import { Avatar } from "@/features/shared";

import { useManagerLeagues } from "../hooks/use-manager-leagues";
import { LeagueCard } from "./league-card";

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
  const cold = leagues.length === 0 && refreshing;

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
                ` · ${leagues.length} league${leagues.length === 1 ? "" : "s"}`}
            </p>
          )}
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
          ) : (
            <ul className="grid gap-3 @2xl:grid-cols-2">
              {leagues.map((league) => (
                <LeagueCard key={league.league_id} league={league} />
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
