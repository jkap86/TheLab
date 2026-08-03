"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  PageHeading,
  activeFilterCount,
  filterSummary,
  todayIso,
} from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import {
  DEFAULT_TRADE_FILTERS,
  tradeFilterSummary,
  tradeRangeBounds,
} from "../filters";
import type { TradeFilters } from "../filters";
import { useFilteredTrades } from "../hooks/use-filtered-trades";
import { useTradeLeagues } from "../hooks/use-trade-leagues";
import { useTrades } from "../hooks/use-trades";
import type { Verdict } from "../incremental";
import { DEFAULT_TRADE_COLUMNS, TRADE_METRICS } from "../trade-metrics";
import { resolveLeagueScope, tradeQueryKey } from "../trade-query";
import { TradeValuePicker } from "./trade-value";
import { TradesList } from "./trades-list";

/**
 * The two filter dialogs, loaded on demand.
 *
 * Neither is on screen at first paint — each is a trigger button and a `<dialog>`
 * that is only ever shown by a press — and between them they are the largest
 * client modules this page pulls: the league filters dialog is ~970 lines with
 * the whole slot-group and scoring-rule editor, its option tables and its
 * breakdown counts behind it, and the trade filters dialog brings the option
 * picker and the facets query. Statically imported, all of it was parsed and
 * evaluated before the first card could be drawn.
 *
 * `ssr: false` because there is nothing to prerender: a `<dialog>` that opens on
 * a press has no server-rendered state worth having, and rendering it would put
 * the markup back in the document that the split is removing.
 *
 * The triggers *are* the components, so the fallback is what holds their place
 * in the header row while the chunk loads — a plain pill of the same size, so
 * the row doesn't reflow when it arrives (which would move the list under it and
 * make the virtualizer re-measure its own offset).
 */
const LeagueFiltersModal = dynamic(
  () =>
    import("@/features/shared/ui/league-filters-modal").then(
      (m) => m.LeagueFiltersModal,
    ),
  // "Filters" rather than "Leagues": the placeholder is standing in for the
  // real trigger's box, so it has to wear the real trigger's word or the row is
  // a different width for the moment the chunk is loading.
  { ssr: false, loading: () => <TriggerPlaceholder label="Filters" /> },
);

const TradeFiltersModal = dynamic(
  () => import("./trade-filters-modal").then((m) => m.TradeFiltersModal),
  { ssr: false, loading: () => <TriggerPlaceholder label="Trades" /> },
);

/**
 * Every trade in every league this database has crawled, newest first, behind
 * two independent filter sets.
 *
 * The market rather than one account's corner of it: the leagues a reader plays
 * in are a fraction of the trades worth reading, and what a leaguemate — or a
 * stranger in a league shaped like theirs — gave up for a rookie first is the
 * question this page answers. Narrowing back to their own leagues is what the
 * managers filter does, so nothing is lost by opening the default. That is also
 * why the page needs no stored account: there is no username in the question.
 *
 * **It used to download the season and filter it here; it now asks for what it
 * is showing.** The old shape was honest about its constraint — the filter menus
 * were read off the trades, so the browser needed the unnarrowed season, so the
 * only lever was making ~20MB arrive progressively — and the constraint is what
 * moved. The filters are SQL, the menus are their own aggregate behind the
 * dialog that shows them, and what arrives here is a page of two hundred cards
 * with the next one following the scroll.
 *
 * Three things are arranged around keeping the page identical while that
 * changed:
 *
 * - **The league rules still run here**, over `useTradeLeagues`'s list, because
 *   they read Sleeper's JSONB through the solver's own slot tables and a second
 *   implementation in SQL would drift silently. What crosses the wire is their
 *   *answer* — the league ids — so the narrowing is still the database's.
 * - **The headline still reads "N of M"**, with both numbers counted server-side
 *   over the two populations the two filter sets describe.
 * - **The residual pass stayed**, three-state now, for the window between the
 *   first page landing and the league list landing, and for the case where the
 *   id list is too long for a query string. Usually it judges nothing.
 */
export function TradesHome({ season }: { season: string }) {
  const [leagueFilters, setLeagueFilters] = useState<LeagueFilters>(
    DEFAULT_LEAGUE_FILTERS,
  );
  const [tradeFilters, setTradeFilters] = useState<TradeFilters>(
    DEFAULT_TRADE_FILTERS,
  );

  // Everything laid out above the list, so the virtualizer can watch *this* for
  // the size changes that move the list down the page — rather than the body,
  // whose box the list's own growth changes on every measured card.
  const headerRef = useRef<HTMLDivElement>(null);

  // The cards' value column, chosen once for the whole list and remembered on
  // the device — the same mechanism the league and share lists use, at the grain
  // of one side of one trade. One slot rather than their four: a trade card is
  // already a table of the assets that make the number up.
  const { columns, setColumn, reset } = usePersistedColumns(
    "trade-side",
    DEFAULT_TRADE_COLUMNS,
    TRADE_METRICS,
  );
  const metric =
    TRADE_METRICS.find((m) => m.key === columns[0]) ?? TRADE_METRICS[0];

  const {
    leagues,
    byId: leaguesById,
    loading: leaguesLoading,
  } = useTradeLeagues(season);

  // Resolved once per render rather than per trade, and against a date rather
  // than the clock, so the list only moves when the day does.
  const today = todayIso();
  const bounds = useMemo(
    () => tradeRangeBounds(tradeFilters.range, today),
    [tradeFilters.range, today],
  );

  const leagueFiltersActive = activeFilterCount(leagueFilters) > 0;
  const scope = useMemo(
    () => resolveLeagueScope(leagues, leagueFilters, leagueFiltersActive),
    [leagues, leagueFilters, leagueFiltersActive],
  );

  const request = useMemo(
    () => ({ season, scope, filters: tradeFilters, bounds }),
    [season, scope, tradeFilters, bounds],
  );

  const { data, loading, loadingMore, hasMore, loadMore, error } =
    useTrades(request);

  const trades = data?.trades ?? EMPTY_TRADES;

  /**
   * The residual verdict — see `../incremental` for why it has three answers.
   *
   * In the ordinary case there is nothing to decide: the server applied the
   * league narrowing, so every trade that came back is allowed. The two cases
   * that are left are the two the third state exists for — a page that arrived
   * before the league list did, and a league set too large to send as ids.
   */
  const judge = useCallback(
    (trade: { league_id: string }): Verdict => {
      if (scope.kind === "client") {
        return scope.allowed.has(trade.league_id) ? "allowed" : "denied";
      }
      // The server already narrowed, so nothing here can be denied — but while
      // the league list is still loading a card cannot be *named*, and the page
      // draws it either way (a league falls back to its id). Allowing it keeps
      // the first paint what it was under the stream.
      return "allowed";
    },
    [scope],
  );

  const { visible } = useFilteredTrades(
    trades,
    // Everything the verdict closes over except the leagues, which is its own
    // generation below — a change here throws the accumulated answer away, a
    // change there only revisits what was never decided.
    tradeQueryKey(request),
    leaguesLoading ? "loading" : `n${leagues.length}`,
    judge,
  );

  const total = data?.total ?? null;
  const scopeTotal = data?.scopeTotal ?? null;
  const players = data?.players ?? EMPTY_MAP;
  const managers = data?.managers ?? EMPTY_MAP;
  const ktc = data?.ktc ?? EMPTY_MAP;
  const pickSlots = data?.pickSlots ?? EMPTY_MAP;

  return (
    <>
      <div ref={headerRef}>
        <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
          {/* The scope line is the lede here: what the count beside it is over,
              in words — the two modals hide their own state, so it is stated
              outside them. It truncates rather than wrapping, since the count
              and both triggers share the row. */}
          <PageHeading
            title="Trades"
            lede={
              <span className="block min-w-0 truncate text-sm">
                {season} · every crawled league · {filterSummary(leagueFilters)}{" "}
                · {tradeFilterSummary(tradeFilters)}
              </span>
            }
            className="min-w-0"
          />

          <div className="ml-auto flex items-center gap-4">
            <p className="text-right text-sm text-foreground/60">
              <b className="text-lg font-semibold tabular-nums text-foreground">
                {(total ?? visible.length).toLocaleString()}
              </b>{" "}
              {scopeTotal !== null && total !== null && scopeTotal !== total
                ? `of ${scopeTotal.toLocaleString()} trades`
                : "trades"}
            </p>
            <TradeValuePicker
              metrics={TRADE_METRICS}
              metricKey={metric.key}
              onChange={(key) => setColumn(0, key)}
              onReset={reset}
            />
            <LeagueFiltersModal
              filters={leagueFilters}
              onChange={setLeagueFilters}
              leagues={leagues}
            />
            <TradeFiltersModal
              filters={tradeFilters}
              onChange={setTradeFilters}
              season={season}
              scope={scope}
              players={players}
              managers={managers}
              today={today}
            />
          </div>
        </header>

        {error && <Note tone="error">{error}</Note>}
      </div>

      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-foreground/60">
          <FlaskLoader />
          <p className="text-sm">Reading every league&rsquo;s trades…</p>
        </div>
      ) : visible.length === 0 ? (
        <Note>
          {leagueFiltersActive || activeTradeSelection(tradeFilters)
            ? "No trades match these filters."
            : // Transactions arrive with the league syncs, so a season nothing
              // has been crawled for has none stored rather than none made.
              "No trades stored for this season yet. They arrive with the league syncs — look an account up on the tools page if this database is cold."}
        </Note>
      ) : (
        <>
          <TradesList
            trades={visible}
            leaguesById={leaguesById}
            players={players}
            managers={managers}
            metric={metric}
            ktc={ktc}
            pickSlots={pickSlots}
            headerRef={headerRef}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
          {loadingMore && (
            // Below the list rather than over it: the cards above are readable
            // and are the ones being read, so this is a footnote about the tail
            // of the board and not a thing to watch.
            <p className="py-4 text-center text-xs text-foreground/45">
              Loading more trades…
            </p>
          )}
        </>
      )}
    </>
  );
}

/** Whether anything in the trade dialog is narrowing — for the empty state's wording. */
function activeTradeSelection(filters: TradeFilters): boolean {
  return (
    filters.range.preset !== "all" ||
    filters.players.length > 0 ||
    filters.picks.length > 0 ||
    filters.managers.length > 0
  );
}

/**
 * The size and shape of a filter trigger, held while its chunk loads.
 *
 * Sized to match rather than left empty, because the header row wrapping when
 * the real button arrives would move the list down the page — which the
 * virtualizer would then have to re-measure and re-lay-out from.
 */
function TriggerPlaceholder({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="lab-chip inline-flex items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-sm font-semibold text-foreground/40"
    >
      {label}
    </span>
  );
}

/** Stable empties, so a render before the first page doesn't change identity. */
const EMPTY_TRADES: readonly never[] = [];
const EMPTY_MAP = {};

function Note({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={`rounded-xl border px-4 py-6 text-center text-sm ${
        tone === "error"
          ? "border-red-400/25 bg-red-400/5 text-red-200"
          : "border-foreground/10 bg-foreground/[0.02] text-foreground/60"
      }`}
    >
      {children}
    </p>
  );
}
