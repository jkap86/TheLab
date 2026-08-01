"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  LeagueFiltersModal,
  PageHeading,
  activeFilterCount,
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
import { useFilteredTrades } from "../hooks/use-filtered-trades";
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

  // **No league filter means no league filtering at all**, which is not the
  // micro-optimisation it looks like. The leagues arrive on their own messages
  // now, a beat behind the trades they name, so a trade whose league hasn't been
  // named yet is not in `allowed` — and filtering against that set would drop
  // the newest trades on the page for as long as it took their names to land,
  // which is exactly the first paint this work is about. Unnarrowed, there is
  // nothing to ask, so nothing is dropped. Narrowed, an unnamed league honestly
  // fails the filter, the same reading `matchesFilters` takes of a league whose
  // `roster_positions` were never synced.
  const leagueFiltersActive = activeFilterCount(leagueFilters) > 0;
  const allowedLeagues = useMemo(() => {
    if (!leagueFiltersActive) return null;
    return new Set(
      leagues
        .filter((league) => matchesFilters(league, leagueFilters))
        .map((league) => league.league_id),
    );
  }, [leagues, leagueFilters, leagueFiltersActive]);

  // Both filter passes, run over each chunk as it arrives rather than over the
  // whole accumulated season on every render — see `../incremental` for what
  // that saves and what makes it safe. The generation is this component's half
  // of that contract: it has to name everything the two predicates below close
  // over, or a filter change would be appended to an answer computed under the
  // old rules.
  const { inLeagues, visible } = useFilteredTrades(
    trades,
    [
      data?.season ?? "",
      // The set's *size*, not the filters that built it: a league arriving late
      // can change which trades its own filter admits, and only while narrowed.
      // Size is enough because the set only ever grows — leagues are appended,
      // never revised — so a change to which leagues are allowed is either a
      // filter change (named on the next line) or one more league in the set.
      //
      // A league arriving therefore costs a full re-pass, which is the honest
      // price of the rule: a trade this filter rejected because its league was
      // unknown has to be reconsidered. It stays bounded because leagues are
      // named almost entirely in the stream's first chunks and the set stops
      // growing long before the trades do — and it is only paid at all while a
      // league filter is on, which is not the state the page opens in.
      allowedLeagues ? `n${allowedLeagues.size}` : "all",
      JSON.stringify(leagueFilters),
      JSON.stringify(tradeFilters),
      bounds.from ?? "",
      bounds.to ?? "",
    ].join("|"),
    (trade) => !allowedLeagues || allowedLeagues.has(trade.league_id),
    (trade) => tradeMatches(trade, tradeFilters, bounds),
  );

  // Nothing is capped any more, but a stream in flight is still a partial
  // season, and for the same render it looks identical: the filters count over
  // what has arrived. So it is said while it is true and stops being said when
  // the last chunk lands, where the old truncation note was permanent.
  //
  // `-1` is "still arriving, and how much of it is not known yet" — a real
  // state now that the count is its own query rather than something the first
  // row carried, and one the line below is written to say.
  const pending = !streaming || !data
    ? 0
    : data.total == null
      ? -1
      : data.total - data.trades.length;

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
          {pending !== 0 && (
            // A progress line rather than a bar: the cards below are already
            // readable and already the newest ones, so this is a footnote about
            // the tail of the season, not a thing to watch.
            //
            // The denominator is dropped rather than waited for. It is a
            // separate query and lands a beat after the first trades, so
            // withholding the whole line until then would make it appear a
            // moment *after* the cards it is explaining — and "12,000 so far"
            // is already the sentence's point.
            <p className="mb-3 text-xs text-foreground/45">
              Loading this season&rsquo;s trades —{" "}
              {data!.trades.length.toLocaleString()}
              {data!.total != null ? ` of ${data!.total.toLocaleString()}` : ""}{" "}
              so far, newest first. The filters count over these until the rest
              arrives.
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
