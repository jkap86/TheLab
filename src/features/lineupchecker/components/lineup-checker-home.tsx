"use client";

import { type ReactNode, useMemo, useState } from "react";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  CONSOLE_KEY,
  ManagerPlate,
  matchesFilters,
  useManagerLeagues,
  useStoredAccount,
} from "@/features/shared";

import { useLineupCheck } from "../hooks/use-lineup-check";
import { needsAttention } from "../helpers/lineup-check-metrics";
import { LineupCheckCard } from "./lineup-check-card";
import { WeekStepper } from "./week-stepper";

/**
 * The lineup checker: every league this account plays in, what its lineup is
 * projected to score against the best one still reachable, and whether its
 * starters are seated in the order they lock best in.
 *
 * **It reads the stored account rather than a username in its URL.** The
 * account resolved on `/tools` is persisted, so a tool that is about *your*
 * leagues has no business asking for the name again — which is also what the
 * tool registry already declares for it (no `hrefFor`, and not `accountless`).
 *
 * **The two reads are separate on purpose.** The leagues arrive on the same
 * stream `/manager` reads, and the check is a batch read beside it — so the
 * cards draw as soon as the league list lands and the numbers fill in behind
 * them, rather than the page waiting on the slower of the two. It is also what
 * makes a failed check cost the week's numbers and not the list.
 *
 * The panel, the plate and the card are the leagues console's, unchanged. A
 * reader arriving from `/manager` is looking at the same leagues, and a second
 * vocabulary for them would be a second chance for one to drift.
 */
export function LineupCheckerHome({ heading }: { heading: ReactNode }) {
  const account = useStoredAccount();
  const username = account?.username ?? null;

  // A stepped week, or null to take the one the route resolves. Null is a real
  // opening state: which week is current is the route's answer, and the week
  // *shown* is always read back off the payload — see `WeekStepper`.
  const [week, setWeek] = useState<number | null>(null);

  if (!username) return <NoAccount heading={heading} />;
  return (
    <Checker
      // Remounting on a changed account is what keeps every piece of state
      // below — the week, the filters, the hooks' subjects — from having to
      // each remember to reset. There is exactly one subject on this page.
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
  const narrowing = activeFilterCount(filters) > 0;
  const visible = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );

  const check = useLineupCheck(
    username,
    state.season,
    week,
    leagues.length > 0 && !refreshing,
  );
  const checked = check?.leagues ?? {};
  const attention = needsAttention(visible, checked);

  const name = user ? user.display_name || user.username : username;

  return (
    <div className="relative rounded-3xl border border-foreground/9 bg-[image:var(--panel-bg)] px-6 pb-14 pt-10 shadow-[var(--panel-shadow)] sm:px-13 sm:pb-[4.5rem] sm:pt-16">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[image:var(--panel-grain)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-[image:var(--panel-specular)]"
      />

      <header className="relative flex flex-wrap items-center gap-6">
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

        {leagues.length > 0 && (
          <div className="ml-auto">
            <AttentionHousing
              attention={attention}
              of={Object.keys(checked).length}
              pending={check === null}
            />
          </div>
        )}
      </header>

      {narrowing && (
        <p className="relative mt-5 truncate font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-active">
          {filterSummary(filters)} · {visible.length} of {leagues.length}
        </p>
      )}

      <div className="relative my-9 flex flex-wrap items-center gap-3">
        <WeekStepper week={check?.week ?? null} onChange={onWeek} />
        <div
          aria-hidden
          className="h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
        />
        {narrowing && (
          <button
            type="button"
            onClick={() => setFilters(DEFAULT_LEAGUE_FILTERS)}
            className={CONSOLE_KEY}
          >
            Clear filters
          </button>
        )}
      </div>

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
              <p className="m-0 font-mono text-[0.8125rem] text-foreground/72">
                No week left to check in {check.season} — the season is over.
              </p>
            </Plate>
          )}
          {leagues.length === 0 ? (
            <Plate>
              <p className="m-0 font-mono text-[0.8125rem] text-foreground/72">
                No leagues found{state.season ? ` for ${state.season}` : ""}.
              </p>
            </Plate>
          ) : visible.length === 0 ? (
            // A different claim from the one above: that one is about the
            // manager, this one is about the selection.
            <Plate>
              <p className="m-0 font-mono text-[0.8125rem] text-foreground/72">
                No leagues match these filters.
              </p>
              <p className="mt-2 truncate font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-active">
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
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The one figure worth reading before a hundred cards: how many of these
 * lineups want a press.
 *
 * Counted over *leagues* rather than over points or seats — a league with both
 * a gap and a re-seat is one league, and one trip to Sleeper. Zero is the good
 * answer and says so in words; before the check lands there is no number, and
 * an em dash is what says that rather than a zero that would read as "all
 * clear" for the length of a round trip.
 */
function AttentionHousing({
  attention,
  of,
  pending,
}: {
  attention: number;
  of: number;
  pending: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-4 rounded-xl border border-foreground/8 bg-[image:var(--plate-bg)] px-5 py-3 shadow-[var(--plate-shadow)]">
      <div className="relative overflow-hidden rounded-[0.625rem] border border-black/85 bg-[image:var(--readout-bg)] px-4 py-2.5 shadow-[var(--readout-shadow)]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
        />
        <p className="relative m-0 whitespace-nowrap font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
          Needs a look
        </p>
        <p
          className={`relative m-0 mt-2 font-mono text-lg leading-none tabular-nums ${
            attention > 0 ? "text-error" : "text-readout"
          }`}
          aria-live="polite"
        >
          {pending ? "—" : attention > 0 ? attention : "All set"}
        </p>
      </div>
      {!pending && (
        <p className="m-0 max-w-[9rem] font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
          of {of} league{of === 1 ? "" : "s"} checked
        </p>
      )}
    </div>
  );
}

/** The state with nothing to check, because no account has been resolved. */
function NoAccount({ heading }: { heading: ReactNode }) {
  return (
    <div className="relative rounded-3xl border border-foreground/9 bg-[image:var(--panel-bg)] px-6 pb-14 pt-10 shadow-[var(--panel-shadow)] sm:px-13 sm:pb-[4.5rem] sm:pt-16">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[image:var(--panel-grain)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-[image:var(--panel-specular)]"
      />
      <div className="relative">
        {heading}
        <Plate>
          <p className="m-0 font-mono text-[0.8125rem] text-foreground/72">
            Connect a Sleeper account on the tools page to check your lineups.
          </p>
          <a href="/tools" className={`${CONSOLE_KEY} mt-4 inline-block`}>
            Go to tools
          </a>
        </Plate>
      </div>
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
      className="relative mb-6 inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[0.8125rem] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
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
    </div>
  );
}
