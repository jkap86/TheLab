"use client";

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import {
  activeFilterCount,
  DEFAULT_LEAGUE_FILTERS,
  filterSummary,
  BILLET_KEY_CHROME,
  BubblingFlask,
  CONSOLE_METAL_TRACK_SM,
  FlaskDefs,
  LeagueFiltersDialog,
  ManagerBillet,
  matchesFilters,
  PLATE_KEY,
  useManagerLeagues,
  useActiveCard,
  useUrlParam,
  WeekGauge,
  WeekStepper,
  writeQueryParam,
} from "@/features/shared";

import { isPlausibleWeek } from "@/shared/projections/weeks";
import type { ManagerGametimePayload } from "@/shared/contract";

import { useGametime } from "../hooks/use-gametime";
import { gametimeReadout } from "../helpers/connection";
import type { GametimeConnection, LeagueListState } from "../helpers/connection";
import {
  formatLiveRecord,
  formatLiveWinPct,
  leaguesAnswered,
  leaguesInPlay,
  liveSummary,
} from "../helpers/live-record";
import { GametimeCard } from "./gametime-card";

/** Stable empty answer, so a render before the read lands hands the memos the same object. */
const NO_LEAGUES: Record<string, never> = {};
const NO_BOARD: Record<string, never> = {};

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
 * **No Browse keys, deliberately.** The checker's two drawers answer who you
 * started and who you play, which are questions about the lineup as set; this
 * page is about what that lineup is doing, and a drawer narrowing the grid
 * would be the same drawer one tool over. They arrive if a reader asks for
 * them.
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

  const [filters, setFilters] = useState(DEFAULT_LEAGUE_FILTERS);

  const { payload, pending, connection, stale } = useGametime(
    username,
    state.season,
    week,
    leagues.length > 0 && !refreshing,
  );
  const entries = payload?.leagues ?? NO_LEAGUES;
  const board = payload?.board ?? NO_BOARD;
  const leagueList: LeagueListState =
    leagues.length > 0 ? "ready" : refreshing ? "loading" : "none";

  const visible = useMemo(
    () => leagues.filter((league) => matchesFilters(league, filters)),
    [leagues, filters],
  );
  const narrowing = activeFilterCount(filters) > 0;

  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = useMemo(() => visible.map((l) => l.league_id), [visible]);
  const card = useActiveCard({ param: "league", ids, listRef });

  const { summary, inPlay, answered } = useMemo(
    () => ({
      summary: liveSummary(visible, entries),
      inPlay: leaguesInPlay(visible, entries),
      answered: leaguesAnswered(visible, entries),
    }),
    [visible, entries],
  );

  const name = user ? user.display_name || user.username : username;

  return (
    <div className="relative">
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
        <LiveReadout payload={payload} connection={connection} leagues={leagueList} stale={stale} />
        <div
          aria-hidden
          className="hidden h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent sm:block"
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
            <Plate>
              <p className="m-0 font-mono text-[length:var(--fs-13)] text-foreground/72">
                No leagues match these filters.
              </p>
              <p className="mt-2 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-active">
                {filterSummary(filters)}
              </p>
            </Plate>
          ) : (
            <ul
              ref={listRef}
              {...card.shellProps}
              className="relative m-0 grid list-none grid-cols-1 gap-[1.125rem] p-0 [overflow-anchor:none]"
            >
              {visible.map((league) => {
                const open = card.isOpen(league.league_id);
                return (
                  <GametimeCard
                    key={league.league_id}
                    league={league}
                    entry={entries[league.league_id] ?? null}
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
 */
function LiveReadout({
  payload,
  connection,
  leagues,
  stale,
}: {
  payload: ManagerGametimePayload | null;
  connection: GametimeConnection;
  leagues: LeagueListState;
  stale: string | null;
}) {
  const readout = gametimeReadout({
    connection,
    leagues,
    games: payload?.games ?? null,
    stale,
    degraded:
      payload !== null &&
      (payload.projections === "error" ||
        payload.stats === "error" ||
        payload.scores === "error"),
  });

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
