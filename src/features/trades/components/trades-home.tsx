"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  LeagueFiltersModal,
  PageHeading,
  filterSummary,
  matchesFilters,
  todayIso,
} from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import {
  DEFAULT_TRADE_FILTERS,
  tradeFilterSummary,
  tradeMatches,
  tradeRangeBounds,
} from "../filters";
import type { TradeFilters } from "../filters";
import { useTrades } from "../hooks/use-trades";
import { DEFAULT_TRADE_COLUMNS, TRADE_METRICS } from "../trade-metrics";
import { TradeFiltersModal } from "./trade-filters-modal";
import { TradeValuePicker } from "./trade-value";
import { TradesList } from "./trades-list";

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
 * Both filter sets are applied here, on the client, over one read of the season's
 * trades. That is the shape the filters demand rather than a shortcut: the
 * league filters run against the leagues the same read names, and the trade
 * filters' own option lists — which players moved, who deals most — are read
 * *off the trades*, so the unnarrowed set has to be in hand either way.
 *
 * **The season is whole, and two things pay for that.** It used to be the 2,000
 * most recent trades of it, because needing everything client-side meant one
 * ~20MB response and one list of however many cards survived the filters. The
 * read streams now, so the page fills from the newest trade down while the rest
 * is still arriving; and the list is windowed ({@link TradesList}), so how many
 * cards match costs nothing beyond the couple of dozen on screen.
 *
 * What that costs the page is that it renders a *partial* season for the first
 * few seconds, which is why the count line says so while the stream runs. The
 * filters keep working throughout — they count over what has arrived, and both
 * the numbers and the menus widen as more does.
 */
export function TradesHome({ season }: { season: string }) {
  const { data, loading, streaming, error } = useTrades(season);

  const [leagueFilters, setLeagueFilters] = useState<LeagueFilters>(
    DEFAULT_LEAGUE_FILTERS,
  );
  const [tradeFilters, setTradeFilters] = useState<TradeFilters>(
    DEFAULT_TRADE_FILTERS,
  );

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

  const leagues = useMemo(() => data?.leagues ?? [], [data]);
  const leaguesById = useMemo(
    () => new Map(leagues.map((league) => [league.league_id, league])),
    [leagues],
  );

  // Resolved once per render rather than per trade, and against a date rather
  // than the clock, so the list only moves when the day does.
  const today = todayIso();
  const bounds = useMemo(
    () => tradeRangeBounds(tradeFilters.range, today),
    [tradeFilters.range, today],
  );

  const trades = useMemo(() => data?.trades ?? [], [data]);
  const inLeagues = useMemo(() => {
    const allowed = new Set(
      leagues
        .filter((league) => matchesFilters(league, leagueFilters))
        .map((league) => league.league_id),
    );
    return trades.filter((trade) => allowed.has(trade.league_id));
  }, [trades, leagues, leagueFilters]);

  const visible = useMemo(
    () => inLeagues.filter((trade) => tradeMatches(trade, tradeFilters, bounds)),
    [inLeagues, tradeFilters, bounds],
  );

  // Nothing is capped any more, but a stream in flight is still a partial
  // season, and for the same render it looks identical: the filters count over
  // what has arrived. So it is said while it is true and stops being said when
  // the last chunk lands, where the old truncation note was permanent.
  const pending = streaming && data ? data.total - data.trades.length : 0;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        {/* The scope line is the lede here: what the count beside it is over, in
            words — the two modals hide their own state, so it is stated outside
            them. It truncates rather than wrapping, since the count and both
            triggers share the row. */}
        <PageHeading
          title="Trades"
          lede={
            <span className="block min-w-0 truncate text-sm">
              {season} · every crawled league · {filterSummary(leagueFilters)} ·{" "}
              {tradeFilterSummary(tradeFilters)}
            </span>
          }
          className="min-w-0"
        />

        <div className="ml-auto flex items-center gap-4">
          <p className="text-right text-sm text-foreground/60">
            <b className="text-lg font-semibold tabular-nums text-foreground">
              {visible.length}
            </b>{" "}
            {visible.length === inLeagues.length
              ? "trades"
              : `of ${inLeagues.length} trades`}
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
            trades={inLeagues}
            players={data?.players ?? {}}
            managers={data?.managers ?? {}}
            today={today}
          />
        </div>
      </header>

      {error && <Note tone="error">{error}</Note>}

      {/* The stream opens with a `meta` message, so `data` exists a beat before
          any trade does — the loader has to outlast that or the page flashes
          "nothing stored" at a season that is loading normally. */}
      {(loading || (streaming && trades.length === 0)) ? (
        <div className="flex flex-col items-center gap-3 py-16 text-foreground/60">
          <FlaskLoader />
          <p className="text-sm">Reading every league&rsquo;s trades…</p>
        </div>
      ) : visible.length === 0 ? (
        <Note>
          {trades.length === 0
            ? // Transactions arrive with the league syncs, so a season nothing
              // has been crawled for has none stored rather than none made.
              "No trades stored for this season yet. They arrive with the league syncs — look an account up on the tools page if this database is cold."
            : streaming
              ? // Mid-stream the list is the newest slice of the season, so a
                // filter reaching further back legitimately has nothing yet.
                "No trades match these filters yet — the rest of the season is still loading."
              : "No trades match these filters."}
        </Note>
      ) : (
        <>
          {pending > 0 && (
            // A progress line rather than a bar: the cards below are already
            // readable and already the newest ones, so this is a footnote about
            // the tail of the season, not a thing to watch.
            <p className="mb-3 text-xs text-foreground/45">
              Loading this season&rsquo;s trades —{" "}
              {data!.trades.length.toLocaleString()} of{" "}
              {data!.total.toLocaleString()} so far, newest first. The filters
              count over these until the rest arrives.
            </p>
          )}
          <TradesList
            trades={visible}
            leaguesById={leaguesById}
            players={data?.players ?? {}}
            managers={data?.managers ?? {}}
            metric={metric}
            ktc={data?.ktc ?? {}}
          />
        </>
      )}
    </>
  );
}

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
