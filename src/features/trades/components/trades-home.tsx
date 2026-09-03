"use client";

import { type ReactNode, useMemo, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  LeagueFiltersDialog,
  activeFilterCount,
  filterSummary,
  useStoredAccount,
} from "@/features/shared";

import {
  DEFAULT_TRADE_FILTERS,
  DEFAULT_TRADE_SEEK,
  activeTradeFilterCount,
  tradeFilterSummary,
  tradeSeekBounds,
} from "../filters";
import type { TradeFilters, TradeNames, TradeSeek } from "../filters";
import { useTodayIso } from "../hooks/use-today-iso";
import { useTradeLeagues } from "../hooks/use-trade-leagues";
import { useTrades } from "../hooks/use-trades";
import { resolveLeagueScope, tradeQueryKey } from "../trade-query";
import type { TradeRequest } from "../trade-query";
import { CircleNote, CircleStepper } from "./trade-controls";
import { SeekKey } from "./seek-key";
import { TradeSearch } from "./trade-search";
import { TradesList } from "./trades-list";

/**
 * The trades board: every trade this database has stored for a season, narrowed
 * three ways.
 *
 * **The three narrowings are three different kinds of thing, and the split is
 * the design.**
 *
 * - **The league rules run here, in the browser**, and only their *answer*
 *   crosses the wire. They are the same engine the manager page filters its
 *   leagues with, over Sleeper's own JSONB blobs; a second implementation in
 *   SQL would drift silently, and the symptom would be a filter quietly
 *   returning the wrong leagues rather than an error.
 * - **The bays run in SQL.** Which players, picks and managers were on which
 *   side is a question about the trades themselves, and answering it in the
 *   browser would mean downloading the season to filter it.
 * - **The circle crosses unresolved**, as a word and an account id. What "my
 *   leagues" and "my leaguemates" stand for is the database's answer; a browser
 *   holding it would have had to be told it first.
 *
 * Two things must keep reading the **unfiltered** list, on the leagues console's
 * rule: the league dialog's own option counts, and the scope resolution itself.
 * Taken off a narrowed list they would each describe the selection rather than
 * the population it was made from.
 */
export function TradesHome({
  season,
  heading,
}: {
  season: string;
  /** Static copy, rendered on the server — see the page. */
  heading: ReactNode;
}) {
  const account = useStoredAccount();
  const today = useTodayIso();
  const { leagues, byId, error: leaguesError } = useTradeLeagues(season);

  const [leagueFilters, setLeagueFilters] = useState(DEFAULT_LEAGUE_FILTERS);
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_TRADE_FILTERS);
  const [seek, setSeek] = useState<TradeSeek>(DEFAULT_TRADE_SEEK);
  const [searchOpen, setSearchOpen] = useState(false);

  const narrowingLeagues = activeFilterCount(leagueFilters) > 0;

  // The request is memoised because it is the paging hook's input and the
  // subject key is derived from it; rebuilding it per render is fine, but the
  // key must be stable for an unchanged question.
  const request = useMemo<TradeRequest>(
    () => ({
      season,
      scope: resolveLeagueScope(leagues, leagueFilters, narrowingLeagues),
      filters,
      bounds: tradeSeekBounds(seek, today),
      user: account?.user_id ?? null,
    }),
    [season, leagues, leagueFilters, narrowingLeagues, filters, seek, today, account],
  );
  const requestKey = tradeQueryKey(request);

  // The facets read the same scope and window with **no selection** — see
  // `TradeSearchPanel`. Built here so both the request and its key are one
  // memo rather than the panel re-deriving them per render.
  const facetsRequest = useMemo<TradeRequest>(
    () => ({ ...request, filters: { ...filters, sides: DEFAULT_TRADE_FILTERS.sides } }),
    [request, filters],
  );
  const facetsKey = tradeQueryKey(facetsRequest);

  const { data, loading, loadingMore, hasMore, loadMore, error } = useTrades(
    request,
    requestKey,
  );

  // Names come off whatever the board has loaded; a facet can name a player no
  // loaded page does, which is why the panel merges its own `names` in. The id
  // is the fallback rather than a placeholder — it is the only true thing
  // available, and a summary reading "1 player" beside a bay drawing a name is
  // how the old shape gave itself away.
  const names = useMemo<TradeNames>(
    () => ({
      player: (id) => data?.players[id]?.name ?? id,
      manager: (id) => data?.managers[id]?.display_name ?? id,
    }),
    [data],
  );

  const selection = tradeFilterSummary(filters, names);
  const searchCount = activeTradeFilterCount(filters);

  return (
    <div className="relative rounded-3xl border border-foreground/9 bg-[image:var(--panel-bg)] px-5 pb-14 pt-8 shadow-[var(--panel-shadow)] sm:px-10 sm:pb-16 sm:pt-12">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[image:var(--panel-grain)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-[12%] top-0 h-px bg-[image:var(--panel-specular)]"
      />

      <header className="relative flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          {heading}
          <p className="mt-1 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
            {season}
          </p>
        </div>
        <div className="ml-auto">
          <CircleStepper
            circle={filters.circle}
            onChange={(circle) => setFilters({ ...filters, circle })}
            hasAccount={account !== null}
          />
        </div>
      </header>

      <div className="relative mt-3">
        <CircleNote circle={filters.circle} hasAccount={account !== null} />
      </div>

      {/* The controls rail. The rule fills what the keys leave, so they read as
          mounted on the console's trim rather than floating above the list. */}
      <div className="relative my-7 flex flex-wrap items-center gap-3">
        <div
          aria-hidden
          className="h-px flex-1 bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
        />
        <p
          role="status"
          className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] tabular-nums text-foreground/70"
        >
          <TradeCount data={data} loading={loading} />
        </p>
        <SeekKey seek={seek} onChange={setSeek} today={today} />
        {/* The dialog takes the **unfiltered** list: every count in it is over
            the whole population, which is what makes them counts rather than a
            description of what is already selected. */}
        <LeagueFiltersDialog
          filters={leagueFilters}
          onChange={setLeagueFilters}
          leagues={leagues}
        />
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          aria-expanded={searchOpen}
          className="shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/80 shadow-[var(--key-shadow)] transition-[transform,box-shadow,color] duration-150 hover:text-readout active:translate-y-0.5 active:shadow-[var(--key-shadow-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
        >
          Search
          {searchCount > 0 && (
            <span className="ml-2 rounded-full bg-active/15 px-1.5 py-0.5 text-active">
              {searchCount}
            </span>
          )}
        </button>
      </div>

      {/* What the two hidden filter sets have narrowed to. Both dialogs hide
          their own state, so this line is the only thing on the page saying
          so — and it says the *relation* ("X gave Y"), which is the one part of
          a bay selection that has nowhere else to surface. */}
      {(narrowingLeagues || selection) && (
        <p className="relative -mt-3 mb-6 truncate font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-active">
          {[narrowingLeagues ? filterSummary(leagueFilters) : null, selection]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {searchOpen && (
        <TradeSearch
          filters={filters}
          onChange={setFilters}
          names={names}
          request={facetsRequest}
          requestKey={facetsKey}
        />
      )}

      {leaguesError && (
        // The leagues request failing costs the cards their league *names* and
        // the dialog its options; the trades are a different request and are
        // unaffected, so this is a note rather than the page.
        <p className="relative mb-5 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
          League names unavailable — {leaguesError}
        </p>
      )}

      {error ? (
        <p
          role="alert"
          className="relative inline-flex items-center gap-3 rounded-full border border-error/28 bg-[image:var(--alert-bg)] px-5 py-2.5 font-mono text-[0.8125rem] text-error shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_rgba(0,0,0,0.7)]"
        >
          <span
            aria-hidden
            className="size-[0.4375rem] rounded-full bg-error shadow-[0_0_10px_var(--error)]"
          />
          {error}
        </p>
      ) : loading ? (
        <p className="relative font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
          Reading the board…
        </p>
      ) : !data || data.trades.length === 0 ? (
        <EmptyBoard
          narrowed={narrowingLeagues || searchCount > 0 || seek !== null}
          circle={filters.circle !== "all"}
          onClear={() => {
            setLeagueFilters(DEFAULT_LEAGUE_FILTERS);
            setFilters({ ...DEFAULT_TRADE_FILTERS, circle: filters.circle });
            setSeek(DEFAULT_TRADE_SEEK);
          }}
        />
      ) : (
        <TradesList
          data={data}
          leaguesById={byId}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
        />
      )}
    </div>
  );
}

/**
 * "N of M trades" — what the filters left, over what the league rules and the
 * circle leave.
 *
 * Two numbers because they are two questions, the same distinction the two
 * dialogs draw. A count that failed reads as an em dash rather than a zero: the
 * route degrades its denominators without failing the list, and a zero would
 * claim an empty board under rows that are on screen.
 */
function TradeCount({
  data,
  loading,
}: {
  data: { trades: readonly unknown[]; total: number | null; scopeTotal: number | null } | null;
  loading: boolean;
}) {
  if (loading || !data) return <>Reading…</>;
  const n = data.total ?? data.trades.length;
  const m = data.scopeTotal;
  return (
    <>
      {n.toLocaleString()}
      {m !== null && m !== n ? ` of ${m.toLocaleString()}` : ""} trades
    </>
  );
}

/**
 * Two empty states, because they are two claims: one is about the database, the
 * other about the selection — and only the second has anything the reader can
 * undo.
 */
function EmptyBoard({
  narrowed,
  circle,
  onClear,
}: {
  narrowed: boolean;
  circle: boolean;
  onClear: () => void;
}) {
  if (!narrowed && !circle) {
    return (
      <p className="relative font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
        No trades stored for this season — look a manager up on Tools to sync
        their leagues.
      </p>
    );
  }

  return (
    <div className="relative flex flex-wrap items-center gap-4">
      <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
        {circle && !narrowed
          ? "No trades in this circle."
          : "No trades match these filters."}
      </p>
      {narrowed && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-full border border-foreground/10 bg-[image:var(--key-bg)] px-4 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/80 shadow-[var(--key-shadow)] hover:text-readout active:translate-y-0.5"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
