"use client";

import { useMemo, useState } from "react";

import {
  DEFAULT_LEAGUE_FILTERS,
  FlaskLoader,
  LeagueFiltersModal,
  filterSummary,
  matchesFilters,
  todayIso,
} from "@/features/shared";
import type { LeagueFilters } from "@/features/shared";

import {
  DEFAULT_TRADE_FILTERS,
  tradeFilterSummary,
  tradeMatches,
  tradeRangeBounds,
} from "../filters";
import type { TradeFilters } from "../filters";
import { useTrades } from "../hooks/use-trades";
import { TradeCard } from "./trade-card";
import { TradeFiltersModal } from "./trade-filters-modal";

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
 */
export function TradesHome({ season }: { season: string }) {
  const { data, loading, error } = useTrades(season);

  const [leagueFilters, setLeagueFilters] = useState<LeagueFilters>(
    DEFAULT_LEAGUE_FILTERS,
  );
  const [tradeFilters, setTradeFilters] = useState<TradeFilters>(
    DEFAULT_TRADE_FILTERS,
  );

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

  // The read is capped, so a season busier than the cap is showing its newest
  // slice. Said here rather than left to be inferred from a list that simply
  // stops: the filters below count over what arrived, not over the season.
  const truncated = data ? data.total > data.trades.length : false;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">Trades</h1>
          <p className="mt-1 min-w-0 truncate text-sm text-foreground/60">
            {/* What the count beside it is over, in words — the two modals hide
                their own state, so the scope is stated outside them. */}
            {season} · every crawled league · {filterSummary(leagueFilters)} ·{" "}
            {tradeFilterSummary(tradeFilters)}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <p className="text-right text-sm text-foreground/60">
            <b className="text-lg font-semibold tabular-nums text-foreground">
              {visible.length}
            </b>{" "}
            {visible.length === inLeagues.length
              ? "trades"
              : `of ${inLeagues.length} trades`}
          </p>
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

      {loading && !data ? (
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
            : "No trades match these filters."}
        </Note>
      ) : (
        <>
          {truncated && (
            <p className="mb-3 text-xs text-foreground/45">
              Showing the {data!.trades.length.toLocaleString()} most recent of{" "}
              {data!.total.toLocaleString()} trades this season; the filters
              count over these.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {visible.map((trade) => (
              <li key={trade.transaction_id}>
                <TradeCard
                  trade={trade}
                  league={leaguesById.get(trade.league_id) ?? null}
                  players={data?.players ?? {}}
                  managers={data?.managers ?? {}}
                />
              </li>
            ))}
          </ul>
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
